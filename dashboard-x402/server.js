// dashboard-x402 — payer-scoped fleet-ops x402 sidecar for dashboard.frynetworks.com.
// Manual x402 flow so the payer is taken from the FACILITATOR VERIFY RESPONSE (authoritative),
// then passed to the dashboard app over localhost with the shared internal secret. Fail-closed:
// no verified payer -> no proxy. Settlement only after the app returns 2xx.
import express from "express";
import { HTTPFacilitatorClient } from "@x402-avm/core/server";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402-avm/core/http";
import { ALGORAND_MAINNET_CAIP2, USDC_MAINNET_ASA_ID } from "@x402-avm/avm";
import { declareDiscoveryExtension } from "@x402-avm/extensions/bazaar";

const PORT = Number(process.env.PORT || 3402);
const BIND = process.env.BIND || "0.0.0.0"; // container; published to 127.0.0.1 by compose
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";
const PAY_TO = process.env.PAY_TO || "E2F2LT2INE75DBOYHQXTCTOP2PAP5MHAXQRXTTCCXFKHQTVG36DJONBQZE";
const PUBLIC_X402_BASE = process.env.PUBLIC_X402_BASE || "https://dashboard.frynetworks.com/x402";
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "http://127.0.0.1:3007").replace(/\/+$/, "");
const INTERNAL_SECRET = process.env.X402_INTERNAL_SECRET || "";
// GoPlausible facilitator's Algorand mainnet fee sponsor — REQUIRED in the payment
// requirements so the payer's group carries a valid fee (else verify simulation fails
// "txgroup with 0.0A fees"). Matches the fry.farm/frymarket 402 extra.feePayer.
const FEE_PAYER = process.env.FEE_PAYER || "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";

const ADDR_RE = /^[A-Z2-7]{58}$/;
const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Registry: public x402 path -> price, description, app route, query params.
const ENDPOINTS = {
  "depin/my-devices": { price: "$0.005", atomic: "5000", desc: "Your DePIN devices (payer-scoped): the fleet owned by the paying wallet.", appPath: "/api/x402/my-devices", params: {}, outputExample: { success: true, count: 0, devices: [] } },
  "depin/device": { price: "$0.008", atomic: "8000", desc: "Detail for one device you own (by miner_key); 404 if not owned.", appPath: "/api/x402/device", params: { miner_key: "device miner key" }, outputExample: { success: true, device: {} } },
  "depin/my-uptime": { price: "$0.005", atomic: "5000", desc: "Uptime/PoC summary for your owned devices (total, online).", appPath: "/api/x402/my-uptime", params: {}, outputExample: { success: true, total: 0, online: 0 } },
  "depin/my-reward-summary": { price: "$0.008", atomic: "8000", desc: "Corrected claimable reward summary for your owned devices; token-mode resolved live.", appPath: "/api/x402/my-reward-summary", params: {}, outputExample: { success: true, claimable: 0, held: 0, token: {} } },
};

function requirementsFor(key) {
  return { scheme: "exact", network: ALGORAND_MAINNET_CAIP2, amount: ENDPOINTS[key].atomic, asset: String(USDC_MAINNET_ASA_ID), payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USDC", decimals: 6, asset: String(USDC_MAINNET_ASA_ID), feePayer: FEE_PAYER } };
}
function paymentRequiredFor(key) {
  const e = ENDPOINTS[key];
  const params = e.params || {};
  const hasParams = Object.keys(params).length > 0;
  const disc = declareDiscoveryExtension({
    ...(hasParams ? { input: Object.fromEntries(Object.keys(params).map((k) => [k, "<value>"])), inputSchema: { properties: Object.fromEntries(Object.entries(params).map(([k, d]) => [k, { type: "string", description: String(d) }])), required: Object.keys(params) } } : {}),
    output: { example: e.outputExample },
  });
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url: `${PUBLIC_X402_BASE}/${key}`, description: e.desc, mimeType: "" },
    accepts: [requirementsFor(key)],
    extensions: disc,
  };
}

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

app.get("/health", (_req, res) => res.json({ status: "ok", service: "dashboard-x402", secret: INTERNAL_SECRET ? "set" : "MISSING" }));

function catalogJson() {
  const dataEndpoints = Object.entries(ENDPOINTS).map(([key, e]) => ({
    action: key, method: "GET", path: `/x402/${key}`, priceUsdc: e.price, priceAtomic: Number(e.atomic),
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

// Paid routes.
for (const key of Object.keys(ENDPOINTS)) {
  app.get(`/${key}`, async (req, res) => {
    try {
      const reqs = requirementsFor(key);
      const xpay = req.get("x-payment") || req.get("payment-signature");
      if (!xpay) {
        res.setHeader("payment-required", encodePaymentRequiredHeader(paymentRequiredFor(key)));
        return res.status(402).json({});
      }
      let payload;
      try { payload = decodePaymentSignatureHeader(xpay); } catch { return res.status(402).json({ error: "bad_payment_header" }); }

      const vr = await facilitator.verify(payload, reqs);
      if (!vr?.isValid) return res.status(402).json({ error: "verify_failed", reason: vr?.invalidReason || null });
      const payer = String(vr.payer || "").trim();
      if (!ADDR_RE.test(payer)) {
        // FAIL CLOSED: verified but no usable payer -> never proxy with a blank/guessed identity.
        return res.status(402).json({ error: "no_verified_payer" });
      }

      // Proxy to the dashboard app with the verified payer + internal secret.
      const qs = key === "depin/device" && req.query.miner_key ? `?miner_key=${encodeURIComponent(String(req.query.miner_key))}` : "";
      const appResp = await fetch(`${DASHBOARD_URL}${ENDPOINTS[key].appPath}${qs}`, {
        method: "GET",
        headers: { accept: "application/json", "X-Payer-Address": payer, "X-X402-Internal": INTERNAL_SECRET },
      });
      const bodyText = await appResp.text();

      if (appResp.ok) {
        try {
          const sr = await facilitator.settle(payload, reqs);
          if (sr?.success) res.setHeader("payment-response", encodePaymentResponseHeader(sr));
        } catch (e) { console.error("settle error", String(e?.message || e)); }
      }
      res.status(appResp.status).type("application/json").send(bodyText);
    } catch (e) {
      res.status(502).json({ error: "sidecar_error", detail: String(e?.message || e) });
    }
  });
}

app.listen(PORT, BIND, () => console.log(`dashboard-x402 on ${BIND}:${PORT} | app=${DASHBOARD_URL} | secret=${INTERNAL_SECRET ? "set" : "MISSING"} | endpoints=${Object.keys(ENDPOINTS).length}`));
