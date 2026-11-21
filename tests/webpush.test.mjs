import { createECDH, randomBytes, webcrypto } from "node:crypto";
import ece from "http_ece";
const wp = await import(new URL("../supabase/functions/api/webpush.ts", import.meta.url).href);
let pass = 0, fail = 0; const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${x ? "  (" + x + ")" : ""}`); };

// Simulate a browser subscription (receiver key pair + auth secret)
const ua = createECDH("prime256v1"); ua.generateKeys();
const authSecret = randomBytes(16);
const p256dh = wp.bytesToB64u(new Uint8Array(ua.getPublicKey()));
const auth = wp.bytesToB64u(new Uint8Array(authSecret));
for (const msg of ["hi", JSON.stringify({ title: "My Fleet: events due soon", body: "Тойота: Каско (5d left)\n".repeat(20) })]) {
  const body = await wp.encryptPayload(new TextEncoder().encode(msg), p256dh, auth);
  const out = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret });
  ok(out.toString("utf8") === msg, `reference library decrypts our message (${msg.length} chars)`);
}
// VAPID: valid ES256 JWT signed by our key, audience = push service origin, k = our public key
const vapid = await wp.generateVapidKeys();
const auth1 = await wp.vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, "https://ttomov88.github.io/fleet-log/");
const m = auth1.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
ok(!!m, "Authorization header shape: vapid t=<jwt>, k=<key>");
const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
ok(claims.aud === "https://fcm.googleapis.com" && claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600 && /^https:/.test(claims.sub), "claims: aud, exp < 24h, sub", JSON.stringify(claims));
const raw = wp.b64uToBytes(m[4]);
ok(raw.length === 65 && raw[0] === 4, "public key is a raw uncompressed P-256 point (what browsers need)");
const pub = await webcrypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const good = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, wp.b64uToBytes(m[3]), new TextEncoder().encode(m[1] + "." + m[2]));
ok(good, "JWT signature verifies with the public key");
// endpoint guard
ok(wp.isPushEndpoint("https://fcm.googleapis.com/fcm/send/x") && wp.isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x") && wp.isPushEndpoint("https://web.push.apple.com/x"), "accepts Chrome / Firefox / Apple push services");
ok(!wp.isPushEndpoint("https://evil.example.com/x") && !wp.isPushEndpoint("http://fcm.googleapis.com/x") && !wp.isPushEndpoint("https://fcm.googleapis.com.evil.com/x"), "rejects anything else");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
