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
    start_mobile_server "$ROOT/mobile"
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
                open "$SUWAYOMI_URL"
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
    items+=("$L_MOBILE" "$L_LOG" "$L_FOLDER" "$L_HIST")

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
    esac
    # Pequeña pausa para que el estado se actualice antes de volver a mostrar el menú
    sleep 1
done
