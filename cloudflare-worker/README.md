# Puente gratuito Cloudflare Worker para Modo Directo Multi-fuente (sin PC)

Este Worker gratuito de **Cloudflare** (100.000 peticiones al día gratis, sin tarjeta) actúa como puente privado para que la app móvil (`/movil/`) pueda leer **con tu PC completamente apagado** desde **3 fuentes** con Mangas, Manhwas y Manhuas:

1. **MangaDex** (`ES / ES-LA / EN`) — con filtros *Todos / Manhwas / Mangas / Manhuas*, etiquetas y `+18`.
2. **LeerCapitulo** (`ES`) — enorme catálogo de **Mangas, Manhwas y Manhuas en español**.
3. **WeebCentral** (`EN`) — catálogo muy completo de **Manhwas y Mangas** de alta calidad.

> Seguridad: el código de [`mangadex-worker.js`](mangadex-worker.js) solo acepta peticiones `GET` hacia las 3 fuentes y sus servidores de imágenes (nunca actúa como proxy abierto).

## Cómo crearlo o actualizarlo en 2 minutos (gratis)

1. Entra en tu cuenta gratuita de [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Ve a **Compute (Workers)** → **Workers & Pages** → crea un Worker (o abre el tuyo existente y pulsa **Edit code**).
3. Borra el código anterior, pega el contenido completo de [`mangadex-worker.js`](mangadex-worker.js) (también puedes copiarlo con 1 toque desde **Ajustes → Modo de conexión → Ver código Worker** dentro de la app móvil) y pulsa **Deploy**.
4. Copia la URL que te da Cloudflare (por ejemplo `https://tu-worker.workers.dev`).
5. En tu móvil abre **Suwayomi Móvil → Ajustes → Modo de conexión**, elige **Directo (sin PC)**, pega tu URL y pulsa **Guardar y probar**.
