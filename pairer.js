import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import http from "http";
import { URL as NodeURL } from "url";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT   = parseInt(process.env.PAIR_PORT || "9100");
const NUMBER = (process.env.PAIR_NUMBER || "").replace(/\D/g, "");
const AUTH   = path.join(__dirname, "auth");
const OUT    = path.join(__dirname, "session_out.txt");

fs.mkdirSync(AUTH, { recursive: true });

const logger = pino({ level: "silent" });
let sock;
let currentQR = null;
let linked    = false;
let pairCode  = null;

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new NodeURL(req.url, "http://localhost");

  // /pair?number=... → request pairing code
  if (url.pathname === "/pair") {
    const num = (url.searchParams.get("number") || NUMBER).replace(/\D/g, "");
    if (!num) { res.writeHead(400); return res.end("Provide ?number=..."); }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><head><meta http-equiv="refresh" content="3"></head>
      <body style="font-family:sans-serif;text-align:center;padding:50px;background:#111;color:#fff">
      <h2 style="color:#25D366">⏳ Generating code for +${num}...</h2>
      <p>Page will update automatically.</p></body></html>`);
    try {
      const code = await sock.requestPairingCode(num);
      pairCode = code?.match(/.{1,4}/g)?.join("-") || code;
    } catch(e) { pairCode = `ERROR: ${e.message}`; }
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });

  if (linked) return res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
    <h1 style="color:#25D366">✅ Linked!</h1><p>Session sent to your WhatsApp.</p></body></html>`);

  if (pairCode) return res.end(`<html><head><meta http-equiv="refresh" content="60"></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;background:#111;color:#fff">
    <h2 style="color:#128C7E">🔗 Pairing Code</h2>
    <div style="font-size:52px;font-weight:bold;letter-spacing:10px;color:#fff;margin:30px 0;
         background:#1a1a1a;padding:20px 40px;border-radius:16px;display:inline-block">${pairCode}</div>
    <p style="color:#aaa">WhatsApp → Linked Devices → Link a Device → Link with phone number</p>
    <p style="color:#555;font-size:12px">Auto-refreshes</p></body></html>`);

  if (!currentQR) return res.end(`<html><head><meta http-equiv="refresh" content="3"></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#fff">
    <h2>⏳ Starting...</h2></body></html>`);

  try {
    const dataUrl = await QRCode.toDataURL(currentQR, { errorCorrectionLevel: "L", margin: 2, width: 300 });
    res.end(`<html><head><meta http-equiv="refresh" content="25"><title>XDIGITEX — Scan QR</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#fff">
        <h1 style="color:#25D366">⚡ XDIGITEX SESSION</h1>
        <p style="color:#aaa">Scan: WhatsApp → Linked Devices → Link a Device</p>
        <img src="${dataUrl}" style="border:8px solid #1a1a1a;border-radius:16px;box-shadow:0 0 40px #25D36633"/>
        <br><br>
        <p style="color:#aaa;font-size:13px">Or get pairing code:
        <a href="/pair?number=${NUMBER||'2547xxxxxxxx'}" style="color:#25D366">/pair?number=${NUMBER||"2547xxxxxxxx"}</a></p>
        <p style="color:#555;font-size:11px">Port ${PORT} — auto-refreshes every 25s</p>
      </body></html>`);
  } catch { res.end("QR error"); }
});

server.listen(PORT, () => console.log(`READY:${PORT}`));

// ── WhatsApp socket ───────────────────────────────────────────────────────────
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version, logger, auth: state,
    browser: ["Chrome (Linux)", "Chrome", "120.0.0"],
    syncFullHistory: false,
  });

  // If number provided via env, auto-request pairing code
  if (NUMBER && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(NUMBER);
        pairCode = code?.match(/.{1,4}/g)?.join("-") || code;
        console.log(`CODE:${pairCode}`);
      } catch(e) { console.error(`pair-err: ${e.message}`); }
    }, 800);
  }

  sock.ev.on("connection.update", async ({ connection, qr }) => {
    if (qr) currentQR = qr;
    if (connection === "open") {
      linked = true; currentQR = null;
      try {
        const raw     = fs.readFileSync(path.join(AUTH, "creds.json"), "utf8");
        const session = Buffer.from(raw).toString("base64");
        fs.writeFileSync(OUT, session, "utf8");
        console.log(`SESSION_SAVED`);
      } catch { fs.writeFileSync(OUT, "ERROR", "utf8"); }
      // Keep running so user can still see "linked" page; pm2 will be stopped externally
    }
    if (connection === "close") setTimeout(start, 3000);
  });

  sock.ev.on("creds.update", saveCreds);
}

start().catch(e => { console.error(e.message); process.exit(1); });
