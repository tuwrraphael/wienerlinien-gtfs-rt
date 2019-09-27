function getActiveLeg(itinerary, date) {
    var last = null;
    for(let leg of itinerary.legs) {
        if (itinerary.startTime >= +date) {
            last = leg;
        }
        if (itinerary.endTime <= +date) {
            break;
        }
    }
    return last;
}

module.exports = getActiveLeg;