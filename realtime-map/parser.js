const fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
class Parser {

    parseHaltestellen(text) {
        var haltestellen = [];
        for (var line of text.split("\n")) {
            if (line.indexOf("HALTESTELLEN_ID") > 0 || !line.match(/\S/)) {
                continue;
            }
            var values = line.split(";");
            try {
                let h = {
                    id: values[0],
                    diva: values[2],
                    name: values[3].replace(/\"/g, ""),
                    lat: parseFloat(values[6]),
                    lng: parseFloat(values[7])
                };
                if (!isNaN(h.lat) && !isNaN(h.lng)) {
                    haltestellen.push(h);
                }
                else {
                    console.error(`Couldn't add haltestelle ${line}`);
                }
            }
            catch {
                console.error(`Couldn't add haltestelle ${line}`);
            }
        }
        return haltestellen;
    }

    parseLinien(text) {
        var linien = [];
        for (var line of text.split("\n")) {
            if (line.indexOf("LINIEN_ID") > 0 || !line.match(/\S/)) {
                continue;
            }
            var values = line.split(";");
            try {
                let h = {
                    id: values[0],
                    bezeichnung: values[1].replace(/\"/g, ""),
                    echtzeit: 1 === parseInt(values[3])
                };
                linien.push(h);
            }
            catch {
                console.error(`Couldn't add linie ${line}`);
            }
        }
        return linien;
    }

    parseSteige(text) {
        var steige = [];
        for (var line of text.split("\n")) {
            if (line.indexOf("STEIG_ID") > 0 || !line.match(/\S/)) {
                continue;
            }
            var values = line.split(";");
            try {
                var rbl = values[5].replace(/\"/g, "");
                var direction = values[3].replace(/\"/g, "");
                let h = {
                    id: values[0],
                    linienId: values[1],
                    haltestelleId: values[2],
                    rbl: rbl != "" ? parseInt(rbl) : null,
                    lat: parseFloat(values[8]),
                    lng: parseFloat(values[9]),
                    direction: direction === "H" ? 0 : direction === "R" ? 1 : null
                };
                if (!isNaN(h.lat) && !isNaN(h.lng) && (null == rbl || !isNaN(h.rbl)) && null != h.direction) {
                    steige.push(h);
                }
                else {
                    console.error(`Couldn't add steig ${line}`);
                }
            }
            catch {
                console.error(`Couldn't add steig ${line}`);
            }
        }
        return steige;
    }

    async parse(options) {
        var haltestellenStr = await readFile(options.haltestellenCsv, "utf8");
        var linienStr = await readFile(options.linienCsv, "utf8");
        var steigeStr = await readFile(options.steigeCsv, "utf8");

        this.haltestellen = this.parseHaltestellen(haltestellenStr);
        this.linien = this.parseLinien(linienStr);
        this.steige = this.parseSteige(steigeStr);
    }
}

module.exports = Parser;