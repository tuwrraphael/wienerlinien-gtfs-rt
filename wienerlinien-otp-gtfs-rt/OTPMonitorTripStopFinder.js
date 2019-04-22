var fetch = require('node-fetch');
const startOfToday = require("date-fns/start_of_today");
const addSeconds = require("date-fns/add_seconds");
const distance = require("@turf/distance").default;

class OTPMonitorTripStopFinder {
    constructor(baseUrl, routerId) {
        this.baseUrl = baseUrl;
        this.routerId = routerId;
        this.initialized = false;
        this.findTripStop = this.findTripStop.bind(this);
    }
    async initialize() {
        this.routes = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/routes`)).json();
        this.initialized = true;
    }
    async findTripStop(departure, line, monitor) {
        if (!this.initialized || !monitor.locationStop || !monitor.locationStop.geometry) {
            return null;
        }
        var routes = this.routes.filter(r => r.shortName == line.name);
        for (let route of routes) {
            var patterns = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/routes/${route.id}/patterns`)).json();
            var checkedStops = [];
            for (let pattern of patterns) {
                var trips = null;
                var stops = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/patterns/${pattern.id}/stops`)).json();
                if (stops.length == 0) {
                    continue;
                }
                let stopsWithDistance = stops.map(s => { return { s: s, distance: distance([s.lon, s.lat], [monitor.locationStop.geometry.coordinates[0], monitor.locationStop.geometry.coordinates[1]]) }; });
                let closest = stopsWithDistance.sort((a, b) => a.distance - b.distance)[0];
                if (checkedStops.indexOf(closest.s.sid) > -1) {
                    continue;
                }
                checkedStops.push(closest.s.id);
                var stopTimes = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/stops/${closest.s.id}/stoptimes?startTime=${Math.round((+new Date()) / 1000)}&timeRange=${70 * 60}&numberOfDepartures=10`)).json();
                for (let p of stopTimes) {
                    var stopTime = p.times.find(t => {
                        var scheduled = addSeconds(startOfToday(), t.scheduledDeparture);
                        var planned = new Date(departure.departureTime.timePlanned);
                        return scheduled.getTime() == planned.getTime();
                    });
                    if (null != stopTime) {
                        trips = trips || await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/index/patterns/${pattern.id}/trips`)).json();
                        if (trips.find(t => t.id == stopTime.tripId)) {
                            console.log(`found ${stopTime.tripId} for ${line.name}`);
                            return {
                                stop_id: closest.s.id,
                                trip_id: stopTime.tripId
                            };
                        }
                    }
                }
            }
        }
    }
}
module.exports = OTPMonitorTripStopFinder;