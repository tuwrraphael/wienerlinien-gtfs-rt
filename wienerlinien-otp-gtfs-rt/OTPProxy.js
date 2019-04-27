const fetch = require('node-fetch');
const MonitorTripUpdateConverter = require("../wienerlinien-monitor-to-gtfs-rt");
const RblProvider = require("../wienerlinien-gtfs-rbl");
const OTPMonitorTripStopFinder = require("./OTPMonitorTripStopFinder");

const RETRY_SECS = 30;

class OTPProxy {

    constructor(options, updateCallback) {
        this.updateCallback = updateCallback;
        this.baseUrl = options.baseUrl;
        this.routerId = options.routerId;
        this.APIKEY = options.wlApiKey;
        this.tripStopFinder = new OTPMonitorTripStopFinder(this.baseUrl, this.routerId, options.feedId);
        let self = this;
        function init() {
            self.tripStopFinder.initialize()
                .then(() => self.tripStopFinderInitialized = true, e => {
                    console.error("failed to initialize OTPMonitorTripStopFinder, retry in " + RETRY_SECS, e);
                    setTimeout(init, RETRY_SECS);
                });
        }
        init();

        this.converter = new MonitorTripUpdateConverter(this.tripStopFinder.findTrip, this.tripStopFinder.getStopTimesForTrip);
        this.rblProvider = new RblProvider();
        this.rblProvider.parse(options)
            .then(() => self.rblProviderInitialized = true, e => console.error("failed to initialize RblProvider", e));
        this.msgId = 0;
    }

    rblsForRoute(route) {
        let rbls = [];
        for (let itinerary of route.plan.itineraries) {
            for (let leg of itinerary.legs) {
                if (leg.tripId) {
                    if (leg.from && leg.from.stopId) {
                        let rblInfo = this.rblProvider.rblInfo(leg.tripId.replace(/^1:/, ""), leg.from.stopId.replace(/^1:/, ""));
                        if (rblInfo) {
                            rbls.push(rblInfo.rbl);
                        }
                    }
                    if (leg.to && leg.to.stopId) {
                        let rblInfo = this.rblProvider.rblInfo(leg.tripId.replace(/^1:/, ""), leg.to.stopId.replace(/^1:/, ""));
                        if (rblInfo) {
                            rbls.push(rblInfo.rbl);
                        }
                    }
                }
            }
        }
        return rbls.filter(function (elem, pos) {
            return rbls.indexOf(elem) == pos;
        });
    }

    async getRoute(query) {
        if (!this.tripStopFinderInitialized || !this.rblProviderInitialized) {
            return null;
        }
        let initialRoute = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/plan?${query}`)).json();

        if (!initialRoute.plan) {
            return initialRoute;
        }
        let rbls = this.rblsForRoute(initialRoute);
        var monres = await fetch(`https://www.wienerlinien.at/ogd_realtime/monitor?rbl=${rbls.join("&rbl=")}&sender=${this.APIKEY}`);
        var monitor = await monres.json();
        try {
            var updates = await this.converter.getTripUpdates(monitor);
        }
        catch (e) {
            console.error(e);
            return initialRoute;
        }
        if (updates.length) {
            let self = this;
            updates.forEach(u => {
                var msg = {
                    header: {
                        gtfsRealtimeVersion: "2.0",
                        incrementality: 1,
                        timestamp: (Math.round(+new Date(monitor.message.serverTime) / 1000))
                    },
                    entity: [{
                        id: `${++this.msgId}`,
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
                };
                self.updateCallback(msg);
            });
            // we want to give the OTP time to process the messages
            await this.delay(1000);
            let refreshedRoute = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/plan?${query}`)).json();
            return refreshedRoute;
        }
    }

    delay(t, val) {
        return new Promise(function (resolve) {
            setTimeout(function () {
                resolve(val);
            }, t);
        });
    }
}
module.exports = OTPProxy;