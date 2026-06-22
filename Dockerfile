# Imagen del motor de Aura (Elvis Systems): Node + ffmpeg + yt-dlp (pip) +
# generador de PO tokens (bgutil) para esquivar el "no eres un bot" de YouTube.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl git \
 # yt-dlp por pip (para que cargue el plugin de PO token) + plugin bgutil
 && pip3 install --break-system-packages --no-cache-dir -U yt-dlp bgutil-ytdlp-pot-provider \
 # Servidor generador de PO tokens (bgutil)
 && git clone --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /bgutil \
 && cd /bgutil/server \
 && npm install \
 && npx tsc \
 && apt-get purge -y git \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

ENV PORT=3000
EXPOSE 3000
# Arranca el generador de PO tokens en segundo plano y luego el servidor de Aura.
CMD ["sh", "-c", "node /bgutil/server/build/main.js >/tmp/bgutil.log 2>&1 & exec node server.js"]
