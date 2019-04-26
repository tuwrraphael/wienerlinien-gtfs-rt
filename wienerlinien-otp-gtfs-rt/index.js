const GtfsRealtimeBindings = require('gtfs-realtime-bindings').transit_realtime;
const express = require('express');
const app = express();
const fetch = require('node-fetch');
const MonitorTripUpdateConverter = require("../wienerlinien-monitor-to-gtfs-rt");
const OTPMonitorTripStopFinder = require("./OTPMonitorTripStopFinder");
const WebSocket = require('ws');

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

app.get('/monitor', async (req, res, next) => {
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
        updates.forEach(u => {
          var msg = GtfsRealtimeBindings.FeedMessage.create({
            header: {
              gtfsRealtimeVersion: "2.0",
              incrementality: 1,
              timestamp: (Math.round(+new Date(monitor.message.serverTime) / 1000))
            },
            entity: [{
              id: `${++id}`,
              tripUpdate: {
                ...u,
                trip: {
                  ...u.trip,
                  tripId: u.trip.tripId.replace(/^1:/, "")
                },
                stopTimeUpdate: u.stopTimeUpdate.map(s => {
                  return {
                    ...s,
                    stopId: s.stopId.replace(/^1:/, "")
                  };
                })
              }
            }]
          });
          connections.forEach(c => {
            try {
              c.send(GtfsRealtimeBindings.FeedMessage.encode(msg).finish());
            }
            catch{
              connections.splice(connections.indexOf(c), 1);
            }
          });
        });
      }
      //res.contentType("application/x-google-protobuf");
      //res.end(msg.encode().toBuffer(), 'binary');
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

app.listen(3002);

const wss = new WebSocket.Server({ port: 3003 });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
  });
  ws.on('error', () => connections.splice(connections.indexOf(ws), 1));
  ws.on('close', () => connections.splice(connections.indexOf(ws), 1));
  connections.push(ws);
});