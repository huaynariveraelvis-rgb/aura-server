# Imagen del motor de Aura (Elvis Systems): Node + ffmpeg + yt-dlp.
FROM node:20-bookworm-slim

# yt-dlp necesita python3; ffmpeg para procesar audio.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates curl \
 && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
