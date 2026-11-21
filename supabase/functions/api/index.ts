// My Fleet server: account creation (allowlisted emails only), daily push reminders,
// and a test notification. Deployed as the Supabase Edge Function "api".
//
// POST { action: "register", email, password }  -> create account (no email is sent)
// POST { action: "publicKey" }                   -> key the phone needs to sign up for notifications
// POST { action: "test" }  (logged-in user)      -> send a test notification to that person's phones
// POST { action: "daily" } (x-cron-token header) -> the 08:00 reminder run, called by the scheduler
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKeys, sendPush, type Subscription, type VapidKeys } from "./webpush.ts";
import { dueEvents, localNow, reminderMessage } from "./reminders.ts";

const TIME_ZONE = "Europe/Sofia";
const REMINDER_HOUR = 8;
const LEAD_DAYS = [7, 14, 30];
const SUBJECT = "https://ttomov88.github.io/fleet-log/";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function configValues(keys: string[]): Promise<Record<string, string>> {
  const { data, error } = await admin.from("app_config").select("key, value").in("key", keys);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map(r => [r.key, r.value]));
}

// Notification keys are created once, on first use, and never leave the server (except the public half).
async function getVapid(): Promise<VapidKeys> {
  let cfg = await configValues(["vapid_private", "vapid_public"]);
  if (!cfg.vapid_private || !cfg.vapid_public) {
    const k = await generateVapidKeys();
    await admin.from("app_config").upsert([
      { key: "vapid_private", value: JSON.stringify(k.privateJwk) },
      { key: "vapid_public", value: k.publicKey },
    ], { onConflict: "key", ignoreDuplicates: true });
    cfg = await configValues(["vapid_private", "vapid_public"]);   // re-read: another request may have won the race
  }
  return { privateJwk: JSON.parse(cfg.vapid_private), publicKey: cfg.vapid_public };
}

async function pushToUser(userId: string, payload: unknown, vapid: VapidKeys) {
  const { data: subs, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
  if (error) throw error;
  let sent = 0, failed = 0;
  const problems: string[] = [];
  for (const s of (subs ?? []) as Subscription[]) {
    try {
      const r = await sendPush(s, payload, vapid, SUBJECT);
      if (r.ok) sent++;
      else {
        failed++;
        problems.push(`${r.status} ${r.detail ?? ""}`.trim());
        if (r.gone) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);   // phone unsubscribed / app removed
      }
    } catch (e) { failed++; problems.push(String(e).slice(0, 120)); }
  }
  return { phones: subs?.length ?? 0, sent, failed, problems };
}

async function register(body: any) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "weak_password" }, 400);

  const { data: allow, error: aErr } = await admin.from("allowed_emails").select("email, join_email").eq("email", email).maybeSingle();
  if (aErr) throw aErr;
  if (!allow) return json({ error: "not_allowed" }, 403);

  // A family member shares the fleet of the person named in join_email, who must register first.
  let fleetId: string | null = null;
  if (allow.join_email) {
    const { data, error } = await admin.rpc("fleet_of_email", { e: allow.join_email });
    if (error) throw error;
    if (!data) return json({ error: "join_first", join: allow.join_email }, 409);
    fleetId = data as string;
  }

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr || !created?.user) {
    if (/already/i.test(cErr?.message ?? "")) return json({ error: "already_registered" }, 409);
    throw cErr ?? new Error("create user failed");
  }
  const userId = created.user.id;
  try {
    if (!fleetId) {
      const { data: f, error } = await admin.from("fleets").insert({ updated_by: userId }).select("id").single();
      if (error) throw error;
      fleetId = f.id;
    }
    const { error: mErr } = await admin.from("fleet_members").insert({ user_id: userId, fleet_id: fleetId });
    if (mErr) throw mErr;
  } catch (e) {
    await admin.auth.admin.deleteUser(userId);   // keep things consistent: no account without a fleet
    throw e;
  }
  return json({ ok: true, shared: !!allow.join_email });
}

async function test(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return json({ error: "not_logged_in" }, 401);
  const result = await pushToUser(data.user.id, {
    title: "My Fleet", body: "Test notification: reminders reach this phone.", tag: "fleet-log-test",
  }, await getVapid());
  return json(result);
}

async function daily(req: Request, body: any) {
  const { cron_token } = await configValues(["cron_token"]);
  if (!cron_token || req.headers.get("x-cron-token") !== cron_token) return json({ error: "forbidden" }, 403);
  const force = body.force === true;
  const { date: today, hour } = localNow(TIME_ZONE);
  // The scheduler fires at 05:00 and 06:00 UTC; only the one that is 08:00 in Sofia (summer or winter) sends.
  if (hour !== REMINDER_HOUR && !force) return json({ skipped: true, sofiaHour: hour });

  const [{ data: members, error: mErr }, { data: fleets, error: fErr }] = await Promise.all([
    admin.from("fleet_members").select("user_id, fleet_id, settings, last_reminder_date"),
    admin.from("fleets").select("id, data"),
  ]);
  if (mErr) throw mErr;
  if (fErr) throw fErr;
  const fleetData = new Map((fleets ?? []).map(f => [f.id, f.data]));
  const vapid = await getVapid();
  const report: unknown[] = [];
  for (const m of members ?? []) {
    if (m.last_reminder_date === today && !force) continue;   // at most one reminder per person per day
    const lead = LEAD_DAYS.includes(Number(m.settings?.leadDays)) ? Number(m.settings.leadDays) : 30;
    const due = dueEvents(fleetData.get(m.fleet_id), today, lead);
    let result = null;
    if (due.length) result = await pushToUser(m.user_id, { ...reminderMessage(due), tag: "fleet-log-due" }, vapid);
    await admin.from("fleet_members").update({ last_reminder_date: today }).eq("user_id", m.user_id);
    report.push({ due: due.length, ...(result ?? {}) });
  }
  return json({ today, people: report.length, report });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "register": return await register(body);
      case "publicKey": return json({ publicKey: (await getVapid()).publicKey });
      case "test": return await test(req);
      case "daily": return await daily(req, body);
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});
