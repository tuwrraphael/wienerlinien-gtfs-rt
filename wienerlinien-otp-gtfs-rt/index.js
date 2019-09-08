const GtfsRealtimeBindings = require('gtfs-realtime-bindings').transit_realtime;
const express = require('express');
const OTPProxy = require("./OTPProxy");
const WebSocket = require('ws');
const proxy = require('express-http-proxy');
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

app.get('/otp/routers/default/plan', async (req, res, next) => {
  try {
    let result = await otpProxy.getRoute(url.parse(req.url).query);
    res.setHeader('ETag', `"${result.id}"`);
    res.send(result.route);
    res.status(200).end();
  }
  catch (e) {
    next(e);
  }
});

app.post('/routes/:id/subscribe', async (req, res, next) => {
  try {
    let subscribed = otpProxy.subscribe(req.params.id, req.query.callback);
    if (subscribed) {
      res.status(201).end();
    } else {
      res.status(404).end();
    }
  }
  catch (e) {
    next(e);
  }
});

if (settings.proxyAllOtpCalls) {
  app.use('/', proxy(settings.options.baseUrl));
}

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