// Before each release: node scripts/bump-version.mjs
// Raises the version in sw.js (cache name) and in index.html (?v= on css/js), so phones fetch
// the new files instead of a copy cached by the browser.
import fs from "node:fs";
const sw = fs.readFileSync("sw.js", "utf8");
const next = Number(sw.match(/fleet-log-v(\d+)/)[1]) + 1;
fs.writeFileSync("sw.js", sw.replace(/fleet-log-v\d+/, `fleet-log-v${next}`).replace(/\?v=\d+/g, `?v=${next}`));
const html = fs.readFileSync("index.html", "utf8");
fs.writeFileSync("index.html", html.replace(/\?v=\d+/g, `?v=${next}`));
console.log("version", next);
