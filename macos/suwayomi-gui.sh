#!/bin/bash
# Panel de control de Suwayomi para macOS (equivalente a suwayomi-gui.ps1).
# Usa ventanas nativas de macOS (osascript). Con --terminal usa un menú de texto.

ROOT="$(cd "$(dirname "$0")" && pwd)"
[ "$1" = "--terminal" ] && export SUWAYOMI_TERMINAL=1
# shellcheck source=common.sh
source "$ROOT/common.sh"

L_START="Encender"
L_STOP="Apagar"
L_OPEN="Abrir Suwayomi en el navegador"
L_INSTALL="1. Instalar Suwayomi"
L_SOURCES="2. Añadir repositorio de extensiones"
L_LOG="Ver registro"
L_FOLDER="Abrir carpeta de datos"
L_HIST="Borrar historial de lectura"
L_MOBILE="Acceso desde el móvil (Tailscale)"
L_UPDATE="Actualizar Suwayomi"
L_BACKUP="Copia de seguridad / Restaurar"
L_SCAN="Escanear extensiones (VirusTotal)"
L_AUTO="Inicio automático con macOS"
L_AUTOOPEN_ON="Abrir navegador al encender: SÍ (pulsar para desactivar)"
L_AUTOOPEN_OFF="Abrir navegador al encender: NO (pulsar para activar)"

auto_open_enabled() {
    [ ! -f "$DATA_DIR/no-auto-open-browser" ]
}

do_toggle_autoopen() {
    mkdir -p "$DATA_DIR"
    if auto_open_enabled; then
        touch "$DATA_DIR/no-auto-open-browser"
        ui_notify "Ya no se abrirá el navegador automáticamente al encender."
    else
        rm -f "$DATA_DIR/no-auto-open-browser"
        ui_notify "Se volverá a abrir el navegador automáticamente al encender."
    fi
}

q() { printf '%q' "$1"; }   # escapa una ruta para meterla en un comando

get_state() {
    if server_up; then
        echo ON
    elif [ -n "$(server_pids)" ]; then
        echo STARTING
    elif find_server_dir "$INSTALL_ROOT" >/dev/null 2>&1; then
        echo OFF
    else
        echo NOINST
    fi
}

# ---------------- Acciones ----------------

do_start() {
    local dir java out
    dir="$(find_server_dir "$INSTALL_ROOT")" || {
        ui_msg 'Suwayomi no está instalado. Elige "1. Instalar Suwayomi".' caution
        return
    }
    java="$(find_java "$dir")" || {
        ui_msg 'No se encontró Java. Reinstala Suwayomi con la opción "1. Instalar Suwayomi".' stop
        return
    }
    mkdir -p "$DATA_DIR"
    start_mobile_server "$(dirname "$ROOT")/mobile"
    out="$DATA_DIR/suwayomi-stdout.log"
    # Se arranca el servidor directamente (sin la ventana del lanzador).
    # - initialOpenInBrowserEnabled=false: el navegador lo abre este panel, así no salen dos pestañas.
    # - systemTrayEnabled=false: no hace falta icono en la barra de menús; se apaga desde aquí.
    # - apple.awt.UIElement: evita el icono de Java saltando en el Dock.
    (
        cd "$dir" || exit 1
        nohup "$java" --add-exports=java.desktop/sun.awt=ALL-UNNAMED \
            -Dapple.awt.UIElement=true \
            -Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false \
            -Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false \
            -jar bin/Suwayomi-Server.jar >>"$out" 2>&1 &
    )
    ui_notify "Encendiendo Suwayomi, puede tardar unos segundos..."
    # Espera en segundo plano a que responda y abre el navegador (hasta 90 s).
    (
        i=0
        while [ $i -lt 45 ]; do
            if server_up; then
                if auto_open_enabled; then
                    open "$SUWAYOMI_URL"
                fi
                exit 0
            fi
            sleep 2
            i=$((i + 1))
        done
        ui_notify 'El servidor no respondió en 90 segundos. Usa "Ver registro" para ver el motivo.'
    ) >/dev/null 2>&1 &
    disown 2>/dev/null || true
}

do_stop() {
    stop_server
    stop_mobile_server
    ui_notify "Suwayomi apagado."
}

do_install() {
    run_in_terminal "bash $(q "$ROOT/install.sh")"
}

do_sources() {
    run_in_terminal "bash $(q "$ROOT/setup-sources.sh")"
}

do_log() {
    local log="$DATA_DIR/logs/application.log"
    if [ ! -f "$log" ]; then
        log="$DATA_DIR/suwayomi-stdout.log"
    fi
    if [ ! -f "$log" ]; then
        ui_msg "Todavía no hay registro. Enciende Suwayomi primero." note
        return
    fi
    run_in_terminal "echo 'Registro en vivo (Ctrl+C para salir):'; tail -n 40 -f $(q "$log")"
}

do_folder() {
    if [ ! -d "$DATA_DIR" ]; then
        ui_msg "Todavía no existe la carpeta de datos. Enciende Suwayomi una vez." note
        return
    fi
    open "$DATA_DIR"
}

do_history() {
    local extra=""
    if [ -n "$(server_pids)" ]; then
        ui_yesno "Suwayomi está encendido. Para borrar el historial hay que apagarlo antes.

¿Apagarlo y continuar?" || return
        extra=" --force"
    fi
    ui_yesno "Se borrará el historial de lectura (los capítulos seguirán marcados como leídos). Antes se hace una copia de seguridad de la base de datos.

¿Continuar?" || return
    run_in_terminal "bash $(q "$ROOT/clear-history.sh")$extra"
}

do_mobile() {
    bash "$ROOT/setup-tailscale.sh"
}

do_update() {
    run_in_terminal "bash $(q "$ROOT/update-suwayomi.sh")"
}

do_backup() {
    run_in_terminal "bash $(q "$ROOT/backup-restore.sh")"
}

do_scan() {
    run_in_terminal "bash $(q "$ROOT/verificar-extensiones.sh")"
}

do_autostart() {
    local plist="$HOME/Library/LaunchAgents/com.suwayomi.setup.plist"
    if [ -f "$plist" ]; then
        if ui_yesno "El inicio automático con macOS está ACTIVADO.

¿Desactivarlo?"; then
            launchctl unload "$plist" 2>/dev/null || true
            rm -f "$plist"
            ui_msg "Inicio automático con macOS desactivado." note
        fi
        return
    fi
    local dir java
    dir="$(find_server_dir "$INSTALL_ROOT")" || { ui_msg "Instala Suwayomi primero." caution; return; }
    java="$(find_java "$dir")" || { ui_msg "No se encontró Java." stop; return; }
    if ui_yesno "¿Arrancar Suwayomi y el servidor móvil automáticamente al iniciar sesión en macOS?"; then
        mkdir -p "$HOME/Library/LaunchAgents"
        cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.suwayomi.setup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>cd "$dir" &amp;&amp; "$java" --add-exports=java.desktop/sun.awt=ALL-UNNAMED -Dapple.awt.UIElement=true -Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false -Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false -jar bin/Suwayomi-Server.jar &amp; python3 "$ROOT/mobile-server.py" &amp; wait</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
        launchctl load "$plist" 2>/dev/null || true
        ui_msg "Inicio automático con macOS activado." note
    fi
}

# ---------------- Bucle principal ----------------

while true; do
    state="$(get_state)"
    items=()
    case "$state" in
        ON)       status="ENCENDIDO ✅"
                  items=("$L_OPEN" "$L_STOP" "$L_SOURCES") ;;
        STARTING) status="INICIANDO… ⏳"
                  items=("$L_STOP") ;;
        OFF)      status="APAGADO 🔴"
                  items=("$L_START") ;;
        NOINST)   status="NO INSTALADO ⚪️"
                  items=("$L_INSTALL") ;;
    esac
    if auto_open_enabled; then
        L_AO="$L_AUTOOPEN_ON"
    else
        L_AO="$L_AUTOOPEN_OFF"
    fi
    items+=("$L_MOBILE" "$L_AO" "$L_UPDATE" "$L_BACKUP" "$L_SCAN" "$L_AUTO" "$L_LOG" "$L_FOLDER" "$L_HIST")

    if [ "$state" = NOINST ]; then
        hint="Bienvenido. Elige \"1. Instalar Suwayomi\" para empezar."
    elif [ "$state" = STARTING ]; then
        hint="Se abrirá el navegador cuando esté listo. Vuelve a abrir el panel para ver el estado."
    else
        hint="Cerrar el panel NO apaga Suwayomi: usa \"Apagar\"."
    fi

    choice="$(ui_menu "Estado: $status

$hint" "${items[@]}")"
    [ -n "$choice" ] || break

    case "$choice" in
        "$L_START")   do_start ;;
        "$L_STOP")    do_stop ;;
        "$L_OPEN")    open "$SUWAYOMI_URL" ;;
        "$L_INSTALL") do_install ;;
        "$L_SOURCES") do_sources ;;
        "$L_LOG")     do_log ;;
        "$L_FOLDER")  do_folder ;;
        "$L_HIST")    do_history ;;
        "$L_MOBILE")  do_mobile ;;
        "$L_UPDATE")  do_update ;;
        "$L_BACKUP")  do_backup ;;
        "$L_SCAN")    do_scan ;;
        "$L_AUTO")    do_autostart ;;
        "$L_AUTOOPEN_ON"|"$L_AUTOOPEN_OFF") do_toggle_autoopen ;;
    esac
    # Pequeña pausa para que el estado se actualice antes de volver a mostrar el menú
    sleep 1
done
