function updateStop(stopinLeg, update) {
    let stopTimeUpdate = update.stopTimeUpdate.find(u => u.stopId == stopinLeg.stopId);
    let departure = stopTimeUpdate.departure.time * 1000;
    let arrival = stopTimeUpdate.arrival.time * 1000;
    let diffs = [{
        diff: Math.abs(departure - stopinLeg.departure),
        at: departure
    },
    {
        diff: Math.abs(arrival - stopinLeg.arrival),
        at: arrival
    }]
    stopinLeg.departure = departure;
    stopinLeg.arrival = arrival;
    return diffs;
}

function updateRoute(route, updates) {
    route = JSON.parse(JSON.stringify(route));
    let diffs = new Array(route.plan.itineraries).map(() => []);
    route.plan.itineraries.forEach((itinerary, idx) => {
        for (let leg of itinerary.legs) {
            if (!leg.transitLeg) {
                continue;
            }
            let update = updates.find(u => u.trip.tripId == leg.tripId);
            if (null != update) {
                updateStop(route.to, update).forEach(d => diffs[idx].push(d));
                updateStop(route.from, update).forEach(d => diffs[idx].push(d));
                leg.startTime = route.from.departure;
                leg.endTime = route.to.arrival;
                leg.duration = Math.round((leg.endTime - leg.startTime) / 1000);
                // TODO arrivalDelay, departureDelay
            }
        }
    });
    for (let itinerary of route.plan.itineraries) {
        itinerary.legs.forEach((leg, idx) => {
            
        });
    }
    return diffs;
}

module.exports = updateRoute;
