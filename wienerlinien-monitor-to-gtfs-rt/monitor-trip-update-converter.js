class MonitorTripUpdateConverter {
    constructor(findTripStopFromMonitorInfo) {
        this.findTripStopFromMonitorInfo = findTripStopFromMonitorInfo;
    }

    groupBy(xs, key) {
        return xs.reduce(function (rv, x) {
            (rv[x[key]] = rv[x[key]] || []).push(x);
            return rv;
        }, {});
    };

    async getTripUpdates(monitorResponse) {
        var tripStops = [];
        for (let monitor of monitorResponse.data.monitors) {
            for (let line of monitor.lines) {
                if (!line.departures.departure) {
                    continue;
                }
                var res = await this.findTripStopFromMonitorInfo(line.departures.departure
                    .filter(d => d.departureTime && (d.departureTime.timeReal || d.departureTime.timePlanned)), line, monitor);
                if (null != res) {
                    for (let info of res) {
                        tripStops.push({
                            trip_id: info.trip_id,
                            stop_id: info.stop_id,
                            departure: info.departure,
                            line: line,
                            monitor: monitor
                        });
                    }
                }
            }
        }
        monitorResponse.data.monitors.forEach(m => {
            m.lines.forEach(l => {

            })
        });
        var trip_updates = [];
        let trips = this.groupBy(tripStops, "trip_id");
        for (let trip_id in trips) {
            var stops = trips[trip_id];
            var u = {
                trip: {
                    tripId: trip_id
                },
                stopTimeUpdate: stops.map(s => {
                    return {
                        stopId: s.stop_id,
                        departure: {
                            time: Math.round(new Date(s.departure.departureTime.timeReal || s.departure.departureTime.timePlanned).getTime() / 1000)
                        },
                        arrival: {
                            time: Math.round(new Date(s.departure.departureTime.timeReal || s.departure.departureTime.timePlanned).getTime() / 1000)
                        },
                        delay: null,
                        scheduleRelationship: "SCHEDULED"
                    };
                })
            }
            trip_updates.push(u);
        }
        return trip_updates;
    }
}
module.exports = MonitorTripUpdateConverter;