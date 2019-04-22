const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const express = require('express');
const app = express();
const expressWs = require('express-ws')(app);
const fetch = require('node-fetch');
const MonitorTripUpdateConverter = require("../wienerlinien-monitor-to-gtfs-rt");
const OTPMonitorTripStopFinder = require("./OTPMonitorTripStopFinder");

const APIKEY = "";
const OTPInstance = "http://smallvm.westeurope.cloudapp.azure.com:3001";
const OTPRouterId = "wien";

let tripStopFinder = new OTPMonitorTripStopFinder(OTPInstance, OTPRouterId);
tripStopFinder.initialize().catch(function (e) {
  console.error("failed to initialize OTPMonitorTripStopFinder", e);
});

let converter = new MonitorTripUpdateConverter(tripStopFinder.findTripStop);

let id = 0;
var connections = [];

app.post('/monitor', async (req, res, next) => {
  if (req.query["rbl"]) {
    try {
      var monres = await fetch(`https://www.wienerlinien.at/ogd_realtime/monitor?rbl=${req.query["rbl"]}&sender=${APIKEY}`);
      var monitor = await monres.json();
      try {
        var updates = await converter.getTripUpdates(monitor);
      }
      catch (e) {
        console.error(e);
        res.status(500).end();
      }
      if (updates.length) {
        var msg = new GtfsRealtimeBindings.FeedMessage();
        msg.header = new GtfsRealtimeBindings.FeedHeader();
        msg.header.gtfs_realtime_version = "2.0";
        msg.header.incrementality = "DIFFERENTIAL";
        msg.header.timestamp = +(new Date(monitor.message.serverTime));
        msg.entity = updates.map(u => {
          var e = new GtfsRealtimeBindings.FeedEntity();
          e.id = ++id;
          e.trip_update = u;
          return e;
        });
        connections.forEach(c => {
          c.send(msg.encode().array);
        });
      }
      res.status(200).end();
    }
    catch (e) {
      next(e);
    }
  }
  else {
    res.status(404).end();
  }
});



app.ws('/', function (ws, req) {
  ws.on("close", () => connections.splice(connections.indexOf(ws), 1));
  ws.on('message', function (msg) {
    console.log(msg);
  });
  connections.push(ws);
});

app.listen(3002);