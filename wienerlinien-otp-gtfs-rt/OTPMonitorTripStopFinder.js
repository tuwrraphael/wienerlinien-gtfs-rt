var fetch = require('node-fetch');
const addSeconds = require("date-fns/add_seconds");
const addMinutes = require("date-fns/add_minutes");
const format = require("date-fns/format");
const distance = require("@turf/distance").default;
const levenshtein = require('js-levenshtein');
const { findTimeZone, getUnixTime } = require('timezone-support')

const MAX_DIRECTION_EDIT_DISTANCE = 4;
const OTP_MONITOR_PAST = 10;
const OTP_MONITOR_FUTURE = 70;
const MAX_STOPTIME_DISTANCE = 10;

class OTPMonitorTripStopFinder {
    constructor(baseUrl, routerId, feedId) {
        this.baseUrl = baseUrl;
        this.routerId = routerId;
        this.initialized = false;
        this.findTrip = this.findTrip.bind(this);
        this.getStopTimesForTrip = this.getStopTimesForTrip.bind(this);
        this.feedId = feedId;
        this.monitors = {};
    }
    async initialize() {
        this.routes = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/routes`)).json();
        let agencies = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/agencies/${this.feedId}`)).json();
        this.timezone = findTimeZone(agencies[0].timezone);
        this.initialized = true;
    }

    convertMonitorDirection(line) {
        return line.direction == "H" ? 0 : 1;
    }

    async getOPTMonitor(stopId) {
        if (!this.monitors[stopId]) {
            this.monitors[stopId] = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/stops/${stopId}/stoptimes?startTime=${Math.round((+addMinutes(new Date(), -OTP_MONITOR_PAST)) / 1000)}&timeRange=${(OTP_MONITOR_PAST + OTP_MONITOR_FUTURE) * 60}&numberOfDepartures=10`)).json();
        }
        return this.monitors[stopId];
    }

    startOfTodayInTimezone() {
        var today = new Date();
        return new Date(getUnixTime({
            year: today.getFullYear(),
            month: today.getMonth() + 1,
            day: today.getDate(),
            hours: 0,
            minutes: 0,
            seconds: 0
        }, this.timezone));
    }

    findClosestStoptime(stopTimes, departureTime) {
        let sorted = stopTimes.map(t => {
            return {
                stopTime: t,
                scheduleDistance: +departureTime - (+t.scheduled)
            };
        }).sort((a, b) => Math.abs(a.scheduleDistance) - Math.abs(b.scheduleDistance));
        let stopTime = sorted.length > 0 && Math.abs(sorted[0].scheduleDistance) < (MAX_STOPTIME_DISTANCE * 60000) ? sorted[0] : null;
        return stopTime;
    }

    async findTripsInPattern(departures, line, monitor, patternId) {
        if (!departures.length) {
            return null;
        }
        departures = departures.map(d => { return { ...d, planned: new Date(d.departureTime.timePlanned) }; })
            .sort((a, b) => +a.planned - +b.planned);
        var pattern = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/patterns/${patternId}`)).json();
        if (pattern.trips[0].direction != this.convertMonitorDirection(line)) {
            return null;
        }
        let lastStop = pattern.stops[pattern.stops.length - 1];
        if (levenshtein(lastStop.name.toLowerCase(), line.towards.toLowerCase()) > MAX_DIRECTION_EDIT_DISTANCE) {
            return null;
        }
        let stopsWithDistance = pattern.stops.map(s => { return { s: s, distance: distance([s.lon, s.lat], [monitor.locationStop.geometry.coordinates[0], monitor.locationStop.geometry.coordinates[1]]) }; });
        let closest = stopsWithDistance.sort((a, b) => a.distance - b.distance)[0].s;
        let otpMonitor = await this.getOPTMonitor(closest.id);
        let forPattern = otpMonitor.find(m => m.pattern.id == patternId);
        if (null == forPattern) {
            return null;
        }
        let startOfTodayInGtfsTimezone = this.startOfTodayInTimezone();
        let stopTimes = forPattern.times.map(t => {
            return {
                ...t,
                scheduled: (addSeconds(startOfTodayInGtfsTimezone, t.scheduledDeparture))
            };
        });
        let results = [];
        for (let departure of departures) {
            let closestStopTime = this.findClosestStoptime(stopTimes, departure.planned);
            if (null != closestStopTime) {
                results.push({
                    departure: departure,
                    stop: closest,
                    stopTime: closestStopTime.stopTime,
                    tripId: closestStopTime.stopTime.tripId,
                    scheduleDistance: closestStopTime.scheduleDistance
                });
                stopTimes.splice(0, stopTimes.indexOf(closestStopTime.stopTime) + 1);
            }
        }
        return results;
    }

    async findTrip(departures, line, monitor) {
        if (!this.initialized || !monitor.locationStop || !monitor.locationStop.geometry) {
            return null;
        }
        var routes = this.routes.filter(r => r.shortName == line.name);
        let candidates = [];
        for (let route of routes) {
            let patterns = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/routes/${route.id}/patterns`)).json();
            for (let pattern of patterns) {
                let patternMatches = await this.findTripsInPattern(departures, line, monitor, pattern.id);
                if (null != patternMatches && patternMatches.length) {
                    candidates.push({ pattern, matches: patternMatches });
                }
            }
        }
        if (candidates.length < 1) {
            return [];
        }
        candidates = candidates.sort((a, b) => b.matches.length - a.matches.length);
        let bestMatching = candidates.filter(c => c.matches.length == candidates[0].matches.length)
            .map(c => { return { ...c, distanceSum: c.matches.reduce((acc, val) => acc + Math.abs(val.scheduleDistance)) } })
            .sort((a, b) => a.distanceSum - b.distanceSum);
        return bestMatching[0].matches;
    }

    async getStopTimesForTrip(tripId) {
        let stopTimes = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/trips/${tripId}/stoptimes`)).json();
        let startOfTodayInGtfsTimezone = this.startOfTodayInTimezone();
        return stopTimes.map(t => {
            return {
                ...t,
                scheduledDeparture: (addSeconds(startOfTodayInGtfsTimezone, t.scheduledDeparture)),
                realtimeDeparture: (addSeconds(startOfTodayInGtfsTimezone, t.realtimeDeparture))
            };
        });
    }

    async debugTripUpdates(tripUpdates) {
        for (let update of tripUpdates) {
            console.log(`Update for trip ${update.trip.tripId}:`);
            for (let stop of update.stopTimeUpdate) {
                let stopName = (await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/stops/${stop.stopId}`)).json()).name;
                console.log(`${stopName}: ${format(new Date(stop.departure.time * 1000), "HH:mm:ss")}`);
            }
        }
    }
}
module.exports = OTPMonitorTripStopFinder;
