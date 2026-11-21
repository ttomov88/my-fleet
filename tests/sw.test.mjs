// The service worker, run in a sandbox with fake browser parts.
import fs from "node:fs";
import vm from "node:vm";
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); };

const code = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const listeners = {}, deleted = [], shown = [];
const self = {
  location: { origin: "https://ttomov88.github.io" },
  addEventListener: (type, fn) => { listeners[type] = fn; },
  skipWaiting() {}, clients: { claim() {}, matchAll: async () => [], openWindow: async () => {} },
  registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
};
const caches = {
  keys: async () => ["fleet-log-v1", "fleet-log-v8", "fast-track-v3", "poker-v2", vm.runInNewContext(code + ";CACHE_NAME", { self: { addEventListener() {} }, caches: {} })],
  delete: async (k) => { deleted.push(k); return true; },
};
vm.runInNewContext(code, { self, caches, URL, Request: class { constructor(u) { this.url = u; } }, fetch: async () => ({}), Response: { error: () => "error" } });

let waits = [];
const ev = (extra) => ({ waitUntil: (p) => waits.push(p), ...extra });
listeners.activate(ev()); await Promise.all(waits); waits = [];
ok(deleted.includes("fleet-log-v1") && deleted.includes("fleet-log-v8"), "old My Fleet caches are removed");
ok(!deleted.includes("fast-track-v3") && !deleted.includes("poker-v2"), "other apps' caches on the same site are left alone");

listeners.push(ev({ data: { json: () => ({ title: "My Fleet: просрочени събития", body: "Golf: Каско (просрочено с 2 д.)", tag: "fleet-log-due" }) } }));
await Promise.all(waits); waits = [];
ok(shown[0] && shown[0].title === "My Fleet: просрочени събития" && shown[0].tag === "fleet-log-due" && shown[0].renotify === true && shown[0].icon, "a reminder push shows a notification");
listeners.push(ev({ data: { json: () => { throw new Error("not json"); }, text: () => "plain" } }));
await Promise.all(waits);
ok(shown[1] && shown[1].title === "My Fleet" && shown[1].body === "plain", "a malformed push still shows something");

let responded = false;
listeners.fetch({ request: { method: "GET", url: "https://lsyihonmzxpjnmiueqgp.supabase.co/rest/v1/fleets", mode: "cors", destination: "" }, respondWith: () => { responded = true; } });
ok(!responded, "account data requests are never cached");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
