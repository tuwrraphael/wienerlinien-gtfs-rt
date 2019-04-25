var GtfsRealtimeBindings = require('gtfs-realtime-bindings');

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
            var trip_update = new GtfsRealtimeBindings.TripUpdate();
            trip_update.trip = new GtfsRealtimeBindings.TripDescriptor();
            trip_update.trip.trip_id = trip_id;
            trip_update.stop_time_update = stops.map(s => {
                var stopTimeUpdate = new GtfsRealtimeBindings.TripUpdate.StopTimeUpdate();
                stopTimeUpdate.stop_id = s.stop_id;
                stopTimeUpdate.departure = new GtfsRealtimeBindings.TripUpdate.StopTimeEvent();
                stopTimeUpdate.departure.time = Math.round(new Date(s.departure.departureTime.timeReal || s.departure.departureTime.timePlanned).getTime()/1000);
                stopTimeUpdate.arrival = new GtfsRealtimeBindings.TripUpdate.StopTimeEvent();
                stopTimeUpdate.arrival.time = stopTimeUpdate.departure.time;
                return stopTimeUpdate;
            });
            trip_updates.push(trip_update);
        }
        return trip_updates;
    }
}
module.exports = MonitorTripUpdateConverter;