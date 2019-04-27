const GtfsRealtimeBindings = require('gtfs-realtime-bindings').transit_realtime;
const express = require('express');
const OTPProxy = require("./OTPProxy");
const WebSocket = require('ws');
const url = require("url");

const settings = require("./settings");

const app = express();

var connections = [];

let otpProxy = new OTPProxy(settings.options, function (feedMessage) {
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

app.listen(settings.optProxyPort);

const wss = new WebSocket.Server({ port: settings.websocketPort });

wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    console.log('received: %s', message);
  });
  ws.on('error', () => connections.splice(connections.indexOf(ws), 1));
  ws.on('close', () => connections.splice(connections.indexOf(ws), 1));
  connections.push(ws);
});