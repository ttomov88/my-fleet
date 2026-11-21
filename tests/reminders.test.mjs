const r = await import(new URL("../supabase/functions/api/reminders.ts", import.meta.url).href);
let pass = 0, fail = 0; const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${x ? "  (" + x + ")" : ""}`); };
// Sofia time: 05:00 UTC in winter = 07:00, 06:00 UTC = 08:00; in summer 05:00 UTC = 08:00
ok(r.localNow("Europe/Sofia", new Date("2026-11-22T06:00:00Z")).hour === 8, "winter: 06:00 UTC is 08:00 in Sofia");
ok(r.localNow("Europe/Sofia", new Date("2026-11-22T05:00:00Z")).hour === 7, "winter: 05:00 UTC is 07:00 (skipped)");
ok(r.localNow("Europe/Sofia", new Date("2027-07-01T05:00:00Z")).hour === 8, "summer: 05:00 UTC is 08:00 in Sofia");
ok(r.localNow("Europe/Sofia", new Date("2026-11-21T22:30:00Z")).date === "2026-11-22", "date is Sofia's, not UTC's");
const data = { vehicles: [
  { name: "Toyota", items: { maintenance: [{ label: "Oil", dueDate: "2026-11-25" }, { label: "Done thing", dueDate: "2026-11-20", done: true }],
    insurance: [{ label: "Casco", dueDate: "2026-11-10" }], inspection: [{ label: "Far", dueDate: "2027-05-01" }, { label: "No date" }] } },
  { name: "Vespa", items: { maintenance: [{ label: "Tyres", dueDate: "2026-12-20" }, { label: "Bad", dueDate: "garbage" }] } },
  null, { items: null } ] };
const d30 = r.dueEvents(data, "2026-11-22", 30);
ok(JSON.stringify(d30.map(e => e.label)) === '["Casco","Oil","Tyres"]', "30-day window: overdue + soon, sorted; skips done/far/undated/bad", d30.map(e => e.label + ":" + e.days).join(" "));
ok(r.dueEvents(data, "2026-11-22", 7).length === 2, "7-day window drops Tyres (28d)");
ok(r.dueEvents(null, "2026-11-22", 30).length === 0 && r.dueEvents({}, "2026-11-22", 30).length === 0, "empty / missing data is safe");
const msg = r.reminderMessage(d30);
ok(msg.title === "My Fleet: overdue events" && msg.body === "Toyota: Casco (overdue 12d)\nToyota: Oil (3d left)\nVespa: Tyres (28d left)", "message text", JSON.stringify(msg));
ok(r.reminderMessage([{ vehicle: "A", label: "B", days: 0 }]).title === "My Fleet: events due soon" && /today/.test(r.reminderMessage([{ vehicle: "A", label: "B", days: 0 }]).body), "due today wording");
ok(/\+2 more$/.test(r.reminderMessage([0, 1, 2, 3, 4].map(i => ({ vehicle: "V", label: "E" + i, days: i }))).body), "more than 3 -> '+N more'");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
