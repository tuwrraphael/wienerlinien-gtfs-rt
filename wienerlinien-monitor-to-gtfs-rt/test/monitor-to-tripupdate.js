const expect = require('chai').expect;
const MonitorToTripUpdateConverter = require("../monitor-trip-update-converter");

describe('monitor to testupdate', function () {
    it('fc', function () {
        var res = require("./rbl565.json");
        var c = new MonitorToTripUpdateConverter(
            function (departure, line, monitor) {
                if (line.name == "10" && line.direction == "H") {
                    return {
                        trip_id: "440.T2.22-10-j19-1.1.H",
                        stop_id: "at:49:597:0:8"
                    };
                }
            });
        c.getTripUpdates(res).then(updates =>
            console.log(updates));
    })
})