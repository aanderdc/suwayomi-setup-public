# Suwayomi Setup (En desarrollo)

Scripts para instalar y manejar **[Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server)**
(lector de manga autoalojado) en **Windows** y **macOS** sin escribir comandos: un panel con botones para
instalar, encender, apagar y abrir el lector en el navegador.

> **Aviso.** Este repositorio es un proyecto independiente, sin relación con Suwayomi ni con Keiyoushi.
> **No contiene ni distribuye manga ni extensiones de terceros.** El instalador descarga Suwayomi de su
> página oficial de GitHub, y las extensiones (fuentes) las eliges tú desde la interfaz de Suwayomi.
> Tú eres responsable del contenido al que accedas: respeta los derechos de autor y las leyes de tu país, y
> apoya a los autores comprando las ediciones oficiales cuando puedas.

## Qué hace cada archivo

| Windows | macOS | Para qué sirve |
|---|---|---|
| `Suwayomi.bat` | `Suwayomi.command` | Abre el panel de control (doble clic). |
| `suwayomi-gui.ps1` | `suwayomi-gui.sh` | El panel: estado, encender, apagar, abrir, registro, carpeta de datos. En macOS usa ventanas nativas; con `--terminal` ofrece un menú de texto. |
| `install.ps1` | `install.sh` | Descarga la release oficial de Suwayomi (incluye su propio Java) y la extrae. |
| `setup-sources.ps1` | `setup-sources.sh` | Con el servidor encendido, añade el repositorio de extensiones [Keiyoushi](https://github.com/keiyoushi/extensions). |
| `clear-history.ps1` | `clear-history.sh` | Borra el historial de lectura (con copia de seguridad previa). |
| `verificar-extensiones.ps1` | — | Comprueba en VirusTotal las extensiones instaladas (solo Windows; necesita una API key gratuita). |
| `setup-tailscale.ps1` | `setup-tailscale.sh` | Asistente visual para usar Suwayomi desde el móvil con Tailscale (acceso privado HTTPS, código QR en Windows y control de suspensión). |
| `mobile/` | `mobile/` | Lector web móvil estilo app (PWA, ruta `/movil/`): scroll vertical continuo o paginado, barra inferior, filtro nocturno y sincronización con Suwayomi. |
| — | `common.sh` | Configuración compartida de los scripts de macOS. |
| — | `crear-app.sh` | Opcional: crea `Suwayomi.app` para abrir el panel sin ventana de Terminal. |

Instrucciones sencillas para usuarios finales: [`LEEME.txt`](LEEME.txt) (Windows) y
[`LEEME-macOS.txt`](LEEME-macOS.txt) (macOS).

## Requisitos

- **Windows 10/11 x64** (PowerShell, ya incluido) o **macOS 12+** (Apple Silicon o Intel).
- Conexión a internet. No necesitas instalar Java: el paquete oficial trae el suyo.

## Instalación

1. Descarga este repositorio (**Code → Download ZIP**) o clónalo con `git clone`, y extráelo en una carpeta fija.
   No ejecutes nada desde dentro del zip.
2. Abre el panel: `Suwayomi.bat` (Windows) o `Suwayomi.command` (macOS).
3. En el panel, por orden: **1. Instalar Suwayomi** → **Encender** → **2. Añadir repositorio de extensiones**.
4. En el navegador (<http://localhost:4567>) ve a **Browse/Explorar → Extensions**, instala las fuentes que
   quieras y empieza a leer.

Es normal que Windows (SmartScreen) o macOS (Gatekeeper) avisen con scripts sin firma digital. En macOS, si
bloquea los archivos: `xattr -dr com.apple.quarantine . && chmod +x *.command *.sh` dentro de la carpeta.

## Uso diario

Abre el panel y usa **Encender**, **Apagar** o **Abrir Suwayomi en el navegador**.
**Cerrar la ventana del panel no apaga Suwayomi**; usa el botón **Apagar**.

## Acceso desde el móvil (opcional, con Tailscale)

Si quieres leer desde tu móvil Android o iPhone (con WiFi o con datos móviles) sin abrir puertos del router ni exponer Suwayomi a Internet:

1. En el panel de control, pulsa **Acceso desde el móvil (Tailscale)**.
2. Pulsa **Activar acceso desde el móvil** y sigue los avisos en pantalla (instala Tailscale, inicia sesión y activa HTTPS privado/Serve; nunca se activa Funnel).
3. En tu móvil, instala la app **Tailscale**, entra con la **misma cuenta** y activa la conexión VPN.
4. Escanea el **código QR** que muestra el asistente (en Windows) o abre el enlace privado `https://...ts.net/movil/` que se copia al portapapeles.

La ruta `/movil/` abre un **lector móvil estilo app (PWA)** diseñado para pantalla pequeña (sin instalar APKs): cuadrícula de portadas con barra inferior, modo vertical continuo sin huecos o paginado deslizando, toque central para ocultar/mostrar controles, filtro nocturno y progreso sincronizado con Suwayomi. Puedes añadirlo a la pantalla de inicio del móvil para leer a pantalla completa, y desde *Ajustes* abrir el Suwayomi completo (`/`) cuando quieras gestionar extensiones.

En Windows, el propio asistente incluye un botón para **evitar que el PC se suspenda cuando está enchufado** (y restaurar tu ajuste anterior con un clic), ya que si el PC se suspende se corta la conexión desde el móvil.

## Configuración

| | Windows | macOS |
|---|---|---|
| Aplicación | `%USERPROFILE%\Suwayomi` | `~/Suwayomi` |
| Datos (biblioteca, descargas, base de datos) | `%LOCALAPPDATA%\Tachidesk` | `~/Library/Application Support/Tachidesk` |

En macOS puedes cambiarlo con las variables `SUWAYOMI_INSTALL_ROOT`, `SUWAYOMI_DATA_DIR` y `SUWAYOMI_PORT`.
La versión instalada por defecto es `v2.4.2366`; cámbiala con `-Version` (Windows) o `--version` (macOS):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Version "v2.4.2366" -InstallDir "D:\Suwayomi"
```
```bash
bash install.sh --version v2.4.2366 --install-dir "$HOME/Suwayomi"
```

## Notas

- Los binarios de Suwayomi **no** están en este repositorio: se descargan de su release oficial.
- En macOS el panel arranca `bin/Suwayomi-Server.jar` directamente con el JRE incluido, sin la ventana del
  lanzador ni el icono de bandeja, y es el propio panel quien abre el navegador. **Apagar** envía primero una
  señal de cierre limpio y solo fuerza el cierre si no responde en unos 10 s.
- Evita apagar mientras Suwayomi descarga o actualiza la biblioteca.
- Backup: con Suwayomi apagado, copia `database.mv.db` y la carpeta `downloads` de la carpeta de datos.
- Para acceder desde el móvil de forma privada usa el botón **Acceso desde el móvil (Tailscale)** (no requiere abrir puertos ni cambiar `server.conf`). Para acceso directo en red local sin Tailscale, configura `server.ip` en `server.conf`.
- Las extensiones son código de terceros que se ejecuta en tu equipo: instala solo las de repositorios en los
  que confíes. Los scripts de este repositorio son texto plano y puedes leerlos antes de ejecutarlos.

## Solución de problemas

- **El navegador no abre:** escribe <http://localhost:4567> a mano.
- **Dice que el servidor no responde:** espera 30 segundos y pulsa **Abrir Suwayomi en el navegador**.
- **Algo falla:** pulsa **Ver registro** y revisa el último error.
- **Sigue activo tras apagar** (Windows): `netstat -ano | findstr 4567` da el PID; ciérralo con `taskkill /PID <pid> /F`.
- **Sigue activo tras apagar** (macOS): `lsof -i :4567` da el PID; ciérralo con `kill <pid>`.
- **macOS bloquea `java`:** `xattr -dr com.apple.quarantine ~/Suwayomi`.

## Licencia

[MIT](LICENSE). Suwayomi-Server y las extensiones tienen sus propias licencias; consulta sus repositorios.
