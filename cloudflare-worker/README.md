# Puente gratuito Cloudflare Worker para Modo Directo (sin PC)

El navegador del móvil bloquea por seguridad (CORS) las peticiones directas desde `https://tu-pc.ts.net/movil/` hacia `https://api.mangadex.org`.
Este pequeño Worker gratuito de **Cloudflare** (100.000 peticiones al día gratis, sin tarjeta) actúa como tu puente privado para poder buscar y leer desde **MangaDex** con tu PC completamente apagado.

> Seguridad: el código de [mangadex-worker.js](mangadex-worker.js) **solo** acepta peticiones `GET` de lectura hacia `https://api.mangadex.org` (`/manga`, `/manga/tag`, `/manga/:id/feed`, `/at-home/server/:id`). No sirve como proxy abierto.

## Cómo crearlo en 2 minutos (gratis)

1. Crea o entra en tu cuenta gratuita de [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. En el menú lateral izquierdo ve a **Compute (Workers)** → **Workers & Pages** → **Create** → **Start with Hello World!** (o *Create Worker*).
3. Ponle un nombre (por ejemplo `mangadex-puente`) y pulsa **Deploy**.
4. Pulsa **Edit code**, borra el código de ejemplo y pega el contenido completo de [`mangadex-worker.js`](mangadex-worker.js) (también puedes copiarlo con 1 toque desde **Ajustes → Modo de conexión → Ver código del Worker** dentro de la app móvil).
5. Pulsa **Deploy** arriba a la derecha.
6. Copia la URL que te da Cloudflare (por ejemplo `https://mangadex-puente.tu-usuario.workers.dev`).
7. En tu móvil abre **Suwayomi Móvil → Ajustes → Modo de conexión**, elige **Directo (MangaDex sin PC)**, pega tu URL del Worker y pulsa **Guardar y probar**.

¡Listo! Aunque apagues el PC, podrás abrir la app instalada en tu móvil y leer directamente.

---

## Alternativa: usar un servidor Suwayomi remoto (todas tus extensiones 24/7)

Si quieres tener **todas tus extensiones de scans** (Keiyoushi, etc.) disponibles con tu PC apagado, puedes instalar Suwayomi-Server en una Raspberry Pi, mini-PC o VPS (por ejemplo Oracle Cloud Free Tier) con Tailscale, y en **Ajustes → Modo de conexión** elegir **Suwayomi remoto (URL)** pegando su dirección (`https://tu-vps.ts.net`).
