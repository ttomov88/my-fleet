// Which events a reminder should mention. Mirrors the app: an event is included when it is
// not marked Done, has a due date, and is overdue or due within the person's "Remind me" window.

const CATEGORIES = ["maintenance", "insurance", "inspection"];
const LEAD_CHOICES = [7, 14, 30];
// How many days before the due date each kind of event is reminded, unless the person changed it.
export const DEFAULT_LEAD: Record<string, number> = { maintenance: 30, insurance: 14, inspection: 30 };
export function leadOf(settings: any, cat: string): number {
  const v = Number(settings?.lead?.[cat]);
  return LEAD_CHOICES.includes(v) ? v : DEFAULT_LEAD[cat];
}

export interface DueEvent { id: string; vehicle: string; label: string; days: number }

// Today's date in a time zone, as YYYY-MM-DD, plus the hour (0-23).
export function localNow(timeZone: string, now = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

// leadDays: one number for every category, or a function giving it per category.
// snoozed: { eventId: "YYYY-MM-DD" } — the event is left out until that day.
export function dueEvents(data: unknown, todayISO: string, leadDays: number | ((cat: string) => number), snoozed: Record<string, string> = {}): DueEvent[] {
  const leadFor = typeof leadDays === "function" ? leadDays : () => leadDays;
  const out: DueEvent[] = [];
  const vehicles = (data && typeof data === "object" && Array.isArray((data as any).vehicles)) ? (data as any).vehicles : [];
  for (const v of vehicles) {
    if (!v || typeof v !== "object") continue;
    for (const cat of CATEGORIES) {
      const list = v.items && Array.isArray(v.items[cat]) ? v.items[cat] : [];
      for (const it of list) {
        if (!it || it.done === true || typeof it.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) continue;
        const days = daysBetween(todayISO, it.dueDate);
        const id = String(it.id ?? "");
        if (id && typeof snoozed[id] === "string" && snoozed[id] > todayISO) continue;
        if (days <= leadFor(cat)) out.push({ id, vehicle: String(v.name || "Vehicle"), label: String(it.label || "Event"), days });
      }
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

export type Lang = "bg" | "en";
export const langOf = (v: unknown): Lang => (v === "en" ? "en" : "bg");   // Bulgarian unless the person chose English

const TEXT = {
  en: {
    when: (d: number) => d < 0 ? `overdue ${-d}d` : d === 0 ? "today" : `${d}d left`,
    more: (n: number) => `+${n} more`,
    overdue: "My Fleet: overdue events", soon: "My Fleet: events due soon",
    test: "Test notification: reminders reach this phone.",
    snooze: "Snooze 3 days",
    snoozed: (d: string) => `Snoozed. Next reminder on ${d}.`,
    snoozeFailed: "Couldn't snooze. Open the app and try again.",
  },
  bg: {
    when: (d: number) => d < 0 ? `просрочено с ${-d} д.` : d === 0 ? "днес" : `остават ${d} д.`,
    more: (n: number) => `+ още ${n}`,
    overdue: "My Fleet: просрочени събития", soon: "My Fleet: предстоящи събития",
    test: "Тестово известие: напомнянията стигат до този телефон.",
    snooze: "Отложи 3 дни",
    snoozed: (d: string) => `Отложено. Следващо напомняне на ${d}.`,
    snoozeFailed: "Не успях да отложа. Отворете приложението и опитайте пак.",
  },
};

export function testMessage(lang: Lang = "bg"): string { return TEXT[lang].test; }

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
export const SNOOZE_DAYS = 3;
// The "Snooze 3 days" button on a reminder and the texts the phone shows after pressing it.
export function snoozeParts(due: DueEvent[], todayISO: string, lang: Lang = "bg") {
  const until = addDaysISO(todayISO, SNOOZE_DAYS);
  const shown = lang === "bg" ? `${until.slice(8, 10)}.${until.slice(5, 7)}.${until.slice(0, 4)}` : `${until.slice(8, 10)}/${until.slice(5, 7)}/${until.slice(0, 4)}`;
  return {
    actions: [{ action: "snooze", title: TEXT[lang].snooze }],
    snooze: { events: due.map(e => e.id).filter(Boolean).slice(0, 50), done: TEXT[lang].snoozed(shown), failed: TEXT[lang].snoozeFailed },
  };
}

export function reminderMessage(due: DueEvent[], lang: Lang = "bg"): { title: string; body: string } {
  const tx = TEXT[lang];
  const lines = due.slice(0, 3).map(e => `${e.vehicle}: ${e.label} (${tx.when(e.days)})`);
  if (due.length > 3) lines.push(tx.more(due.length - 3));
  return {
    title: due.some(e => e.days < 0) ? tx.overdue : tx.soon,
    body: lines.join("\n"),
  };
}
