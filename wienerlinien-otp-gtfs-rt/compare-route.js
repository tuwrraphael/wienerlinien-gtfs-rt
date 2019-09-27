const DIFFERENT = { type: "DIFFERENT" };
const EQUAL = { type: "EQUAL" };
const TIMEDIFFERENCE = function (t, at) {
    return { type: "TIMEDIFFERENCE", t, at };
}
const TIMEDIFFERENCES = function (t) {
    return { type: "TIMEDIFFERENCES", t };
}

function merge(comps) {
    var timedifferences = [];
    if (comps.some(l => l.type == DIFFERENT.type)) {
        return DIFFERENT;
    }
    comps.filter(l => l.type == TIMEDIFFERENCES(0).type)
        .forEach(l => l.t.forEach(d => timedifferences.push(d)));
    comps.filter(l => l.type == TIMEDIFFERENCE(0).type)
        .forEach(l => timedifferences.push(l));
    if (timedifferences.length > 0) {
        return TIMEDIFFERENCES(timedifferences);
    }
    return EQUAL;
}

function compareAndMerge(arr0, arr1, comparisonFn) {
    if (arr0.length != arr1.length) {
        return DIFFERENT;
    }
    var comps = [];
    for (let i = 0; i < arr0.length; i++) {
        comps.push(comparisonFn(arr0[i], arr1[i]));
    }
    return merge(comps);
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
    var diffs = [];
    if (0 != startTimeDiff) {
        diffs.push(TIMEDIFFERENCE(startTimeDiff, new Date(l1.startTime)));
    }
    if (0 != endTimeDiff) {
        diffs.push(TIMEDIFFERENCE(endTimeDiff, new Date(l1.endTime)));
    }
    if (diffs.length > 0) {
        return TIMEDIFFERENCES(diffs);
    }
    return EQUAL;
}

module.exports = function (r0, r1) {
    if (r0.plan && !r1.plan || r1.plan && !r0.plan) {
        return { overall: DIFFERENT };
    }
    if (r0.plan.itineraries.length != r1.plan.itineraries.length) {
        return { overall: DIFFERENT };
    }
    let comps = r0.plan.itineraries.map((it0, idx) => compareAndMerge(it0.legs, r1.plan.itineraries[idx].legs, compareLegs));
    return {
        overall: merge(comps),
        itineraries: comps
    };
}