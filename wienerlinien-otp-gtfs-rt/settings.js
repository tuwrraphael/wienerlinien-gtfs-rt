const OTPInstance = "";
const OTPRouterId = "wien";

let optOptions = {
    feedId: "1",
    baseUrl: OTPInstance,
    routerId: OTPRouterId
};

let wlOptions = {
    haltestellenCsv: "./wienerlinien-ogd-haltestellen.csv",
    steigeCsv: "./wienerlinien-ogd-steige.csv",
    linienCsv: "./wienerlinien-ogd-linien.csv",
    stopsCsv: "./stops.txt",
    routesCsv: "./routes.txt",
    tripsCsv: "./trips.txt",
    wlApiKey: ""
};

module.exports = {
    options: {
        ...optOptions,
        ...wlOptions
    },
    websocketPort: 3003,
    optProxyPort: 3002
};