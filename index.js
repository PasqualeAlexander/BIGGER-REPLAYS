// Bot de Discord que sube archivos .hbr2 a TheHax y responde con un embed con el link
// Requisitos: DISCORD_TOKEN en .env y habilitar Message Content Intent en el portal de Discord

const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require("discord.js");
const axios = require("axios");
const FormData = require("form-data");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config();

const THEHAX_API_KEY = process.env.THEHAX_API_KEY || "";
const THEHAX_TENANT_KEY = process.env.THEHAX_TENANT_KEY || "";
const THEHAX_PRIVATE = process.env.THEHAX_PRIVATE === "1" ? "1" : "0";

function logDebug(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  try { fs.appendFileSync("debug.log", line + "\n"); } catch {}
  console.log(line);
}

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Falta DISCORD_TOKEN en .env. Agrega tu token del bot antes de ejecutar.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  logDebug(`Bot logueado como ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return; // ignorar DMs

    // Permitir mensajes de webhooks, pero seguir ignorando otros bots
    const isWebhook = Boolean(message.webhookId);
    const isOtherBot = message.author?.bot && !isWebhook;
    if (isOtherBot) return;

    // log básico del mensaje
    try {
      logDebug(
        `[msg] guild="${message.guild?.name}" channel="#${message.channel?.name}" attachments=${message.attachments?.size ?? 0} webhook=${isWebhook}`
      );
    } catch {}

    // si no hay adjuntos, salir
    if (!message.attachments || message.attachments.size === 0) return;

    // filtrar solo .hbr2
    const hbr2 = message.attachments.find((att) =>
      typeof att.name === "string" && att.name.toLowerCase().endsWith(".hbr2")
    );
    if (!hbr2) return; // no hay .hbr2 en este mensaje

    const statusMsg = await message.channel.send(
      "📤 Subiendo replay a TheHax, aguarda un momento…"
    );
      "📤 Subiendo replay a TheHax, aguarda un momento…"
    );

    // descargar el archivo como buffer
    const downloadResp = await axios.get(hbr2.url, {
      responseType: "arraybuffer",
      timeout: 60000,
      headers: {
        // algunos CDNs requieren un UA
        "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0; +https://discordapp.com)",
      },
    });

    const buffer = Buffer.from(downloadResp.data);
    logDebug(`[download] bytes=${buffer.length}`);

    // subir a TheHax
    const link = await uploadToTheHax(buffer, hbr2.name);

    // armar embed
    const embed = new EmbedBuilder()
      .setTitle("📽️ Nueva Replay Subida")
      .setDescription(`[Click acá para ver la replay](${link})`)
      .setColor(0x57f287)
      .setTimestamp();

    await statusMsg.edit({ content: "", embeds: [embed] });
  } catch (err) {
    try {
      const status = err?.response?.status;
      const respBody = typeof err?.response?.data === "string" ? err.response.data : JSON.stringify(err?.response?.data);
      logDebug("[error]", `status=${status}`, respBody?.slice(0, 500) || String(err));
    } catch (e) {
      logDebug("[error-log-failed]", String(e));
    }
    try {
      await message.channel.send(
        "❌ Hubo un error al subir la replay a TheHax. Intenta de nuevo más tarde."
      );
    } catch {}
  }
});

async function uploadToTheHax(buffer, filename) {
  // THEHAX Replay nuevo endpoint
  // Página: https://replay.thehax.pl/upload
  // JS indica POST a /api/upload con FormData del formulario con campos replay[fileContent], replay[name], replay[private]
  const name = (filename || "replay.hbr2").replace(/\.[^/.]+$/, "");
  const form = new FormData();
  form.append("replay[fileContent]", buffer, {
    filename: filename || "replay.hbr2",
    contentType: "application/octet-stream",
  });
  form.append("replay[name]", name);
  form.append("replay[private]", THEHAX_PRIVATE); // público/privado según .env

  const uploadUrl = "https://replay.thehax.pl/api/upload";
  const headers = {
    ...form.getHeaders(),
    "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0; +https://discordapp.com)",
    "Accept": "application/json",
    "Origin": "https://replay.thehax.pl",
    "Referer": "https://replay.thehax.pl/upload",
  };
  if (THEHAX_API_KEY) {
    headers["Authorization"] = `Bearer ${THEHAX_API_KEY}`;
    headers["X-Api-Key"] = THEHAX_API_KEY; // por si la API soporta este formato
  }
  if (THEHAX_TENANT_KEY) {
    headers["X-Tenant-Key"] = THEHAX_TENANT_KEY; // nombre de cabecera tentativo
    headers["X-Tenant"] = THEHAX_TENANT_KEY; // fallback por si usan otro nombre
  }

  const resp = await axios.post(uploadUrl, form, {
    headers,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 60000,
    validateStatus: (s) => s >= 200 && s < 500, // capturar errores en body
  });

  const data = typeof resp.data === "string" ? safeJson(resp.data) : resp.data;
  try {
    logDebug(`[thehax] status=${resp.status} bodySnippet=${JSON.stringify(data).slice(0, 300)}`);
  } catch {}

  if (data && data.success === true && data.url) {
    return data.url;
  }

  // manejar mensajes de error conocidos (límite de invitado)
  if (data && data.success === false && (data.message || (data.errors && data.errors.length))) {
    const msg = data.message || data.errors.map(e => e.message).join("; ");
    throw new Error(`THEHAX error: ${msg}`);
  }

  throw new Error("Respuesta inesperada de THEHAX: " + JSON.stringify(data).slice(0, 300));
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return { raw: String(str) }; }
}

client.login(TOKEN);
