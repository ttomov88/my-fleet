// Which events a reminder should mention. Mirrors the app: an event is included when it is
// not marked Done, has a due date, and is overdue or due within the person's "Remind me" window.

const CATEGORIES = ["maintenance", "insurance", "inspection"];

export interface DueEvent { vehicle: string; label: string; days: number }

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

export function dueEvents(data: unknown, todayISO: string, leadDays: number): DueEvent[] {
  const out: DueEvent[] = [];
  const vehicles = (data && typeof data === "object" && Array.isArray((data as any).vehicles)) ? (data as any).vehicles : [];
  for (const v of vehicles) {
    if (!v || typeof v !== "object") continue;
    for (const cat of CATEGORIES) {
      const list = v.items && Array.isArray(v.items[cat]) ? v.items[cat] : [];
      for (const it of list) {
        if (!it || it.done === true || typeof it.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) continue;
        const days = daysBetween(todayISO, it.dueDate);
        if (days <= leadDays) out.push({ vehicle: String(v.name || "Vehicle"), label: String(it.label || "Event"), days });
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
  },
  bg: {
    when: (d: number) => d < 0 ? `просрочено с ${-d} д.` : d === 0 ? "днес" : `остават ${d} д.`,
    more: (n: number) => `+ още ${n}`,
    overdue: "My Fleet: просрочени събития", soon: "My Fleet: предстоящи събития",
    test: "Тестово известие: напомнянията стигат до този телефон.",
  },
};

export function testMessage(lang: Lang = "bg"): string { return TEXT[lang].test; }

export function reminderMessage(due: DueEvent[], lang: Lang = "bg"): { title: string; body: string } {
  const tx = TEXT[lang];
  const lines = due.slice(0, 3).map(e => `${e.vehicle}: ${e.label} (${tx.when(e.days)})`);
  if (due.length > 3) lines.push(tx.more(due.length - 3));
  return {
    title: due.some(e => e.days < 0) ? tx.overdue : tx.soon,
    body: lines.join("\n"),
  };
}
