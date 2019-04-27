const RealtimeParser = require("./realtime-map/parser");
const GtfsParser = require("./gtfs/parser");
const distance = require("@turf/distance").default;

class RblProvider {
    constructor() {
        this.realtimeParser = new RealtimeParser();
        this.gtfsParser = new GtfsParser();
        this.ready = false;
    }

    parse(options) {
        return this.ready = Promise.all([
            this.gtfsParser.parse(options),
            this.realtimeParser.parse(options)
        ]);
    }

    rblInfo(tripId, stopId) {
        if (this.ready !== false) {
            var trip = this.gtfsParser.trips.find(t => t.trip_id == tripId);
            if (null == trip) {
                throw new Error("trip not found");
            }
            var route = this.gtfsParser.routes.find(r => r.route_id == trip.route_id);
            var stop = this.gtfsParser.stops.find(s => s.stop_id == stopId);
            if (null == stop) {
                throw new Error("stop not found");
            }
            let linie = null;
            var linien = this.realtimeParser.linien.filter(l => l.bezeichnung == route.route_short_name);
            if (linien.length == 0) {
                throw new Error("linie not found");
            }
            else if (linien.length > 0) {
                linie = linien.find(l => l.echtzeit == true)
                if (linie == null) {
                    linie = linien[0];
                }
            }
            var steige = this.realtimeParser.steige.filter(v => v.linienId == linie.id && v.direction == trip.direction_id);
            if (steige.length == 0) {
                throw new Error("no steige found");
            }
            var withDistance = steige.map(s => { return { steig: s, distance: distance([s.lng, s.lat], [stop.stop_lon, stop.stop_lat]) }; });
            var sorted = withDistance.sort((a, b) => a.distance - b.distance);
            var nearestSteig = sorted[0].steig;
            if (null == nearestSteig.rbl) {
                return null;
            }
            return { rbl: nearestSteig.rbl, linie: linie, direction: nearestSteig.direction };
        }
    }
}

module.exports = RblProvider;