const RblProvider = require("./rbl-provider");

var options = {
    haltestellenCsv: "./wienerlinien-ogd-haltestellen.csv",
    steigeCsv: "./wienerlinien-ogd-steige.csv",
    linienCsv: "./wienerlinien-ogd-linien.csv",
    stopsCsv: "./stops.txt",
    routesCsv: "./routes.txt",
    tripsCsv: "./trips.txt"
};

var rblProvider = new RblProvider();
rblProvider.parse(options)
    .then(async () => {
        try {
            console.log(rblProvider.rblInfo("440.T2.22-10-j19-1.1.H", "at:49:597:0:8"));
        }
        catch (e) {
            console.error(e);
        }
    });