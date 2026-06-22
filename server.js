// Motor de Aura (Elvis Systems) — servidor HTTP.
// Busca música y entrega el audio COMPLETO usando yt-dlp/ffmpeg (igual que la app
// de escritorio). La app móvil es un cliente ligero que consume estos endpoints.
import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const PORT = process.env.PORT || 3000;
// En la nube, YouTube suele pedir "confirma que no eres un bot". Si defines la
// variable YTDLP_COOKIES con la ruta a un cookies.txt exportado de tu navegador,
// yt-dlp la usará para autenticarse y evitar el bloqueo.
// yt-dlp REESCRIBE el archivo de cookies al terminar, pero /etc/secrets (Render)
// es de solo lectura. Copiamos a una ruta escribible al arrancar. Si la ruta no
// existe, desactivamos cookies para no romper las búsquedas.
let COOKIES = process.env.YTDLP_COOKIES;
if (COOKIES) {
  if (fs.existsSync(COOKIES)) {
    try {
      const w = path.join(os.tmpdir(), "aura_cookies.txt");
      fs.copyFileSync(COOKIES, w);
      COOKIES = w;
      console.log("[cookies] usando copia escribible:", w);
    } catch (e) {
      console.log("[cookies] no se pudo copiar, uso original:", e.message);
    }
  } else {
    console.log("[cookies] archivo NO encontrado, ignorando:", COOKIES);
    COOKIES = null;
  }
}
// Clientes de YouTube a probar para esquivar el bloqueo "no eres un bot" en IPs de
// nube. tv/ios/web_safari suelen funcionar sin cookies. Configurable por env.
const YT_CLIENTS = process.env.YT_PLAYER_CLIENTS || "default,tv,ios,web_safari";
function ytExtra() {
  const a = ["--extractor-args", `youtube:player_client=${YT_CLIENTS}`];
  if (COOKIES) a.push("--cookies", COOKIES);
  return a;
}

const app = express();
app.use(cors());

/* ---------- Utilidades ---------- */
function cleanTitle(raw = "") {
  return raw
    .replace(/\((official\s*)?(video|audio|lyric[s]?|music video)\)/gi, "")
    .replace(/\[(official\s*)?(video|audio|lyric[s]?|music video)\]/gi, "")
    .replace(/\|.*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normEntry(e, source) {
  if (!e || !e.id) return null;
  const id = String(e.id);
  const title = cleanTitle(e.title ?? "Sin título");
  const artist = (e.uploader ?? e.channel ?? source).replace(/ - Topic$/, "");
  const duration = Math.round(e.duration ?? 0);
  let url, artwork;
  if (source === "YouTube") {
    url = `https://www.youtube.com/watch?v=${id}`;
    artwork = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  } else {
    url = e.url ?? "";
    artwork = e.thumbnail ?? "";
  }
  if (!url) return null;
  return { id: `${source}:${id}`, title, artist, duration, artwork, url, source };
}

async function searchSource(prefix, query, n, source) {
  try {
    const { stdout } = await execFileP("yt-dlp", [
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--ignore-errors",
      ...ytExtra(),
      `${prefix}${n}:${query}`,
    ], { maxBuffer: 1024 * 1024 * 20 });
    const json = JSON.parse(stdout || "{}");
    return (json.entries ?? []).map((e) => normEntry(e, source)).filter(Boolean);
  } catch {
    return [];
  }
}

function safeBase(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function cachedFile(base) {
  const prefix = `${base}.`;
  for (const name of fs.readdirSync(CACHE_DIR)) {
    if (name.startsWith(prefix) && !name.endsWith(".part")) {
      return path.join(CACHE_DIR, name);
    }
  }
  return null;
}

async function downloadAudio(id, url) {
  const base = safeBase(id);
  const hit = cachedFile(base);
  if (hit) return hit;
  const outtmpl = path.join(CACHE_DIR, `${base}.%(ext)s`);
  const { stdout } = await execFileP("yt-dlp", [
    "-f", "bestaudio/best",
    "--no-simulate",
    "--no-warnings",
    "--no-playlist",
    "--no-part",
    "--match-filter", "!is_live", // nunca descargar directos (descarga infinita)
    ...ytExtra(),
    "--print", "after_move:filepath",
    "-o", outtmpl,
    url,
  ], { maxBuffer: 1024 * 1024 * 20 });
  const printed = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (printed && fs.existsSync(printed)) return printed;
  const found = cachedFile(base);
  if (found) return found;
  throw new Error("No se pudo obtener el audio");
}

/* ---------- Endpoints ---------- */
app.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json({ tracks: [] });
  const n = 20;
  const [yt, sc] = await Promise.all([
    searchSource("ytsearch", q, n, "YouTube"),
    searchSource("scsearch", q, n, "SoundCloud"),
  ]);
  // duración > 30s descarta de un golpe: directos/streams (duración 0) y los
  // previews de 30s de SoundCloud. < 1800s descarta mixes/podcasts larguísimos.
  const clean = (list) => list.filter((t) => t.duration > 30 && t.duration < 1800);
  const a = clean(yt), b = clean(sc);
  const tracks = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i]) tracks.push(a[i]);
    if (b[i]) tracks.push(b[i]);
  }
  res.json({ tracks });
});

// Entrega el audio completo (con soporte de rangos para streaming/seek en el móvil).
app.get("/audio", async (req, res) => {
  const id = String(req.query.id ?? "");
  const url = String(req.query.url ?? "");
  if (!id || !url) return res.status(400).send("Falta id o url");
  try {
    const file = await downloadAudio(id, url);
    res.sendFile(file); // Express maneja Range/Accept-Ranges automáticamente.
  } catch (e) {
    res.status(500).send(String(e?.message ?? e));
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, app: "Aura · Elvis Systems" }));

// Página de inicio simple (para que la raíz no muestre "Cannot GET /").
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aura · Elvis Systems</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0a0a0d;color:#f6f6f8;text-align:center}
  .c{padding:40px}
  h1{font-size:42px;margin:0;background:linear-gradient(120deg,#1ed760,#7c5cff);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  p{color:#9a9aa6;margin-top:10px}
  .ok{display:inline-block;margin-top:18px;padding:8px 16px;border-radius:20px;
    background:rgba(30,215,96,.15);color:#1ed760;font-weight:700;font-size:14px}
  code{background:#16161c;padding:2px 8px;border-radius:6px;color:#7c5cff}
</style></head><body><div class="c">
  <h1>Aura</h1>
  <p>Motor de música · Elvis Systems</p>
  <div class="ok">● Servidor en línea</div>
  <p style="margin-top:24px;font-size:13px">Endpoints: <code>/search?q=</code> · <code>/audio</code> · <code>/health</code></p>
</div></body></html>`);
});

/* ---------- Arranque ---------- */
function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Aura server (Elvis Systems) escuchando en el puerto ${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  Red/Móvil: http://${ip}:${PORT}`);
  console.log("");
});
