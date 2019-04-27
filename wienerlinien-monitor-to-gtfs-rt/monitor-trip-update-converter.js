class MonitorTripUpdateConverter {
    constructor(findTripsFromMonitorInfo, getStopTimesForTrip) {
        this.findTripsFromMonitorInfo = findTripsFromMonitorInfo;
        this.getStopTimesForTrip = getStopTimesForTrip;
        this.pastUpdates = {};
    }

    groupBy(xs, key) {
        return xs.reduce(function (rv, x) {
            (rv[x[key]] = rv[x[key]] || []).push(x);
            return rv;
        }, {});
    };

    gropMonitorLines(monitorLines) {
        let lines = {};
        for (let line of monitorLines) {
            if (!line.departures.departure) {
                continue;
            }
            line.departures.departure
                .filter(d => d.departureTime && (d.departureTime.timeReal || d.departureTime.timePlanned))
                .forEach(d => {
                    let lineName = d.vehicle && d.vehicle.name ? d.vehicle.name : line.name;
                    let towards = d.vehicle && d.vehicle.towards ? d.vehicle.towards : line.towards;
                    let direction = d.vehicle && d.vehicle.direction ? d.vehicle.direction : line.direction;
                    if (null == lines[lineName]) {
                        lines[lineName] = {};
                    }
                    if (null == lines[lineName][towards]) {
                        lines[lineName][towards] = { departures: [], direction: direction };
                    }
                    lines[lineName][towards].departures.push(d);
                });
        }
        return lines;
    }

    mergeUpdates(stopTimes, rtStopTimes) {
        let updates = {};
        let lastRtStopTime = null;
        let lastStopTime = null;
        let lastRtStopTimeIndex = null;
        let delay = null;
        for (let i = rtStopTimes.length - 1; i >= 0; i--) {
            let rtStopTime = rtStopTimes[i];
            let stopTime = stopTimes.find(s => rtStopTime.stop.id == s.stopId);
            let stopTimeIndex = stopTimes.indexOf(stopTime);
            updates[rtStopTime.stop.id] = rtStopTime.realtimeDeparture;
            delay = +rtStopTime.realtimeDeparture - +stopTime.scheduledDeparture;
            let following = stopTimes.filter((s, j) => j > stopTimeIndex);
            // adujst the delay to prevent non increasing stoptimes
            if (delay > 0 && null != lastRtStopTime) {
                let totalDelay = (+lastRtStopTime.realtimeDeparture - +rtStopTime.realtimeDeparture)
                    - (+lastStopTime.scheduledDeparture - +stopTime.scheduledDeparture);
                delay = Math.max(delay, totalDelay / (lastRtStopTimeIndex - stopTimeIndex));
            }
            for (let followingStopTime of following) {
                if (null != updates[followingStopTime.stopId]) {
                    break;
                }
                else {
                    updates[followingStopTime.stopId] = new Date(+followingStopTime.scheduledDeparture + delay);
                }
            }
            lastRtStopTime = rtStopTime;
            lastStopTime = stopTime;
            lastRtStopTimeIndex = stopTimeIndex;
        }
        if (lastRtStopTimeIndex > 0) {
            let adjustNonIncreasingIfEarly = 0;
            if (delay < 0) {
                adjustNonIncreasingIfEarly = delay / (lastRtStopTimeIndex);
            }
            for (let i = 0; i < lastRtStopTimeIndex; i++) {
                let stopTime = stopTimes[i];
                updates[stopTime.stopId] = new Date(+stopTime.scheduledDeparture + adjustNonIncreasingIfEarly);
            }
        }
        return stopTimes.map(s => { return { stopId: s.stopId, time: updates[s.stopId] }; });
    }

    checkIncreasing(rtStopTimes) {
        let last = 0;
        for (let time of rtStopTimes) {
            if (last >= +time.realtimeDeparture) {
                return false;
            }
            last = +time.realtimeDeparture;
        }
        return true;
    }

    checkUpdatesIncreasing(updates) {
        let last = 0;
        for (let time of updates) {
            if (last > +time.time) {
                return false;
            }
            last = +time.time;
        }
        return true;
    }

    async getTripUpdates(monitorResponse) {
        var matchingTrips = [];
        for (let monitor of monitorResponse.data.monitors) {
            let lines = this.gropMonitorLines(monitor.lines);
            for (let line in lines) {
                for (let towards in lines[line]) {
                    var matches = await this.findTripsFromMonitorInfo(lines[line][towards].departures,
                        {
                            name: line,
                            towards: towards,
                            direction: lines[line][towards].direction
                        }, monitor);
                    if (null != matches && matches.length > 0) {
                        for (let info of matches) {
                            matchingTrips.push(info);
                        }
                    }
                }
            }
        }
        var trip_updates = [];
        let trips = this.groupBy(matchingTrips, "tripId");
        for (let tripId in trips) {
            let otherPastUpdates = (this.pastUpdates[tripId] || []).filter(p => !trips[tripId].some(s => s.stop.id == p.stop.id));
            let tripUpdates = [...new Set([...trips[tripId], ...otherPastUpdates])];
            let stoptimes = await this.getStopTimesForTrip(tripId);
            var rtStopTimes = tripUpdates.map(rt => {
                return {
                    ...rt,
                    realtimeDeparture: new Date(rt.departure.departureTime.timeReal || rt.departure.departureTime.timePlanned)
                }
            });
            let notFoundStop = rtStopTimes.find(v => !stoptimes.some(d => d.stopId == v.stop.id));
            if (notFoundStop) {
                console.error(`stop ${notFoundStop.stop.id} does not belong to trip ${tripId}`);
                break;
            }
            let getStopIndex = rt => stoptimes.find(s => s.stopId == rt.stop.id).stopIndex;
            rtStopTimes = rtStopTimes.sort((a, b) => getStopIndex(a) - getStopIndex(b));
            if (!this.checkIncreasing(rtStopTimes)) {
                console.error(`rt stop times for trip ${tripId} are non increasing`);
                break;
            }
            let updates = this.mergeUpdates(stoptimes, rtStopTimes);
            if (!this.checkUpdatesIncreasing(updates)) {
                console.error(`rt stop times for trip ${tripId} are non increasing`);
                break;
            }
            var u = {
                trip: {
                    tripId: tripId
                },
                stopTimeUpdate: updates.map(u => {
                    let time = Math.round(u.time.getTime() / 1000);
                    return {
                        stopId: u.stopId,
                        departure: {
                            time: time
                        },
                        arrival: {
                            time: time
                        },
                        delay: null,
                        scheduleRelationship: "SCHEDULED"
                    };
                })
            }
            trip_updates.push(u);
            this.pastUpdates[tripId] = tripUpdates;
        }
        return trip_updates;
    }
}
module.exports = MonitorTripUpdateConverter;