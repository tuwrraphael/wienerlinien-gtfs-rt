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
    });
    it('test1', function () {
        var test1 = require("./test1.json");
        var c = new MonitorToTripUpdateConverter();
        test1.stoptimes.forEach(s => {
            s.scheduledDeparture = new Date(s.scheduledDeparture);
        });
        test1.rtStoptimes.forEach(s => {
            s.realtimeDeparture = new Date(s.realtimeDeparture);
        })
        var updates = c.mergeUpdates(test1.stoptimes, test1.rtStoptimes);
        var increasing = c.checkUpdatesIncreasing(updates, test1.stoptimes);
        expect(increasing).to.be.true;
    });
    it('test2', function () {
        var test2 = require("./test2.json");
        var c = new MonitorToTripUpdateConverter();
        test2.stoptimes.forEach(s => {
            s.scheduledDeparture = new Date(s.scheduledDeparture);
        });
        test2.rtStoptimes.forEach(s => {
            s.realtimeDeparture = new Date(s.realtimeDeparture);
        })
        var updates = c.mergeUpdates(test2.stoptimes, test2.rtStoptimes);
        var increasing = c.checkUpdatesIncreasing(updates, test2.stoptimes);
        expect(increasing).to.be.true;
    });
});