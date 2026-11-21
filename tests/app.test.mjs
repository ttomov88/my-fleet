// Runs the real app in jsdom against an in-memory fake of the Supabase backend.
// npm test  (from the repo root, after npm install)
import { JSDOM } from "jsdom";
import fs from "node:fs";

// The app's own files are put inline so jsdom runs them; the Supabase library is replaced by a fake.
const root = new URL("../", import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), "utf8");
const html = read("index.html")
  .replace('<link rel="stylesheet" href="css/app.css" />', () => `<style>${read("css/app.css")}</style>`)
  .replace('<script src="vendor/supabase.js"></script>', "")
  .replace('<script src="js/i18n.js"></script>', () => `<script>${read("js/i18n.js")}</script>`)
  .replace('<script src="js/app.js"></script>', () => `<script>${read("js/app.js")}</script>`);
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };
const clone = x => JSON.parse(JSON.stringify(x));

// ---- fake server ----
const server = {
  users: { "ttomov88@gmail.com": { id: "u-owner", password: "secret123", fleet: "f1" }, "fam@x.com": { id: "u-fam", password: "secret123", fleet: "f1" } },
  allowed: { "new@x.com": null, "kid@x.com": "nobody@x.com" },
  fleets: { f1: { data: { vehicles: [] }, version: 1 } },
  history: [], members: {}, subs: {}, offline: false, pushes: [],
};
function makeClient(win) {
  let session = null;
  const listeners = [];
  const authStore = () => win.localStorage;
  const stored = authStore().getItem("fleetlog_auth");
  if (stored) session = JSON.parse(stored);
  const user = () => session && session.user;
  const fleetId = () => user() && Object.values(server.users).find(u => u.id === user().id).fleet;
  const res = (data, error = null) => Promise.resolve(server.offline ? { data: null, error: { message: "Failed to fetch" } } : { data: clone(data), error });
  function query(table) {
    const q = { filters: {}, op: "select" };
    const b = {
      select() { return b; }, order() { return b; }, limit(n) { q.limit = n; return b; },
      eq(k, v) { q.filters[k] = v; return b; },
      update(v) { q.op = "update"; q.value = v; return b; },
      delete() { q.op = "delete"; return b; },
      upsert(v) { q.op = "upsert"; q.value = v; return b; },
      maybeSingle() { q.single = true; return b; },
      then(r, j) { return run().then(r, j); },
    };
    function run() {
      if (server.offline) return res(null);
      if (!user()) return res(q.single ? null : []);
      if (table === "fleets") return res(server.fleets[fleetId()]);
      if (table === "fleet_history") return res(server.history.filter(h => h.fleet === fleetId()).slice().reverse().slice(0, q.limit || 30));
      if (table === "fleet_members") {
        if (q.op === "update") { server.members[user().id] = q.value.settings; return res(null); }
        return res({ settings: server.members[user().id] || {} });
      }
      if (table === "push_subscriptions") {
        if (q.op === "upsert") { server.subs[q.value.endpoint] = { ...q.value, user: user().id }; return res(null); }
        if (q.op === "delete") { delete server.subs[q.filters.endpoint]; return res(null); }
      }
      return res(null);
    }
    return b;
  }
  return {
    from: query,
    async rpc(name, args) {
      if (server.offline) return { data: null, error: { message: "Failed to fetch" } };
      const f = server.fleets[fleetId()];
      if (!Array.isArray(args.new_data.vehicles)) return { data: null, error: { message: "bad_data" } };
      if (args.base_version !== f.version) return { data: [{ ok: false, version: f.version, data: clone(f.data) }], error: null };
      f.data = clone(args.new_data); f.version++;
      server.history.push({ fleet: fleetId(), data: clone(f.data), created_at: new Date(Date.now() + server.history.length * 60000).toISOString() });
      return { data: [{ ok: true, version: f.version, data: clone(f.data) }], error: null };
    },
    auth: {
      async getSession() { return { data: { session } }; },
      async signInWithPassword({ email, password }) {
        if (server.offline) return { data: {}, error: { message: "Failed to fetch" } };
        const u = server.users[email];
        if (!u || u.password !== password) return { data: {}, error: { message: "Invalid login credentials" } };
        session = { access_token: "tok-" + u.id, user: { id: u.id, email } };
        authStore().setItem("fleetlog_auth", JSON.stringify(session));
        return { data: { session, user: session.user }, error: null };
      },
      async signOut() { session = null; authStore().removeItem("fleetlog_auth"); listeners.forEach(l => l("SIGNED_OUT", null)); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
  };
}
function fakeFetch(url, opts) {
  const body = JSON.parse(opts.body);
  let out = {}, status = 200;
  if (body.action === "register") {
    const e = body.email;
    if (body.password.length < 8) { out = { error: "weak_password" }; status = 400; }
    else if (server.users[e]) { out = { error: "already_registered" }; status = 409; }
    else if (!(e in server.allowed)) { out = { error: "not_allowed" }; status = 403; }
    else if (server.allowed[e]) { out = { error: "join_first", join: server.allowed[e] }; status = 409; }
    else { server.users[e] = { id: "u-" + e, password: body.password, fleet: "f-" + e }; server.fleets["f-" + e] = { data: { vehicles: [] }, version: 1 }; out = { ok: true }; }
  } else if (body.action === "publicKey") out = { publicKey: "BIW_2JTwPKAJnOdmfNMR71l4rsWqGLmc4Q3f95Hk4RUY6t2yZPkhxe1usdKzB0tgPTo_Xm6kT4Fdg6VE9fejZ9o" };
  else if (body.action === "test") {
    const uid = opts.headers.Authorization.replace("Bearer tok-", "");
    const phones = Object.values(server.subs).filter(s => s.user === uid).length;
    server.pushes.push(uid); out = { phones, sent: phones, failed: 0 };
  }
  return Promise.resolve({ ok: status < 300, status, json: async () => out });
}

function phone(localData, opts = {}) {
  const dom = new JSDOM(html, {
    url: "https://ttomov88.github.io/fleet-log/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(win) {
      win.localStorage.setItem("fleetlog_settings_v1", JSON.stringify({ lang: opts.lang || "en" }));   // tests read English text
      if (localData) win.localStorage.setItem("fleetlog_v1", JSON.stringify(localData));
      if (opts.session) win.localStorage.setItem("fleetlog_auth", JSON.stringify(opts.session));
      if (opts.sync) win.localStorage.setItem("fleetlog_sync_v1", JSON.stringify(opts.sync));
      win.supabase = { createClient: () => makeClient(win) };
      win.fetch = fakeFetch;
      // The app's own question sheet: answer it automatically (yes unless opts.confirm === false).
      win.addEventListener("DOMContentLoaded", () => {
        new win.MutationObserver(() => {
          const o = win.document.getElementById("confirmOverlay");
          if (o && o.classList.contains("open")) setTimeout(() => win.document.getElementById(opts.confirm === false ? "confirmCancel" : "confirmOk").click(), 0);
        }).observe(win.document.getElementById("confirmOverlay"), { attributes: true });
      });
      win.matchMedia = () => ({ matches: false, addEventListener() {} });
      win.scrollTo = () => {};
      // fake push support
      const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/" + Math.random(), options: { applicationServerKey: null },
        toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } }; }, async unsubscribe() { reg._sub = null; return true; } };
      const reg = { _sub: null, pushManager: { async getSubscription() { return reg._sub; }, async subscribe() { reg._sub = sub; return sub; } } };
      Object.defineProperty(win.navigator, "serviceWorker", { value: { register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg, addEventListener() {} } });
      win.PushManager = function () {};
      win.Notification = { permission: "default", requestPermission: async () => (win.Notification.permission = "granted") };
    },
  });
  return dom.window;
}
const $ = (w, id) => w.document.getElementById(id);
async function login(w, email, pw, register) {
  $(w, "loginEmail").value = email; $(w, "loginPassword").value = pw;
  if (register) $(w, "registerBtn").click(); else $(w, "loginForm").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await wait(50);
}
const veh = (id, name, items = {}) => ({ id, name, type: "sedan", registration: "", vin: "", note: "", items: { maintenance: [], insurance: [], inspection: [], ...items } });
const ev = (id, label, dueDate) => ({ id, label, dueDate, lastDate: null, notes: "", done: false });

console.log("Login screen & first upload");
const legacy = { vehicles: [veh("v1", "Golf", { insurance: [ev("e1", "Civil liability", "2026-12-01")] })] };
const A = phone(legacy);
await wait(20);
ok(!$(A, "loginScreen").hidden, "logged-out phone shows the login screen");
ok($(A, "main").textContent.includes("Golf"), "existing phone data still visible behind it");
await login(A, "ttomov88@gmail.com", "wrong-pass");
ok($(A, "loginMsg").textContent === "Wrong email or password", "wrong password message");
await login(A, "ttomov88@gmail.com", "secret123");
ok($(A, "loginScreen").hidden, "login hides the screen");
await wait(800);
ok(server.fleets.f1.data.vehicles[0]?.name === "Golf", "phone data uploaded to the empty account");
ok(JSON.parse(A.localStorage.getItem("fleetlog_sync_v1")).dirty === false, "nothing left to sync");
ok(A.localStorage.getItem("fleetlog_restore_points") === null, "old on-phone restore points removed");

console.log("Register errors");
const R = phone(null);
await wait(20);
await login(R, "stranger@x.com", "longenough", true);
ok($(R, "loginMsg").textContent === "This email isn't on the invite list", "not invited");
await login(R, "new@x.com", "short", true);
ok($(R, "loginMsg").textContent.includes("8 characters"), "short password");
await login(R, "kid@x.com", "longenough", true);
ok($(R, "loginMsg").textContent === "nobody@x.com needs to create an account first", "join first");
await login(R, "ttomov88@gmail.com", "longenough", true);
ok($(R, "loginMsg").textContent.includes("already has an account"), "already registered");
await login(R, "new@x.com", "longenough", true);
await wait(50);
ok($(R, "loginScreen").hidden && JSON.parse(R.localStorage.getItem("fleetlog_sync_v1")).userId === "u-new@x.com", "new account created and logged in");

console.log("Family member sees the same data");
const B = phone(null);
await wait(20);
await login(B, "fam@x.com", "secret123");
await wait(50);
ok($(B, "main").textContent.includes("Golf"), "family phone shows the shared vehicle");

console.log("Simultaneous edits are combined");
// A renames the event; B (offline) adds a new event and a vehicle, then comes back online.
server.offline = true;
B.eval(`state.data.vehicles[0].items.maintenance.push({id:"e2",label:"Oil change",dueDate:"2027-01-10",lastDate:null,notes:"",done:false}); state.data.vehicles.push(${JSON.stringify(veh("v2", "Vespa"))}); saveData();`);
await wait(800);
ok(JSON.parse(B.localStorage.getItem("fleetlog_sync_v1")).dirty === true, "offline change kept on the phone");
B.eval(`updateAccountInfo()`);
ok($(B, "accountInfo").textContent.includes("wait for internet"), "settings say changes are waiting");
server.offline = false;
A.eval(`state.data.vehicles[0].items.insurance[0].label = "Civil liability 2027"; saveData();`);
await wait(800);
B.dispatchEvent(new B.Event("online"));
await wait(100);
const d = server.fleets.f1.data;
ok(d.vehicles.length === 2 && d.vehicles[1].name === "Vespa", "B's new vehicle in the account");
ok(d.vehicles[0].items.insurance[0].label === "Civil liability 2027", "A's rename kept");
ok(d.vehicles[0].items.maintenance[0]?.label === "Oil change", "B's new event kept");
A.document.dispatchEvent(new A.Event("visibilitychange"));
await wait(100);
ok($(A, "main").textContent.includes("Vespa"), "A picks up B's changes when reopened");

console.log("Delete on one phone, edit on the other");
A.eval(`state.data.vehicles = state.data.vehicles.filter(v => v.id !== "v2"); saveData();`);
await wait(800);
B.eval(`state.data.vehicles[0].note = "Garage key in drawer"; saveData();`);
await wait(800);
ok(server.fleets.f1.data.vehicles.length === 1 && server.fleets.f1.data.vehicles[0].note === "Garage key in drawer", "deleted vehicle stays deleted, other edit kept");
B.document.dispatchEvent(new B.Event("visibilitychange")); await wait(50);
A.document.dispatchEvent(new A.Event("visibilitychange")); await wait(50);
ok(A.eval("canon(state.data)") === B.eval("canon(state.data)") && A.eval("canon(state.data)") === A.eval(`canon(${JSON.stringify(server.fleets.f1.data)})`), "both phones identical to the account");

console.log("Merge unit cases");
const m = (b, l, r) => JSON.parse(A.eval(`JSON.stringify(mergeData(${JSON.stringify(b)}, ${JSON.stringify(l)}, ${JSON.stringify(r)}))`));
const base = { vehicles: [veh("a", "A"), veh("b", "B"), veh("c", "C")] };
let r1 = m(base, { vehicles: [veh("c", "C"), veh("a", "A"), veh("b", "B")] }, { vehicles: [veh("a", "A2"), veh("b", "B"), veh("c", "C"), veh("d", "D")] });
ok(r1.vehicles.map(v => v.id + v.name).join() === "cC,aA2,bB,dD", "local reorder + remote rename + remote add");
let r2 = m(base, { vehicles: [veh("a", "A"), veh("b", "Bx"), veh("c", "C")] }, { vehicles: [veh("a", "A"), veh("c", "C")] });
ok(r2.vehicles.map(v => v.id).sort().join() === "a,b,c", "edited here while deleted elsewhere: kept");
let r3 = m(base, { vehicles: [veh("a", "A"), veh("c", "C")] }, base);
ok(r3.vehicles.map(v => v.id).join() === "a,c", "deleted here, untouched elsewhere: deleted");

console.log("Restore points from the account");
A.eval(`document.getElementById("settingsBtn").click()`);
$(A, "restoreBtn").click(); await wait(50);
const items = A.document.querySelectorAll("#restoreList .restore-item");
ok(items.length >= 4 && items[0].disabled && items[0].textContent.includes("now"), "list shows account versions, newest marked now");
items[items.length - 1].click(); await wait(900);
ok(server.fleets.f1.data.vehicles[0].items.insurance[0].label === "Civil liability", "restore goes back and is saved to the account");

console.log("Notifications");
A.eval(`document.getElementById("settingsBtn").click()`);
const t = $(A, "notifToggle"); t.checked = true; t.dispatchEvent(new A.Event("change")); await wait(50);
ok(Object.values(server.subs).some(s => s.user === "u-owner"), "turning on stores this phone's subscription");
$(A, "testNotifBtn").click(); await wait(50);
ok(server.pushes.includes("u-owner") && $(A, "toast").textContent.startsWith("Sent to 1 phone"), "test notification sent");
$(A, "leadDays").value = "14"; $(A, "leadDays").dispatchEvent(new A.Event("change")); await wait(20);
ok(server.members["u-owner"].leadDays === 14, "Remind me stored with the account");
ok(!A.document.body.innerHTML.includes("autoBackupToggle"), "Auto-backup row removed");

console.log("Offline start with a saved login");
const sess = JSON.parse(A.localStorage.getItem("fleetlog_auth"));
const syncState = JSON.parse(A.localStorage.getItem("fleetlog_sync_v1"));
server.offline = true;
const C = phone(JSON.parse(A.localStorage.getItem("fleetlog_v1")), { session: sess, sync: syncState });
await wait(50);
ok($(C, "loginScreen").hidden && $(C, "main").textContent.includes("Golf"), "opens straight into the data while offline");
server.offline = false;

console.log("Log out");
$(A, "logoutBtn").click(); await wait(50);
ok(!$(A, "loginScreen").hidden, "login screen shown");
ok(JSON.parse(A.localStorage.getItem("fleetlog_v1")).vehicles.length === 0, "data removed from the phone");
ok(!Object.values(server.subs).some(s => s.user === "u-owner"), "phone no longer gets notifications");
ok(server.fleets.f1.data.vehicles.length === 1, "account data untouched");


console.log("Review fixes");
{
  const P = phone(null);
  await wait(20);
  await login(P, "fam@x.com", "secret123");
  await wait(50);
  const soonIn = d => { const t = new Date(); t.setDate(t.getDate() + d); return P.eval(`localISO(new Date(${t.getTime()}))`); };
  P.eval(`state.data.vehicles[0].items.maintenance = [{id:"s1",label:"Soon",dueDate:"${soonIn(20)}",lastDate:null,notes:"",done:false}]; state.activeVehicleId = state.data.vehicles[0].id; render();`);
  ok(P.document.querySelector(".row-value").classList.contains("v-amber"), "20 days away is amber with Remind me = 30");
  P.eval(`document.getElementById("settingsBtn").click()`);
  $(P, "leadDays").value = "14"; $(P, "leadDays").dispatchEvent(new P.Event("change")); await wait(20);
  ok(P.document.querySelector(".row-value").classList.contains("v-green"), "same event turns green with Remind me = 14");
  // event deleted on another phone while open here
  P.eval(`document.getElementById("settingsClose").click()`); await wait(20);
  P.eval(`openItemModal(state.activeVehicleId, "maintenance", "s1"); state.data.vehicles[0].items.maintenance = [];`);
  let crashed = false;
  try { $(P, "itemDelete").click(); } catch (e) { crashed = true; }
  ok(!crashed && $(P, "toast").textContent === "This was deleted on another phone", "deleting an event removed elsewhere doesn't crash");
  // notifications blocked in phone settings
  const t2 = $(P, "notifToggle"); P.eval(`document.getElementById("settingsBtn").click()`);
  t2.checked = true; t2.dispatchEvent(new P.Event("change")); await wait(50);
  ok(P.eval("state.settings.notifications") === true, "notifications on");
  P.Notification.permission = "denied";
  P.document.dispatchEvent(new P.Event("visibilitychange")); await wait(50);
  ok(P.eval("state.settings.notifications") === false && !t2.checked, "blocked in phone settings: switch turns off");
  ok(!Object.values(server.subs).some(s => s.user === "u-fam"), "and the server stops sending to it");
}

console.log("Redesign");
{
  const D = phone({ vehicles: [veh("d1", "Golf", { insurance: [ev("x1", "Casco", "2020-01-01")] }), veh("d2", "Vespa")] });
  await wait(20);
  await login(D, "new@x.com", "longenough");
  await wait(50);
  ok($(D, "main").querySelector(".hero-big").textContent === "1 overdue", "summary card counts overdue events");
  D.document.querySelector(".hero").click(); await wait(20);
  const rows = D.document.querySelectorAll("#attentionList .row");
  ok(rows.length === 1 && rows[0].textContent.includes("Casco"), "tapping it lists what needs attention");
  rows[0].click(); await wait(20);
  ok($(D, "itemOverlay").classList.contains("open") && $(D, "itemLabel").value === "Casco" && !$(D, "backBtn").hidden, "a row opens that event on its vehicle page");
  D.eval(`document.getElementById("settingsBtn").click()`);
  D.document.querySelector('#themeSeg [data-theme="dark"]').click();
  ok(D.document.documentElement.dataset.theme === "dark" && JSON.parse(D.localStorage.getItem("fleetlog_settings_v1")).theme === "dark", "dark theme applied and remembered");
  D.document.querySelector('#themeSeg [data-theme="auto"]').click();
  ok(!D.document.documentElement.dataset.theme, "auto follows the phone");
  ok($(D, "avatarInitial").textContent === "N", "avatar shows the account initial");
}

console.log("Bulgarian");
{
  const G = phone({ vehicles: [veh("g1", "Голф", { insurance: [ev("y1", "Каско", "2020-01-01")] })] }, { lang: "bg" });
  await wait(20);
  ok($(G, "loginBtn").textContent === "Вход" && $(G, "registerBtn").textContent === "Създай профил" && G.document.documentElement.lang === "bg", "login screen in Bulgarian");
  await login(G, "ttomov88@gmail.com", "wrong-pass");
  ok($(G, "loginMsg").textContent === "Грешен имейл или парола", "errors in Bulgarian");
  $(G, "loginLang").click();
  ok($(G, "loginBtn").textContent === "Log in", "login screen can switch to English");
  $(G, "loginLang").click();
  const fresh = phone({ vehicles: [veh("g1", "Голф", { insurance: [ev("y1", "Каско", "2020-01-01")] })] });
  fresh.localStorage.removeItem("fleetlog_settings_v1");
  await wait(10);
  const H = phone({ vehicles: [veh("g1", "Голф", { insurance: [ev("y1", "Каско", "2020-01-01")] })] }, { lang: "bg" });
  await wait(20);
  await login(H, "fam@x.com", "secret123"); await wait(50);
  const hero = H.document.querySelector(".hero-big");
  ok(hero && /просроч/.test(hero.textContent), "home summary in Bulgarian", hero && hero.textContent);
  H.eval(`document.getElementById("settingsBtn").click()`);
  ok(H.document.querySelector('[data-i18n="notifications"]').textContent === "Известия", "settings in Bulgarian");
  ok(server.members["u-fam"] && server.members["u-fam"].lang === "bg", "server told to write reminders in Bulgarian");
  H.document.querySelector('#langSeg [data-lang="en"]').click(); await wait(20);
  ok(H.document.querySelector('[data-i18n="notifications"]').textContent === "Notifications" && server.members["u-fam"].lang === "en", "switching to English changes the app and the reminders");
}
{
  // A brand-new phone with nothing saved starts in Bulgarian.
  const dom = new JSDOM(html, { url: "https://ttomov88.github.io/my-fleet/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(win) { win.supabase = { createClient: () => makeClient(win) }; win.fetch = fakeFetch; win.matchMedia = () => ({ matches: false, addEventListener() {} }); win.scrollTo = () => {}; } });
  await wait(20);
  ok(dom.window.document.getElementById("loginBtn").textContent === "Вход", "Bulgarian is the default");
}

console.log("Second review");
{
  const S = phone({ vehicles: [veh("s1", "Golf")] });
  await wait(20);
  await login(S, "new@x.com", "longenough"); await wait(50);
  S.eval(`state.activeVehicleId = "s1"; render(); openItemModal("s1", "maintenance", null)`);
  $(S, "itemLabel").value = "Typed but not saved";
  $(S, "itemOverlay").dispatchEvent(new S.MouseEvent("click", { bubbles: true }));
  ok($(S, "itemOverlay").classList.contains("open") && $(S, "itemLabel").value === "Typed but not saved", "a stray tap outside the event form keeps what was typed");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
