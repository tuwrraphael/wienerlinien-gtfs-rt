class MonitorTripUpdateConverter {
    constructor(findTripsFromMonitorInfo, getStopTimesForTrip) {
        this.findTripsFromMonitorInfo = findTripsFromMonitorInfo;
        this.getStopTimesForTrip = getStopTimesForTrip;
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

    driveDistribution(startTime, followingStopList) {
        if (!followingStopList.length) {
            return [];
        }
        let drives = [];
        for (let stop of followingStopList) {
            drives.push(stop.scheduledDeparture - startTime);
            startTime = stop.scheduledDeparture;
        }
        let totalTime = drives.reduce((a, b) => a + b, 0);
        return drives.map(d => d / totalTime);
    }

    mergeUpdates(stopTimes, rtStopTimes) {
        let updates = {};
        let lastRtStopTimeIndex = null;
        let lastRtStopTime = null;
        let delay, lastDelay = null;
        for (let i = rtStopTimes.length - 1; i >= 0; i--) {
            let rtStopTime = rtStopTimes[i];
            let stopTime = stopTimes.find(s => rtStopTime.stop.id == s.stopId);
            let stopTimeIndex = stopTimes.indexOf(stopTime);
            updates[rtStopTime.stop.id] = rtStopTime.realtimeDeparture;
            delay = +rtStopTime.realtimeDeparture - +stopTime.scheduledDeparture;
            let following = stopTimes.filter((s, j) => j > stopTimeIndex);
            if (null == lastRtStopTime) {
                for (let followingStopTime of following) {
                    if (null != updates[followingStopTime.stopId]) {
                        break;
                    } else {
                        updates[followingStopTime.stopId] = new Date(+followingStopTime.scheduledDeparture + delay);
                    }
                }
            }
            else {
                let totalDriveTime = lastRtStopTime - rtStopTime.realtimeDeparture;
                let dist = this.driveDistribution(stopTime.scheduledDeparture, following);
                let time = +rtStopTime.realtimeDeparture;
                for (let j = 0; j < following.length; j++) {
                    let followingStopTime = following[j];
                    time += dist[j] * totalDriveTime;
                    if (null != updates[followingStopTime.stopId]) {
                        break;
                    } else {
                        updates[followingStopTime.stopId] = new Date(time);
                    }
                }
            }
            lastDelay = delay;
            lastRtStopTimeIndex = stopTimeIndex;
            lastRtStopTime = rtStopTime.realtimeDeparture;
        }
        if (lastRtStopTimeIndex > 0) {
            for (let i = lastRtStopTimeIndex - 1; i >= 0; i--) {
                let adjust = 0;
                let stopTime = stopTimes[i];
                if (delay < 0) {
                    let timeAtFollowingStation = updates[stopTimes[i + 1].stopId];
                    let minAdjust = timeAtFollowingStation - stopTime.scheduledDeparture;
                    adjust = Math.min(minAdjust, delay / (i + 1));
                    delay -= adjust;
                }
                updates[stopTime.stopId] = new Date(+stopTime.scheduledDeparture + adjust);
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
            let tripUpdates = trips[tripId];
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
                continue;
            }
            let getStopIndex = rt => stoptimes.find(s => s.stopId == rt.stop.id).stopIndex;
            rtStopTimes = rtStopTimes.sort((a, b) => getStopIndex(a) - getStopIndex(b));
            if (!this.checkIncreasing(rtStopTimes)) {
                console.error(`rt stop times for trip ${tripId} are non increasing`);
                continue;
            }
            let updates = this.mergeUpdates(stoptimes, rtStopTimes);
            if (!this.checkUpdatesIncreasing(updates)) {
                console.error(`updates times for trip ${tripId} are non increasing`);
                continue;
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
        }
        return trip_updates;
    }
}
module.exports = MonitorTripUpdateConverter;