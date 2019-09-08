const DIFFERENT = { type: "DIFFERENT" };
const EQUAL = { type: "EQUAL" };
const TIMEDIFFERENCE = function (t) {
    return { type: "TIMEDIFFERENCE", t };
}

function compareAndMerge(arr0, arr1, comparisonFn) {
    if (arr0.length != arr1.length) {
        return DIFFERENT;
    }
    var comps = [];
    for (let i = 0; i < arr0.length; i++) {
        comps.push(comparisonFn(arr0[i], arr1[i]));
    }
    if (comps.some(l => l.type == DIFFERENT.type)) {
        return DIFFERENT;
    }
    if (comps.some(l => l.type == TIMEDIFFERENCE(0).type)) {
        return TIMEDIFFERENCE(
            comps
                .filter(v => v.type == TIMEDIFFERENCE(0).type)
                .map(v => v.t)
                .reduce((a, b) => Math.abs(a) + Math.abs(b), 0)
        );
    }
    return EQUAL;
}

function compareLegs(l0, l1) {
    if (l0.mode != l1.mode) {
        return DIFFERENT;
    }
    if (!l0.transitLeg) {
        return EQUAL;
    }
    if (l0.tripId != l1.tripId || l0.routeId != l1.routeId) {
        return DIFFERENT;
    }
    var startTimeDiff = Math.abs(l0.startTime - l1.startTime);
    var endTimeDiff = Math.abs(l0.endTime - l1.endTime);
    if (0 != startTimeDiff || 0 != endTimeDiff) {
        return TIMEDIFFERENCE(Math.max(startTimeDiff, endTimeDiff));
    }
    return EQUAL;
}

function compareItinerary(it0, it1) {
    return compareAndMerge(it0.legs, it1.legs, compareLegs);
}

module.exports = function (r0, r1) {
    if (r0.plan && !r1.plan || r1.plan && !r0.plan) {
        return DIFFERENT;
    }
    return compareAndMerge(r0.plan.itineraries, r1.plan.itineraries, compareItinerary);
}