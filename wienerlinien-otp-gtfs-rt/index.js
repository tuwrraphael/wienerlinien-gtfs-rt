const GtfsRealtimeBindings = require('gtfs-realtime-bindings').transit_realtime;
const express = require('express');
const OTPProxy = require("./OTPProxy");
const WebSocket = require('ws');
const url = require("url");

const app = express();

const OTPInstance = "http://smallvm.westeurope.cloudapp.azure.com:3001";
const OTPRouterId = "wien";

var connections = [];

let optOptions = {
  feedId: "1",
  baseUrl: OTPInstance,
  routerId: OTPRouterId
};

let wlOptions = {
  haltestellenCsv: "./wienerlinien-ogd-haltestellen.csv",
  steigeCsv: "./wienerlinien-ogd-steige.csv",
  linienCsv: "./wienerlinien-ogd-linien.csv",
  stopsCsv: "./stops.txt",
  routesCsv: "./routes.txt",
  tripsCsv: "./trips.txt",
  wlApiKey: ""
};

let otpProxy = new OTPProxy({
  ...optOptions,
  ...wlOptions
}, function (feedMessage) {
  let protobufmsg = GtfsRealtimeBindings.FeedMessage.create(feedMessage);
  let encoded = GtfsRealtimeBindings.FeedMessage.encode(protobufmsg).finish();
  connections.forEach(c => {
    try {
      c.send(encoded);
    }
    catch{
      connections.splice(connections.indexOf(c), 1);
    }
  });
});

app.get('/plan', async (req, res, next) => {
  try {
    let route = await otpProxy.getRoute(url.parse(req.url).query);
    res.send(route);
    res.status(200).end();
  }
  catch (e) {
    next(e);
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