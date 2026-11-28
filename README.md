# Suwayomi Setup

Instalador visual, panel de control y **app móvil instalable (PWA)** para **[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server)** en **Windows** y **macOS**, sin escribir comandos.

> **Aviso.** Este repositorio es un proyecto independiente, sin relación con Suwayomi ni con Keiyoushi.
> **No contiene ni distribuye manga ni extensiones de terceros.** El instalador descarga Suwayomi de su
> página oficial de GitHub, y las fuentes/extensiones las eliges tú. Tú eres responsable del contenido al que
> accedas: respeta los derechos de autor y las leyes de tu país, y apoya a los autores comprando las ediciones
> oficiales cuando puedas.

---

## Inicio rápido

1. Descarga el repositorio (**Code → Download ZIP**) o clónalo con `git clone` y extráelo en una carpeta fija.
2. Haz doble clic en el lanzador de tu sistema:
   - **Windows:** `Suwayomi.bat`
   - **macOS:** `Suwayomi.command` *(si macOS avisa por script sin firma: `xattr -dr com.apple.quarantine . && chmod +x Suwayomi.command macos/*.sh`)*
3. En el panel, por orden: **1. Instalar Suwayomi** → **Encender** → **2. Añadir repositorio de extensiones**.
4. *(Opcional)* Pulsa **Acceso desde el móvil (Tailscale)** para escanear el QR e instalar la app móvil (`/movil/`) en tu Android o iPhone.

Guías detalladas para usuarios finales: [`docs/LEEME-Windows.txt`](docs/LEEME-Windows.txt) y [`docs/LEEME-macOS.txt`](docs/LEEME-macOS.txt).

---

## Estructura del repositorio

```text
suwayomi-setup-public/
├── Suwayomi.bat               # Lanzador principal de Windows (doble clic)
├── Suwayomi.command           # Lanzador principal de macOS (doble clic)
├── README.md                  # Esta guía
│
├── windows/                   # Scripts y panel visual de Windows (.ps1)
│   ├── suwayomi-gui.ps1       # Panel de control (bandeja, auto-abrir, auto-arranque)
│   ├── install.ps1            # Descarga e instala Suwayomi + JRE incluido
│   ├── setup-sources.ps1      # Añade el repositorio de extensiones Keiyoushi
│   ├── setup-tailscale.ps1    # Asistente visual Tailscale HTTPS + QR + control suspensión
│   ├── mobile-server.ps1      # Servidor local (127.0.0.1:4568) para /movil/ y bóveda aislada
│   ├── clear-history.ps1      # Borra historial completo o de un manga concreto (con backup)
│   ├── update-suwayomi.ps1    # Actualizador en 1 clic conservando biblioteca y datos
│   ├── backup-restore.ps1     # Copias y restauración de database.mv.db y .tachibk
│   ├── verificar-extensiones.ps1 / .bat  # Escáner opcional en VirusTotal
│   └── wake-pc.ps1            # Utilidad opcional de Wake-on-LAN
│
├── macos/                     # Scripts y panel visual de macOS (.sh / .py)
│   ├── common.sh              # Utilidades compartidas (ventanas nativas o --terminal)
│   ├── suwayomi-gui.sh        # Panel de control para macOS
│   ├── install.sh             # Instalador oficial para Apple Silicon e Intel
│   ├── setup-sources.sh       # Añade repositorio Keiyoushi
│   ├── setup-tailscale.sh     # Asistente Tailscale HTTPS privado
│   ├── mobile-server.py       # Servidor local (127.0.0.1:4568) para /movil/ y bóveda aislada
│   ├── clear-history.sh       # Borrado de historial (total o por --manga-id)
│   ├── update-suwayomi.sh     # Actualizador de Suwayomi
│   ├── backup-restore.sh      # Copias de seguridad y restauración
│   ├── verificar-extensiones.sh  # Escáner opcional en VirusTotal
│   ├── crear-app.sh           # Opcional: genera Suwayomi.app para el Dock/Launchpad
│   └── wake-pc.sh             # Utilidad opcional de Wake-on-LAN
│
├── mobile/                    # App web móvil instalable (PWA en /movil/)
│   ├── index.html, styles.css, app.js   # Interfaz y lector estilo Manga Dogs
│   ├── remote.js              # Modo remoto sin PC (MangaDex, LeerCapitulo ES, WeebCentral EN)
│   ├── offline.js             # Descargas locales tipo Spotify + sincronización diferida
│   ├── extras.js              # Filtro +18, tags, PIN, bóveda, recorte de bordes, Wake Lock
│   └── sw.js, manifest.json, icon-*     # Service Worker offline e iconos PWA
│
├── cloudflare-worker/         # Puente CORS gratuito (v3) para leer sin encender el PC
│   ├── mangadex-worker.js     # Código listo para pegar en Cloudflare Workers (100k req/día gratis)
│   └── README.md              # Guía paso a paso (2 minutos)
│
└── docs/                      # Guías sencillas en texto plano
    ├── LEEME-Windows.txt
    └── LEEME-macOS.txt
```

---

## Qué incluye la app móvil (`/movil/`)

- **Lector cómodo para móvil:** modo continuo tipo PDF (100% ancho, 0px de hueco) o paginado (`D→I` / `I→D`), modo por manga, paso automático al siguiente capítulo, auto-scroll manos libres, filtro nocturno + filtro cálido/sepia, brillo deslizando el borde izquierdo, zoom `2×`, recorte automático de márgenes blancos, doble página en tablet, reloj/batería, barra de progreso y Wake Lock.
- **Biblioteca y descubrimiento:** tarjeta *Seguir leyendo*, pull-to-refresh, columnas configurables (`2/3/4`), selector aleatorio (`🎲`), novedades, categorías, migración de fuente, etiquetas/tags clicables, filtro `+18`, acciones en lote por capítulo (`⋮`) y gestor de extensiones integrado.
- **Modo sin conexión (tipo Spotify):** descarga capítulos al almacenamiento del móvil (con cola pausable, auto-descarga de siguientes N y borrado al terminar) y sincroniza tu progreso al reconectar.
- **Modo remoto sin PC (en Ajustes):**
  - **Directo (sin PC)** vía tu propio Cloudflare Worker gratuito ([`cloudflare-worker/`](cloudflare-worker/README.md)): busca y lee **Mangas, Manhwas y Manhuas** desde **MangaDex (`ES/EN`)**, **LeerCapitulo (`ES`)** y **WeebCentral (`EN`)** con tu PC apagado.
  - **Suwayomi remoto (URL):** conecta con otro Suwayomi alojado en una Raspberry Pi o VPS 24/7.
- **Privacidad:** bloqueo con PIN de 4 dígitos, borrado de historial (total o por manga), exportar/importar ajustes JSON y **Bóveda oculta aislada** (instancia separada `Tachidesk-Vault` que no deja rastro en `localhost:4567/history` ni `/browse?tab=sources`, con su propio PIN e historial privado).

---

## Requisitos y rutas de datos

- **Windows 10/11 x64** (PowerShell incluido) o **macOS 12+** (Apple Silicon o Intel). No hace falta instalar Java.

| | Windows | macOS |
|---|---|---|
| Aplicación | `%USERPROFILE%\Suwayomi` | `~/Suwayomi` |
| Datos (biblioteca, descargas, DB) | `%LOCALAPPDATA%\Tachidesk` | `~/Library/Application Support/Tachidesk` |
| Bóveda oculta aislada | `%LOCALAPPDATA%\Tachidesk-Vault` | `~/Library/Application Support/Tachidesk-Vault` |

Para elegir versión o carpeta personalizada desde consola:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\install.ps1 -Version "v2.4.2366" -InstallDir "D:\Suwayomi"
```
```bash
bash macos/install.sh --version v2.4.2366 --install-dir "$HOME/Suwayomi"
```

---

## Solución de problemas rápida

- **El navegador no abre:** escribe <http://localhost:4567> a mano.
- **Sigue activo tras apagar (Windows):** `netstat -ano | findstr 4567` → `taskkill /PID <pid> /F`.
- **Sigue activo tras apagar (macOS):** `lsof -i :4567` → `kill <pid>`.
- **macOS bloquea `java`:** `xattr -dr com.apple.quarantine ~/Suwayomi`.

## Posibles mejoras futuras

- Soporte completo con instalador y panel visual para **Linux** (`.desktop` / GTK).
- Notificaciones push nativas en el móvil al detectar capítulos nuevos en segundo plano.
- Importación directa de copias `.tachibk` desde la app móvil.
- Sincronización con trackers externos (AniList / MyAnimeList) desde la interfaz móvil.

## Licencia

[MIT](LICENSE). Suwayomi-Server y las extensiones tienen sus propias licencias; consulta sus repositorios.
