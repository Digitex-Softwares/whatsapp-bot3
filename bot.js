import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR   = path.join(__dirname, "auth_info_baileys");

const API_BASE = "https://panel.xcasper.site/api";
const API_KEY  = "Digitex2025";

const logger = pino({ level: "silent" });
let sock;

// ── API helper ────────────────────────────────────────────────────────────────
async function api(method, urlPath, body) {
  try {
    const r = await axios({
      method, url: API_BASE + urlPath,
      headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
      data: body, timeout: 30000,
    });
    return r.data;
  } catch (e) {
    return { success: false, error: e?.response?.data?.error || e.message };
  }
}

async function send(jid, text) {
  try { await sock.sendMessage(jid, { text }); } catch {}
}

// ── App name generator ────────────────────────────────────────────────────────
const ADJ  = ["swift","cloud","echo","nova","bolt","prime","ace","zen","flux","wave","sage","core","spark","dusk","peak"];
const NOUN = ["bot","hub","net","run","lab","bay","ops","fox","kai","pro","one","max","air","sky","bit"];
const PFX  = { cypherx:"cypher", bwm:"bwm", cypherxultra:"ultra", kingmd:"king", anitav4:"anita", atassa:"atassa" };

function genName(botType) {
  const p   = PFX[botType] || botType;
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)];
  const nou = NOUN[Math.floor(Math.random() * NOUN.length)];
  const num = String(Math.floor(Math.random() * 90) + 10);
  return `${p}-${adj}-${nou}-${num}`.slice(0, 30);
}

// ── Background deploy poller ──────────────────────────────────────────────────
function pollDeploy(jid, jobId, appName, botType) {
  let attempts = 0;
  const tick = async () => {
    if (++attempts > 80) {
      await send(jid, `⏳ *${appName}* is taking longer than usual.\nManage: https://panel.xcasper.site/manage.php?app=${appName}`);
      return;
    }
    const d = await api("GET", `/external/status/${encodeURIComponent(jobId)}`);
    if (d?.status === "completed") {
      const url = d.appUrl || `https://${appName}.herokuapp.com`;
      await send(jid, `🎉 *${botType.toUpperCase()} is LIVE!*\n\nApp: *${appName}*\nURL: ${url}\n\nManage: https://panel.xcasper.site/manage.php?app=${appName}`);
    } else if (d?.status === "failed") {
      await send(jid, `❌ *${appName}* failed\nError: ${d.error || "Unknown"}`);
    } else {
      setTimeout(tick, 5000);
    }
  };
  setTimeout(tick, 5000);
}

// ── Deploy helper ─────────────────────────────────────────────────────────────
async function deployBot(jid, botType, botVars, extraInfo = "") {
  const appName = genName(botType);
  await send(jid,
    `🚀 *Deploying ${botType.toUpperCase()}*\n` +
    `App: *${appName}*${extraInfo ? "\n" + extraInfo : ""}\n\n` +
    `_Building on Heroku... I'll notify you when live (2–5 min)_`
  );
  const d = await api("POST", "/external/deploy", { botType, appName, botVars });
  if (!d.success) {
    await send(jid, `❌ Deploy failed: ${d.error}`);
    return;
  }
  await send(jid, `✅ *${botType.toUpperCase()} successfully queued!*\n\nJob: \`${d.jobId}\`\nApp: *${appName}*`);
  pollDeploy(jid, d.jobId, appName, botType);
}

// ── Command handler ───────────────────────────────────────────────────────────
/*
  Command reference (prefix = . dot):
  .free   {session}                                      → CypherX
  .deploy {session} {owner_number}                       → BWM-XMD
  .ultra  {master_password} [github_username]            → CypherX Ultra
  .king   {session} {owner_number} {country_code}        → King MD
  .anita  {session} {owner_number}                       → Queen Anitah (auto defaults)
  .atassa {session}                                      → Atassa MD (auto defaults)
  .logs   {appname}                                      → Fetch logs
  .status {appname}                                      → Check status
  .bots                                                  → List bots
  .menu                                                  → Help
*/
async function handleCommand(jid, text) {
  if (!text.startsWith(".")) return; // only handle dot-commands

  const parts  = text.trim().split(/\s+/);
  const cmd    = parts[0].toLowerCase();   // e.g. ".free"
  const args   = parts.slice(1);           // everything after the command

  // ── .menu / .help ──────────────────────────────────────────────────────────
  if (cmd === ".menu" || cmd === ".help") {
    return send(jid,
      `🤖 *BOT DEPLOY MANAGER*\n\n` +
      `*.free* _{session}_\n→ Deploy CypherX\n\n` +
      `*.deploy* _{session} {owner_number}_\n→ Deploy BWM-XMD\n\n` +
      `*.ultra* _{password} [github_user]_\n→ Deploy CypherX Ultra\n\n` +
      `*.king* _{session} {owner} {country_code}_\n→ Deploy King MD\n\n` +
      `*.anita* _{session} {owner}_\n→ Deploy Queen Anitah\n\n` +
      `*.atassa* _{session}_\n→ Deploy Atassa MD\n\n` +
      `*.logs* _{appname}_\n→ View bot logs\n\n` +
      `*.status* _{appname}_\n→ Check deployment status\n\n` +
      `*.bots*\n→ List all deployed bots\n\n` +
      `*.menu*\n→ Show this menu`
    );
  }

  // ── .bots ─────────────────────────────────────────────────────────────────
  if (cmd === ".bots" || cmd === ".list") {
    const d = await api("GET", "/external/bots");
    if (!d.success) return send(jid, `❌ ${d.error}`);
    const list = Array.isArray(d.apps) ? d.apps : [];
    if (!list.length) return send(jid, "📭 No deployed bots yet.");
    return send(jid, `📋 *Deployed Bots (${list.length})*\n\n` + list.map((a, i) => `${i + 1}. *${a}*`).join("\n"));
  }

  // ── .status {appname} ─────────────────────────────────────────────────────
  if (cmd === ".status") {
    const appName = args[0]?.toLowerCase();
    if (!appName) return send(jid, `Usage: .status {appname}`);
    const d = await api("GET", `/external/check/${encodeURIComponent(appName)}`);
    if (!d.success) return send(jid, `❌ ${d.error}`);
    if (!d.exists)  return send(jid, `⚠️ App *${appName}* not found on Heroku.`);
    const icon = d.status === "completed" ? "🟢" : d.status === "failed" ? "🔴" : "🟡";
    return send(jid, `${icon} *${appName}*\nStatus: ${d.status}${d.appUrl ? `\nURL: ${d.appUrl}` : ""}`);
  }

  // ── .logs {appname} ───────────────────────────────────────────────────────
  if (cmd === ".logs") {
    const appName = args[0]?.toLowerCase();
    if (!appName) return send(jid, `Usage: .logs {appname}`);
    await send(jid, `📜 Fetching logs for *${appName}*...`);
    const d = await api("GET", `/external/logs/${encodeURIComponent(appName)}`);
    if (!d.success) return send(jid, `❌ ${d.error}`);
    const logText = (d.logText || "(no logs available)").slice(-2800);
    return send(jid, `📜 *Logs — ${appName}*\n\`\`\`\n${logText}\n\`\`\``);
  }

  // ── .free {session} ───────────────────────────────────────────────────────
  // Deploys CypherX — only needs a session ID
  if (cmd === ".free") {
    const session = args[0];
    if (!session) return send(jid, `Usage: .free {session_id}`);
    return deployBot(jid, "cypherx", { sessionId: session });
  }

  // ── .deploy {session} {owner_number} ─────────────────────────────────────
  // Deploys BWM-XMD
  if (cmd === ".deploy") {
    const [session, ownerNumber] = args;
    if (!session || !ownerNumber) return send(jid, `Usage: .deploy {session} {owner_number}\nExample: .deploy ABCD12345 254700000000`);
    return deployBot(jid, "bwm", { session, ownerNumber }, `Owner: ${ownerNumber}`);
  }

  // ── .ultra {master_password} [github_username] ────────────────────────────
  // Deploys CypherX Ultra
  if (cmd === ".ultra") {
    const [masterPassword, githubUsername] = args;
    if (!masterPassword) return send(jid, `Usage: .ultra {master_password} [github_username]`);
    const vars = { masterPassword };
    if (githubUsername) vars.githubUsername = githubUsername;
    return deployBot(jid, "cypherxultra", vars);
  }

  // ── .king {session} {owner_number} {country_code} ────────────────────────
  // Deploys King MD
  if (cmd === ".king") {
    const [session, dev, code] = args;
    if (!session || !dev || !code) return send(jid, `Usage: .king {session} {owner_number} {country_code}\nExample: .king ABCD12345 254700000000 254`);
    return deployBot(jid, "kingmd", { session, dev, code }, `Owner: ${dev} | Country: ${code}`);
  }

  // ── .anita {session} {owner_number} ──────────────────────────────────────
  // Deploys Queen Anitah with sensible defaults
  if (cmd === ".anita") {
    const [sessionId, ownerNumber] = args;
    if (!sessionId || !ownerNumber) return send(jid, `Usage: .anita {session} {owner_number}`);
    return deployBot(jid, "anitav4", {
      sessionId,
      ownerNumber,
      prefix: ".",
      public: "public",
      autoViewStatus: "true",
      antidelete: "true",
      autoStatusReact: "true",
      chatbot: "false",
    }, `Owner: ${ownerNumber}`);
  }

  // ── .atassa {session} ─────────────────────────────────────────────────────
  // Deploys Atassa MD with sensible defaults
  if (cmd === ".atassa") {
    const [sessionId] = args;
    if (!sessionId) return send(jid, `Usage: .atassa {session_id}`);
    return deployBot(jid, "atassa", {
      sessionId,
      mode: "public",
      autoLikeStatus: "true",
      autoReadStatus: "true",
    });
  }
}

// ── Connect ───────────────────────────────────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: state,
    printQRInTerminal: false,
    browser: ["BOT MANAGER", "Chrome", "1.0.0"],
    syncFullHistory: false,
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n======= SCAN QR CODE IN WHATSAPP =======\n");
      qrcode.generate(qr, { small: true });
      console.log("\nWhatsApp → Linked Devices → Link a Device\n=========================================\n");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("Reconnecting... (reason:", code, ")");
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log("Logged out. Delete auth_info_baileys/ and restart to re-link.");
      }
    }
    if (connection === "open") console.log("✅ WhatsApp connected!");
  });

  sock.ev.on("creds.update", saveCreds);

  // Auto-view ALL statuses
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.remoteJid === "status@broadcast") {
        try { await sock.readMessages([msg.key]); } catch {}
        continue;
      }
      if (msg.key?.fromMe || !msg.message) continue;

      const jid  = msg.key.remoteJid;
      const text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text || "";
      if (text.startsWith(".")) await handleCommand(jid, text);
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const { key } of updates) {
      if (key?.remoteJid === "status@broadcast") {
        try { await sock.readMessages([key]); } catch {}
      }
    }
  });
}

connectToWhatsApp().catch(console.error);
