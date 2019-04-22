# Get the RBL if available from GTFS trip_id and stop_id
The RBL-Nummer is required to query realtime public transport information using the [Wiener Linien Echtzeitdaten](https://www.data.gv.at/katalog/dataset/stadt-wien_wienerlinienechtzeitdaten).
However, when using the [GTFS data](https://www.data.gv.at/katalog/dataset/wiener-linien-fahrplandaten-gtfs-wien), the RBL-Nummer is not provided. 
## Example
~~~js
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
            var info = rblProvider.rblInfo("440.T2.22-10-j19-1.1.H", "at:49:597:0:8");
            console.log(info);
            // { 
            //   rbl: 565,
            //   linie: { id: '214433723', bezeichnung: '10', echtzeit: true },
            //   direction: 0 
            // }
        }
        catch (e) {
            console.error(e);
        }
    });
~~~