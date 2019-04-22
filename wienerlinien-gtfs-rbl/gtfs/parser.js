const fs = require('fs');
const csv = require('csv-parser');
const bomstrip = require('bomstrip');

class Parser {

    parseStops(file) {
        return new Promise(function (resolve, reject) {
            var stops = [];
            fs.createReadStream(file, { encoding: "utf-8" })
                .pipe(bomstrip())
                .pipe(csv())
                .on('error', err => reject(err))
                .on('data', (data) => stops.push({ ...data, stop_lat: parseFloat(data.stop_lat), stop_lon: parseFloat(data.stop_lon) }))
                .on('end', () => {
                    resolve(stops);
                });
        });
    }

    parseRoutes(file) {
        return new Promise(function (resolve, reject) {
            var routes = [];
            fs.createReadStream(file, { encoding: "utf-8" })
                .pipe(bomstrip())
                .pipe(csv())
                .on('error', err => reject(err))
                .on('data', (data) => routes.push(data))
                .on('end', () => {
                    resolve(routes);
                });
        });
    }

    parseTrips(file) {
        return new Promise(function (resolve, reject) {
            var trips = [];
            fs.createReadStream(file, { encoding: "utf-8" })
                .pipe(bomstrip())
                .pipe(csv())
                .on('error', err => reject(err))
                .on('data', (data) => trips.push(data))
                .on('end', () => {
                    resolve(trips);
                });
        });
    }

    async parse(options) {
        this.stops = await this.parseStops(options.stopsCsv);
        this.routes = await this.parseRoutes(options.routesCsv);
        this.trips = await this.parseTrips(options.tripsCsv);
    }

    readTripStops(file, callback) {
        var self = this;
        return new Promise(function (resolve, reject) {
            fs.createReadStream(file, { encoding: "utf-8" })
                .pipe(bomstrip())
                .pipe(csv())
                .on('error', err => reject(err))
                .on('data', (data) => {
                    let trip = self.trips.find(s => s.trip_id == data.trip_id);
                    callback({
                        stop: self.stops.find(s => s.stop_id == data.stop_id),
                        trip: trip,
                        route: self.routes.find(r => r.route_id == trip.route_id)
                    });
                })
                .on('end', () => {
                    resolve(routes);
                });
        });
    }
}

module.exports = Parser;