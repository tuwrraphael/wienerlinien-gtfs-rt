function detectRouteProblems(route) {

    for (let itinerary of route.plan.itineraries) {
        var timeBefore = null;
        itinerary.legs.forEach((leg, idx) => {
            if ()



            if (!leg.transitLeg) {
                continue;
            }
            let update = updates.find(u => u.trip.tripId == leg.tripId);
            if (null != update) {
                updateStop(route.to, update).forEach(d => diffs.push(d));
                updateStop(route.from, update).forEach(d => diffs.push(d));
                leg.startTime = route.from.departure;
                leg.endTime = route.to.arrival;
                leg.duration = Math.round((leg.endTime - leg.startTime) / 1000);
                // TODO arrivalDelay, departureDelay
            }
        })
    }
}