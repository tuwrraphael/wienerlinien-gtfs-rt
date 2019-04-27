const fetch = require('node-fetch');
const addSeconds = require("date-fns/add_seconds");
const addMinutes = require("date-fns/add_minutes");
const format = require("date-fns/format");
const distance = require("@turf/distance").default;
const levenshtein = require('js-levenshtein');
const { findTimeZone, getUnixTime, getZonedTime } = require('timezone-support')

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
        let nowInTimeZone = getZonedTime(new Date(), this.timezone);
        return new Date(getUnixTime({
            year: nowInTimeZone.year,
            month: nowInTimeZone.month,
            day: nowInTimeZone.day,
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

    cleanName(name) {
        return name
            .toLowerCase()
            .replace(/\s\(?(u|s|\+)+\)?(\s|$)/, "")
            .split(/,|\.|\s/)
            .filter(s => "" != s);
    }

    stationNameMatch(name1, name2) {
        let names1 = this.cleanName(name1);
        let names2 = this.cleanName(name2);
        let smallerGroup = names1.length < names2.length ? names1 : names2;
        let largerGroup = smallerGroup == names1 ? names2 : names1;
        return !smallerGroup.some(word => !largerGroup.some(word2 => levenshtein(word, word2) < (MAX_DIRECTION_EDIT_DISTANCE + 1)));
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
        if (!this.stationNameMatch(lastStop.name, line.towards) > MAX_DIRECTION_EDIT_DISTANCE) {
            return null;
        }
        let self = this;
        let stopsWithDistance = pattern.stops.map(s => {
            return {
                s: s,
                distance: distance([s.lon, s.lat], [monitor.locationStop.geometry.coordinates[0], monitor.locationStop.geometry.coordinates[1]]),
                nameMatch: self.stationNameMatch(monitor.locationStop.properties.title, s.name)
            };
        });
        let plausibleStops = stopsWithDistance.filter(p => p.distance < 1 && p.nameMatch);
        if (plausibleStops.length == 0) {
            return null;
        }
        let closest = plausibleStops.sort((a, b) => a.distance - b.distance)[0].s;
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
        let splicedStoptimes = [...stopTimes];
        for (let departure of departures) {
            let closestStopTime = this.findClosestStoptime(stopTimes, departure.planned);
            let closestExclusiveStopTime = this.findClosestStoptime(splicedStoptimes, departure.planned);
            if (null != closestStopTime) {
                results.push({
                    departure: departure,
                    stop: closest,
                    closestStopTime: closestStopTime,
                    closestExclusiveStopTime: closestExclusiveStopTime
                });
                if (null != closestExclusiveStopTime) {
                    splicedStoptimes.splice(0, splicedStoptimes.indexOf(closestExclusiveStopTime.stopTime) + 1);
                }
            }
        }
        return results;
    }

    getBestMatchingForDeparture(departure, candidates) {
        let match = null;
        let value = 0;
        for (let patternCandidate of candidates) {
            for (let candidate of patternCandidate.matches) {
                if (candidate.departure.id == departure.id) {
                    let candidateValue = Math.abs(candidate.closestStopTime.scheduleDistance);
                    if (match == null || candidateValue < value) {
                        value = candidateValue;
                        match = candidate;
                    }
                }
            }
        }
        return match;
    }

    async findTrip(departures, line, monitor) {
        if (!this.initialized || !monitor.locationStop || !monitor.locationStop.geometry) {
            return null;
        }
        let id = 0;
        departures = departures.map(d => { return { ...d, id: ++id }; });
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
        let result = [];
        for (let departure of departures) {
            let bestCandidate = this.getBestMatchingForDeparture(departure, candidates);
            if (null != bestCandidate) {
                result.push(bestCandidate);
                // the trip can't be taken multiple times 
                candidates.forEach(c => {
                    // prioritze the next possible match in pattern if it was taken
                    c.matches.forEach(m => {
                        if (m != bestCandidate && // dont change the candidate
                            bestCandidate.closestStopTime.stopTime.tripId == m.closestStopTime.stopTime.tripId) {
                            if (null != m.closestExclusiveStopTime
                                && m.closestExclusiveStopTime.stopTime.tripId != bestCandidate.closestStopTime.stopTime.tripId) {
                                m.closestStopTime = m.closestExclusiveStopTime;
                            }
                        }
                    });
                    // filter trips
                    c.matches = c.matches.filter(m =>
                        bestCandidate.closestStopTime.stopTime.tripId != m.closestStopTime.stopTime.tripId);
                });
            }
        }
        result.forEach(r => {
            let rtdep = new Date(r.departure.departureTime.timeReal || r.departure.departureTime.timePlanned);
            console.log(`Trip ${r.closestStopTime.stopTime.tripId}/${r.closestStopTime.scheduleDistance}; line ${line.name}:${line.towards}, at ${r.stop.name}: ${format(rtdep, "HH:mm:ss")}`);
        });
        return result.map(r => {
            return {
                departure: r.departure,
                stop: r.stop,
                stopTime: r.closestStopTime.stopTime,
                tripId: r.closestStopTime.stopTime.tripId,
                scheduleDistance: r.closestStopTime.scheduleDistance
            };
        });
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
