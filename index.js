// Bot de Discord que sube archivos .hbr2 a TheHax y responde con un embed con el link
// Requisitos: DISCORD_TOKEN en .env y habilitar Message Content Intent en el portal de Discord

const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require("discord.js");
const axios = require("axios");
const FormData = require("form-data");
const dotenv = require("dotenv");
const fs = require("fs");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

dotenv.config();

const THEHAX_API_KEY = process.env.THEHAX_API_KEY || "";
const THEHAX_TENANT_KEY = process.env.THEHAX_TENANT_KEY || "";
const THEHAX_PRIVATE = process.env.THEHAX_PRIVATE === "1" ? "1" : "0";
const THEHAX_USERNAME = process.env.THEHAX_USERNAME || ""; // username o email
const THEHAX_PASSWORD = process.env.THEHAX_PASSWORD || "";

// axios con cookie jar para mantener sesión autenticada
const jar = new CookieJar();
const http = wrapper(axios.create({ jar, withCredentials: true }));

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
    // Casos especiales: algunos webhooks pueden no tener author.bot=true
    const isBot = message.author?.bot === true;
    const isOurBot = message.author?.id === client.user?.id;
    const isOtherBot = isBot && !isWebhook && !isOurBot;
    
    // Log detallado para debugging webhooks
    logDebug(
      `[msg-debug] webhookId=${message.webhookId} author.bot=${isBot} author.id=${message.author?.id} author.username="${message.author?.username}" isWebhook=${isWebhook} isOtherBot=${isOtherBot} isOurBot=${isOurBot}`
    );
    
    // No procesar nuestros propios mensajes
    if (isOurBot) {
      logDebug("[skip] Ignorando nuestro propio mensaje");
      return;
    }
    
    if (isOtherBot) {
      logDebug("[skip] Ignorando mensaje de bot (no webhook)");
      return;
    }

    // log básico del mensaje
    try {
      logDebug(
        `[msg] guild="${message.guild?.name}" channel="#${message.channel?.name}" attachments=${message.attachments?.size ?? 0} webhook=${isWebhook}`
      );
    } catch {}

    // si no hay adjuntos, salir
    if (!message.attachments || message.attachments.size === 0) {
      logDebug("[skip] No hay adjuntos en el mensaje");
      return;
    }

    // Log de todos los adjuntos para debugging
    message.attachments.forEach((att, index) => {
      logDebug(`[attachment-${index}] name="${att.name}" size=${att.size} url=${att.url?.slice(0, 100)}...`);
    });

    // filtrar solo .hbr2
    const hbr2 = message.attachments.find((att) =>
      typeof att.name === "string" && att.name.toLowerCase().endsWith(".hbr2")
    );
    
    if (!hbr2) {
      logDebug("[skip] No se encontró archivo .hbr2 en los adjuntos");
      return; // no hay .hbr2 en este mensaje
    }
    
    logDebug(`[found-hbr2] name="${hbr2.name}" size=${hbr2.size}`);
    

    // intentar login si hay credenciales configuradas
    if (THEHAX_USERNAME && THEHAX_PASSWORD) {
      try { await loginToTheHax(); } catch (e) { logDebug("[login-error]", String(e)); }
    }

    const statusMsg = await message.channel.send(
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
  // Intento de autenticación adicional: incluir API key/tenant también en el body por compatibilidad
  if (THEHAX_API_KEY) form.append("apiKey", THEHAX_API_KEY);
  if (THEHAX_TENANT_KEY) form.append("tenantKey", THEHAX_TENANT_KEY);

  const uploadUrl = "https://replay.thehax.pl/api/upload";
  const headers = {
    ...form.getHeaders(),
    "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0; +https://discordapp.com)",
    "Accept": "application/json",
    "Origin": "https://replay.thehax.pl",
    "Referer": "https://replay.thehax.pl/upload",
  };
  if (THEHAX_API_KEY) {
    // Evitar Authorization Bearer si el endpoint no lo usa y clasifica como invitado
    headers["X-Api-Key"] = THEHAX_API_KEY; // formato común
  }
  if (THEHAX_TENANT_KEY) {
    headers["X-Tenant-Key"] = THEHAX_TENANT_KEY; // nombre de cabecera tentativo
  }

  const resp = await http.post(uploadUrl, form, {
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

let lastLoginAt = 0;
async function loginToTheHax() {
  const now = Date.now();
  // evitar logins demasiado frecuentes (e.g., más de 1 vez cada 5 minutos)
  if (now - lastLoginAt < 5 * 60 * 1000) return;

  // obtener _csrf_token desde la página de login
  const loginPage = await http.get("https://replay.thehax.pl/login", {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0; +https://discordapp.com)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://replay.thehax.pl/login",
    },
    timeout: 20000,
  });
  const html = String(loginPage.data || "");
  const m = html.match(/name=\"_csrf_token\" value=\"([^\"]+)\"/);
  const csrf = m && m[1] ? m[1] : "";
  if (!csrf) {
    logDebug("[login] no csrf token found");
  }

  const form = new URLSearchParams();
  form.set("username", THEHAX_USERNAME);
  form.set("password", THEHAX_PASSWORD);
  form.set("rememberMe", "on");
  if (csrf) form.set("_csrf_token", csrf);

  const resp = await http.post("https://replay.thehax.pl/login", form.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0; +https://discordapp.com)",
      "Origin": "https://replay.thehax.pl",
      "Referer": "https://replay.thehax.pl/login",
    },
    maxRedirects: 0,
    validateStatus: (s) => s === 200 || s === 302 || s === 303 || (s >= 400 && s < 500),
    timeout: 20000,
  });

  // éxito típico: 302 redirect a /
  if (resp.status === 302 || resp.status === 303 || (resp.status === 200 && /logout/i.test(String(resp.data)))) {
    lastLoginAt = now;
    logDebug("[login] success");
    return;
  }

  logDebug("[login] unexpected response", String(resp.status), String(resp.data).slice(0, 200));
}

client.login(TOKEN);
