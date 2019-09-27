const fetch = require('node-fetch');
const MonitorTripUpdateConverter = require("../wienerlinien-monitor-to-gtfs-rt");
const RblProvider = require("../wienerlinien-gtfs-rbl");
const OTPMonitorTripStopFinder = require("./OTPMonitorTripStopFinder");
const compareRoute = require('./compare-route');
const NodeCache = require("node-cache");
const uuid = require("uuid/v4");
const addMinutes = require("date-fns/add_minutes");
const getActiveLeg = require("./get-active-leg");

const RETRY_SECS = 30;
const TTL_SECS = 15 * 60;
const SUBSCRIPTION_PROCESS_INTERVAL_MS = 60000;
const MIN_DIFF_MS = 60000;

class OTPProxy {

    constructor(options, updateCallback) {
        this.updateCallback = updateCallback;
        this.baseUrl = options.baseUrl;
        this.routerId = options.routerId;
        this.APIKEY = options.wlApiKey;
        this.feedId = options.feedId;
        this.cleanRegex = new RegExp("^" + this.feedId + ":");
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
        this.routeCache = new NodeCache();
        this.subscriptions = [];
        this.processSubscriptions = this.processSubscriptions.bind(this);
        setInterval(function () {
            self.processSubscriptions()
                .catch(function (err) {
                    console.error(err);
                })
        }, SUBSCRIPTION_PROCESS_INTERVAL_MS);
        this.updateOTP = this.updateOTP.bind(this);
        this.subscribe = this.subscribe.bind(this);
    }

    rblsForRoute(route) {
        let rbls = [];
        for (let itinerary of route.plan.itineraries) {
            for (let leg of itinerary.legs) {
                if (leg.tripId) {
                    if (leg.from && leg.from.stopId) {
                        try {
                            let rblInfo = this.rblProvider.rblInfo(leg.tripId.replace(this.cleanRegex, ""), leg.from.stopId.replace(this.cleanRegex, ""));
                            if (rblInfo) {
                                rbls.push(rblInfo.rbl);
                            }
                        }
                        catch (e) {
                            console.error(e);
                        }
                    }
                    if (leg.to && leg.to.stopId) {
                        try {
                            let rblInfo = this.rblProvider.rblInfo(leg.tripId.replace(this.cleanRegex, ""), leg.to.stopId.replace(this.cleanRegex, ""));
                            if (rblInfo) {
                                rbls.push(rblInfo.rbl);
                            }
                        }
                        catch (e) {
                            console.error(e);
                        }
                    }
                }
            }
        }
        return rbls.filter(function (elem, pos) {
            return rbls.indexOf(elem) == pos;
        });
    }

    async updateOTP(rbls) {
        let updates = null;
        if (rbls.length) {
            var monres = await fetch(`https://www.wienerlinien.at/ogd_realtime/monitor?rbl=${rbls.join("&rbl=")}&sender=${this.APIKEY}`);
            var monitor = await monres.json();
            try {
                updates = await this.converter.getTripUpdates(monitor);
            }
            catch (e) {
                console.error(e);
                return false;
            }
        }
        if (updates && updates.length) {
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
                                tripId: u.trip.tripId.replace(this.cleanRegex, "")
                            },
                            stopTimeUpdate: u.stopTimeUpdate.map(s => {
                                return {
                                    ...s,
                                    stopId: s.stopId.replace(this.cleanRegex, "")
                                };
                            })
                        }
                    }]
                };
                self.updateCallback(msg);
            });
        }
        return updates;
    }

    async getRoute(query) {
        let id = uuid();
        if (!this.tripStopFinderInitialized || !this.rblProviderInitialized) {
            return null;
        }
        let initialRoute = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/plan?${query}`)).json();

        if (!initialRoute.plan) {
            return initialRoute;
        }
        let rbls = this.rblsForRoute(initialRoute);
        var updates = false;
        if (rbls.length) {
            updates = await this.updateOTP(rbls);
        }
        if (updates && updates.length) {
            // we want to give the OTP time to process the messages
            await this.delay(1000);
            let refreshedRoute = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/plan?${query}`)).json();
            this.routeCache.set(id, { route: refreshedRoute, rbls, query }, TTL_SECS);
            return { id, route: refreshedRoute };
        }
        else {
            this.routeCache.set(id, { route: initialRoute, rbls: null, query }, TTL_SECS);
            return { id, route: initialRoute };
        }
    }

    subscribe(id, callbackUrl) {
        let routeData = this.routeCache.get(id);
        if (!routeData) {
            return false;
        }
        let endTime = addMinutes(new Date(), 120);
        let startTime = new Date();
        if (routeData.route.plan && routeData.route.plan.itineraries) {
            let endTimes = routeData.route.plan.itineraries.map(i => i.endTime);
            let startTimes = routeData.route.plan.itineraries.map(i => i.startTime);
            endTimes.sort((a, b) => b - a);
            startTimes.sort((a, b) => a - b);
            if (endTimes.length) {
                endTime = new Date(endTimes[0])
            }
            if (startTimes.length) {
                startTime = addMinutes(new Date(startTimes[0]), -30);
            }
        }
        this.subscriptions.push({
            id,
            end: endTime,
            start: startTime,
            callbackUrl
        });
        this.routeCache.set(id, routeData, Math.round((+endTime - +new Date()) / 1000) + TTL_SECS);
        return true;
    }

    async processSubscriptions() {
        var possibleUpdates = [];
        this.subscriptions = this.subscriptions.filter(s => s.end > new Date());
        let started = this.subscriptions.filter(s => s.start <= new Date());
        for (let subscription of started) {
            var routeData = this.routeCache.get(subscription.id);
            if (null == routeData) {
                console.warn(`subscription to ${subscription.id} without route data can't be processed`);
                continue;
            }
            if (null != routeData.rbls) {
                possibleUpdates.push({ subscription, routeData });
            }
        }
        function onlyUnique(value, index, self) {
            return self.indexOf(value) === index;
        }
        if (!possibleUpdates.length) {
            return;
        }
        var rbls = possibleUpdates
            .map(u => u.routeData.rbls)
            .reduce(function (a, b) { return a.concat(b); })
            .filter(onlyUnique);
        let updates = await this.updateOTP(rbls);
        if (!updates || !updates.length) {
            console.warn(`no updates for rbls ${rbls}`);
        }
        else {
            await this.delay(1000);
            for (let update of possibleUpdates) {
                for (let itinerary of update.routeData.route.plan) {
                    let activeLeg = getActiveLeg(itinerary, new Date());
                    if (null == activeLeg) {
                         = await (await fetch(`${this.baseUrl}/otp/routers/${this.routerId}/plan?${update.routeData.query}`)).json();
                    }
                    else if (activeLeg.transitLeg) {

                    }
                }
                

                let comparison = compareRoute(update.routeData.route, refreshedRoute);
                if (comparison.type == "DIFFERENT" ||
                    (comparison.type == "TIMEDIFFERENCES" && comparison.t.some(diff =>
                        (diff.t > 5 * 60000) || (diff.t > MIN_DIFF_MS && diff.at < addMinutes(new Date(), 10))))) {
                    this.routeCache.set(update.subscription.id,
                        { ...update.routeData, route: refreshedRoute },
                        Math.round((+update.subscription.end - +new Date()) / 1000) + TTL_SECS);
                    await fetch(update.subscription.callbackUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(refreshedRoute)
                    });
                    console.log(`Called ${update.subscription.callbackUrl} for update on ${update.subscription.id}`);
                }
            }
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