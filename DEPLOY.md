# Desplegar el motor de Aura en la nube (24/7)

El servidor ya está empaquetado con Docker, así que corre igual en cualquier host.
Lo que tú haces (con tu cuenta): crear el servicio y subirlo. Yo te dejo los pasos.

## Opción recomendada para empezar: Render.com (tiene plan gratis)
1. Sube esta carpeta `server/` a un repo de GitHub (privado está bien).
2. Entra a https://render.com → **New** → **Web Service** → conecta tu repo.
3. Render detecta el `Dockerfile` solo. Deja todo por defecto.
4. Plan: el **Free** sirve para probar (se duerme tras inactividad; el primer
   play tras dormir tarda ~30s). Para uso real, el plan de pago más barato
   (~7 USD/mes) lo mantiene siempre despierto.
5. Deploy. Te dará una URL tipo `https://aura-xxxx.onrender.com`.
6. Esa URL es la que pondrás en la app Android.

## Alternativa más estable: un VPS (Hetzner/DigitalOcean/Contabo, ~5 USD/mes)
```bash
# En el servidor (Ubuntu) con Docker instalado:
git clone <tu-repo> && cd server
docker build -t aura .
docker run -d --restart=always -p 80:3000 --name aura aura
# Tu URL será http://IP_DEL_VPS
```

## ⚠️ El bloqueo de YouTube ("confirma que no eres un bot")
En IPs de datacenter YouTube a veces bloquea las descargas. Mitigación:
1. En tu PC, instala una extensión que exporte cookies a `cookies.txt`
   (formato Netscape), estando logueado en YouTube.
2. Sube ese archivo al servidor y define la variable de entorno:
   `YTDLP_COOKIES=/ruta/cookies.txt`
3. El servidor las usará automáticamente.

Si aun así se bloquea mucho, lo más fiable sigue siendo el servidor en tu propia
red (la app de escritorio), porque usa tu IP residencial.

## Probarlo
- `GET https://TU_URL/health` debe responder `{"ok":true,...}`
- `GET https://TU_URL/search?q=bad+bunny` debe devolver canciones.
