// dashboard-x402 — payer-scoped fleet-ops x402 sidecar for dashboard.frynetworks.com.
// Uses @x402-avm/express paymentMiddleware + x402ResourceServer so the declared bazaar
// discovery propagates to the facilitator (indexes in the Bazaar — the reason for this
// rewrite). The payer is derived from the already-verified X-PAYMENT payload
// (fail-closed: exactly one non-feePayer sender) and passed to the dashboard app over
// localhost with the shared internal secret. Sidecar-only; the app is never touched.
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402-avm/express";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/server";
import { HTTPFacilitatorClient } from "@x402-avm/core/server";
import { decodePaymentSignatureHeader } from "@x402-avm/core/http";
import { decodeTransaction, getSenderFromTransaction, hasSignature, isExactAvmPayload } from "@x402-avm/avm";
import { ALGORAND_MAINNET_CAIP2, USDC_MAINNET_ASA_ID } from "@x402-avm/avm";
import { declareDiscoveryExtension } from "@x402-avm/extensions/bazaar";

const PORT = Number(process.env.PORT || 3402);
const BIND = process.env.BIND || "0.0.0.0";
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";
const PAY_TO = process.env.PAY_TO || "E2F2LT2INE75DBOYHQXTCTOP2PAP5MHAXQRXTTCCXFKHQTVG36DJONBQZE";
const PUBLIC_X402_BASE = process.env.PUBLIC_X402_BASE || "https://dashboard.frynetworks.com/x402";
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "http://127.0.0.1:3007").replace(/\/+$/, "");
const INTERNAL_SECRET = process.env.X402_INTERNAL_SECRET || "";
// GoPlausible Algorand mainnet fee sponsor (required in accepts.extra or verify fails "0.0A fees").
const FEE_PAYER = process.env.FEE_PAYER || "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";

const ADDR_RE = /^[A-Z2-7]{58}$/;

const ENDPOINTS = {
  "depin/my-devices": { price: "$0.005", desc: "Your DePIN devices (payer-scoped): the fleet owned by the paying wallet.", appPath: "/api/x402/my-devices", params: {}, outputExample: { success: true, count: 0, devices: [] } },
  "depin/device": { price: "$0.008", desc: "Detail for one device you own (by miner_key); 404 if not owned.", appPath: "/api/x402/device", params: { miner_key: "device miner key" }, outputExample: { success: true, device: {} } },
  "depin/my-uptime": { price: "$0.005", desc: "Uptime/PoC summary for your owned devices (total, online).", appPath: "/api/x402/my-uptime", params: {}, outputExample: { success: true, total: 0, online: 0 } },
  "depin/my-reward-summary": { price: "$0.008", desc: "Corrected claimable reward summary for your owned devices; token-mode resolved live.", appPath: "/api/x402/my-reward-summary", params: {}, outputExample: { success: true, claimable: 0, held: 0, token: {} } },
};

// fry.farm-style route accept(): accepts + pinned resource + declared bazaar discovery.
function accept(key) {
  const e = ENDPOINTS[key];
  const params = e.params || {};
  const hasParams = Object.keys(params).length > 0;
  const disc = declareDiscoveryExtension({
    ...(hasParams ? { input: Object.fromEntries(Object.keys(params).map((k) => [k, "<value>"])), inputSchema: { properties: Object.fromEntries(Object.entries(params).map(([k, d]) => [k, { type: "string", description: String(d) }])), required: Object.keys(params) } } : {}),
    output: { example: e.outputExample },
  });
  return {
    accepts: { scheme: "exact", network: ALGORAND_MAINNET_CAIP2, payTo: PAY_TO, price: e.price, extra: { name: "USDC", decimals: 6, asset: USDC_MAINNET_ASA_ID, feePayer: FEE_PAYER } },
    description: e.desc,
    resource: `${PUBLIC_X402_BASE}/${key}`,
    extensions: disc,
  };
}

const routes = {};
for (const key of Object.keys(ENDPOINTS)) routes[`GET /${key}`] = accept(key);

// ---- payer extraction from the already-verified X-PAYMENT payload (FAIL-CLOSED) ----
// Reads both header names; requires an exact-avm payload whose group has exactly ONE
// non-feePayer sender, matching the declared payment index. Any anomaly -> null (402).
function payerFromHeader(req) {
  const xPayment = req.get("x-payment");
  const paySig = req.get("payment-signature");
  const header = xPayment || paySig;
  const which = xPayment ? "x-payment" : paySig ? "payment-signature" : "none";
  if (!header) return { payer: null, reason: "no-payment-header", which };
  let pp;
  try { pp = decodePaymentSignatureHeader(header); } catch (e) { return { payer: null, reason: "decode-failed", which }; }
  const avm = pp?.payload;
  if (!isExactAvmPayload(avm)) return { payer: null, reason: "not-exact-avm", which };
  const group = avm.paymentGroup;
  const idx = avm.paymentIndex;
  if (!Array.isArray(group) || group.length === 0 || typeof idx !== "number" || idx < 0 || idx >= group.length) {
    return { payer: null, reason: "bad-group-shape", which };
  }
  // Collect distinct non-feePayer senders across the whole group.
  let candidates;
  try {
    const senders = group.map((b64) => {
      const bytes = decodeTransaction(b64);
      return getSenderFromTransaction(bytes, hasSignature(bytes));
    });
    candidates = [...new Set(senders.filter((s) => s && s !== FEE_PAYER))];
    // The declared payment txn's sender must be the sole candidate.
    const payIdxBytes = decodeTransaction(group[idx]);
    const payIdxSender = getSenderFromTransaction(payIdxBytes, hasSignature(payIdxBytes));
    if (candidates.length !== 1) return { payer: null, reason: `candidates=${candidates.length}`, which };
    if (payIdxSender !== candidates[0]) return { payer: null, reason: "payindex-mismatch", which };
    if (!ADDR_RE.test(candidates[0])) return { payer: null, reason: "bad-address", which };
    return { payer: candidates[0], reason: "ok", which };
  } catch (e) {
    return { payer: null, reason: "decode-txn-failed", which };
  }
}

const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const server = new x402ResourceServer(facilitator);
registerExactAvmScheme(server);

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

app.get("/health", (_req, res) => res.json({ status: "ok", service: "dashboard-x402", secret: INTERNAL_SECRET ? "set" : "MISSING" }));

function catalogJson() {
  const dataEndpoints = Object.entries(ENDPOINTS).map(([key, e]) => ({
    action: key, method: "GET", path: `/x402/${key}`, priceUsdc: e.price, priceAtomic: Math.round(Number(String(e.price).replace("$", "")) * 1e6),
    params: e.params, returns: e.desc,
    x402: { scheme: "exact", network: ALGORAND_MAINNET_CAIP2, asset: String(USDC_MAINNET_ASA_ID), payTo: PAY_TO, maxTimeoutSeconds: 300, facilitator: FACILITATOR_URL, x402Version: 2 },
  }));
  return {
    service: "dashboard.frynetworks.com x402 fleet-ops (payer-scoped)",
    description: "Payment-as-identity: the paying wallet IS the authenticated owner. Each endpoint returns exactly the DePIN fleet data owned by the payer. Non-custodial, no accounts.",
    network: "algorand-mainnet", networkCaip2: ALGORAND_MAINNET_CAIP2,
    asset: { name: "USDC", id: String(USDC_MAINNET_ASA_ID), decimals: 6 },
    payTo: PAY_TO, facilitator: FACILITATOR_URL, x402Version: 2, dataEndpoints,
  };
}
app.get("/catalog", (_req, res) => res.json(catalogJson()));
app.get("/", (_req, res) => {
  const rows = Object.entries(ENDPOINTS).map(([k, e]) => `<tr><td><code>/x402/${k}</code></td><td>${e.price} USDC</td><td>${e.desc}</td></tr>`).join("");
  res.type("html").send(`<!doctype html><meta charset=utf-8><title>dashboard x402 fleet-ops</title><style>body{background:#0b0e14;color:#e6edf3;font:15px system-ui;max-width:820px;margin:2em auto;padding:0 1em}code{background:#161b26;padding:2px 6px;border-radius:5px;color:#9ece6a}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #1c2230;padding:8px;text-align:left}a{color:#7cf}</style><h1>dashboard.frynetworks.com x402 fleet-ops</h1><p>Payment-as-identity — the paying wallet is the authenticated owner. Spec: <a href="/x402/catalog">/x402/catalog</a>.</p><table><tr><th>Endpoint</th><th>Price</th><th>Returns</th></tr>${rows}</table>`);
});

// Payment gate — verifies, settles, and INDEXES (declared discovery) the routes map.
// syncFacilitatorOnStart stays true: the middleware needs the facilitator's supported
// kinds to build 402s + index. If the facilitator is unreachable at startup the process
// crash-loops (restart:unless-stopped) until it recovers — self-heals; endpoints are down
// only during a facilitator/DNS outage (same posture as fry.farm).
app.use(paymentMiddleware(routes, server));

// Paid handlers (run post-verify, pre-settle). Derive payer from the verified payload,
// proxy to the dashboard app with the internal secret, return its JSON (middleware settles it).
for (const key of Object.keys(ENDPOINTS)) {
  app.get(`/${key}`, async (req, res) => {
    const { payer, reason, which } = payerFromHeader(req);
    if (!payer) {
      console.error(`[dashboard-x402] payer-extraction fail-closed: ${reason} (header=${which})`);
      return res.status(402).json({ error: "payer_unresolved", reason });
    }
    try {
      const qs = key === "depin/device" && req.query.miner_key ? `?miner_key=${encodeURIComponent(String(req.query.miner_key))}` : "";
      const appResp = await fetch(`${DASHBOARD_URL}${ENDPOINTS[key].appPath}${qs}`, {
        method: "GET",
        headers: { accept: "application/json", "X-Payer-Address": payer, "X-X402-Internal": INTERNAL_SECRET },
      });
      const bodyText = await appResp.text();
      res.status(appResp.status).type("application/json").send(bodyText);
    } catch (e) {
      res.status(502).json({ error: "sidecar_proxy_failed", detail: String(e?.message || e) });
    }
  });
}

if (!process.env.NO_LISTEN) {
  app.listen(PORT, BIND, () => console.log(`dashboard-x402 (middleware) on ${BIND}:${PORT} | app=${DASHBOARD_URL} | secret=${INTERNAL_SECRET ? "set" : "MISSING"} | endpoints=${Object.keys(ENDPOINTS).length}`));
}

export { payerFromHeader, FEE_PAYER };
