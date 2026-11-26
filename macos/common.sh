#!/bin/bash
# Configuración y utilidades comunes para los scripts de macOS.
# Se carga desde los demás scripts con:  source "$ROOT/common.sh"
# Compatible con el bash 3.2 que trae macOS (sin arrays asociativos, etc.).

SUWAYOMI_PORT="${SUWAYOMI_PORT:-4567}"
SUWAYOMI_MOBILE_PORT="${SUWAYOMI_MOBILE_PORT:-4568}"
SUWAYOMI_URL="http://localhost:$SUWAYOMI_PORT"
DATA_DIR="${SUWAYOMI_DATA_DIR:-$HOME/Library/Application Support/Tachidesk}"
INSTALL_ROOT="${SUWAYOMI_INSTALL_ROOT:-$HOME/Suwayomi}"
DEFAULT_VERSION="v2.4.2366"

# ---------------- Servidor ----------------

# ¿Responde el servidor en el puerto?
server_up() {
    nc -z -w 1 127.0.0.1 "$SUWAYOMI_PORT" >/dev/null 2>&1
}

# Arranca/detiene el servidor local ligero de la interfaz móvil (puerto 4568)
start_mobile_server() {
    local dir="$1" mac_dir
    [ -d "$dir" ] || return 0
    if nc -z -w 1 127.0.0.1 "$SUWAYOMI_MOBILE_PORT" >/dev/null 2>&1; then
        return 0
    fi
    mac_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if command -v python3 >/dev/null 2>&1; then
        if [ -f "$mac_dir/mobile-server.py" ]; then
            SUWAYOMI_MOBILE_PORT="$SUWAYOMI_MOBILE_PORT" nohup python3 "$mac_dir/mobile-server.py" >/dev/null 2>&1 &
        else
            nohup python3 -m http.server "$SUWAYOMI_MOBILE_PORT" --bind 127.0.0.1 --directory "$dir" >/dev/null 2>&1 &
        fi
        disown 2>/dev/null || true
    fi
}

stop_mobile_server() {
    pkill -f "mobile-server\.py" 2>/dev/null || true
    pkill -f "http\.server ${SUWAYOMI_MOBILE_PORT} --bind 127\.0\.0\.1" 2>/dev/null || true
}

# Imprime la carpeta del servidor (la que contiene bin/Suwayomi-Server.jar)
# buscando en las carpetas que se le pasen como argumento.
find_server_dir() {
    local root jar
    for root in "$@"; do
        [ -d "$root" ] || continue
        jar=$(find "$root" -maxdepth 4 -path '*/bin/Suwayomi-Server.jar' -type f 2>/dev/null | sort -V | tail -n 1)
        if [ -n "$jar" ]; then
            dirname "$(dirname "$jar")"
            return 0
        fi
    done
    return 1
}

# Imprime la ruta del ejecutable java: primero el JRE incluido en la carpeta
# del servidor, después el Java del sistema.
find_java() {
    local dir="$1" j
    j="$dir/jre/bin/java"
    if [ -x "$j" ]; then echo "$j"; return 0; fi
    j=$(find "$dir/jre" -maxdepth 5 -type f -name java -perm -u+x 2>/dev/null | head -n 1)
    if [ -n "$j" ]; then echo "$j"; return 0; fi
    if [ "$(uname -s)" = "Darwin" ]; then
        # No usamos "command -v java": en un Mac sin Java, /usr/bin/java es un
        # falso ejecutable que abre una ventana pidiendo instalarlo.
        if [ -x /usr/libexec/java_home ]; then
            j="$(/usr/libexec/java_home 2>/dev/null)/bin/java"
            if [ -x "$j" ]; then echo "$j"; return 0; fi
        fi
    else
        j=$(command -v java 2>/dev/null)
        if [ -n "$j" ]; then echo "$j"; return 0; fi
    fi
    return 1
}

# PIDs de los procesos de Suwayomi (uno por línea). Solo cuenta procesos java
# que ejecuten el jar, para no confundirse con otros que mencionen su nombre.
server_pids() {
    pgrep -f '(^|/)java .*-jar .*Suwayomi-(Server|Launcher)\.jar' 2>/dev/null
}

# Apaga Suwayomi: primero con SIGTERM (cierre limpio de la base de datos) y,
# si no responde en ~10 s, a la fuerza.
stop_server() {
    local pids i
    pids=$(server_pids)
    [ -n "$pids" ] || return 0
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null
    for i in 1 2 3 4 5 6 7 8 9 10; do
        [ -z "$(server_pids)" ] && return 0
        sleep 1
    done
    pids=$(server_pids)
    # shellcheck disable=SC2086
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null
    sleep 1
    return 0
}

# ---------------- Interfaz (ventanas de macOS o, si no hay, terminal) ----------------
# Se usan ventanas nativas vía osascript. Con SUWAYOMI_TERMINAL=1 (o sin
# osascript) todo se hace por terminal.

if [ "${SUWAYOMI_TERMINAL:-0}" != "1" ] && command -v osascript >/dev/null 2>&1; then
    UI_MODE=gui
else
    UI_MODE=term
fi

# ui_msg "texto" [note|caution|stop]
ui_msg() {
    if [ "$UI_MODE" = gui ]; then
        osascript - "$1" "${2:-note}" >/dev/null 2>&1 <<'OSA'
on run argv
    set t to item 1 of argv
    set k to item 2 of argv
    tell current application to activate
    if k is "stop" then
        display dialog t with title "Suwayomi" buttons {"OK"} default button "OK" with icon stop
    else if k is "caution" then
        display dialog t with title "Suwayomi" buttons {"OK"} default button "OK" with icon caution
    else
        display dialog t with title "Suwayomi" buttons {"OK"} default button "OK" with icon note
    end if
end run
OSA
    else
        printf '\n%s\n\n' "$1"
    fi
}

# ui_yesno "pregunta"  -> código 0 si responde Sí
ui_yesno() {
    local r
    if [ "$UI_MODE" = gui ]; then
        r=$(osascript - "$1" 2>/dev/null <<'OSA'
on run argv
    tell current application to activate
    try
        set r to display dialog (item 1 of argv) with title "Suwayomi" buttons {"No", "Sí"} default button "Sí"
        if button returned of r is "Sí" then return "yes"
        return "no"
    on error
        return "no"
    end try
end run
OSA
)
        [ "$r" = "yes" ]
    else
        printf '\n%s [s/N] ' "$1"
        read -r r
        case "$r" in s|S|si|SI|Si|sí|Sí|y|Y) return 0 ;; *) return 1 ;; esac
    fi
}

# ui_menu "texto" "opción 1" "opción 2" ...  -> imprime la opción elegida
# (vacío si cancela / sale)
ui_menu() {
    local prompt="$1" i n choice
    shift
    if [ "$UI_MODE" = gui ]; then
        osascript - "$prompt" "$@" 2>/dev/null <<'OSA'
on run argv
    set p to item 1 of argv
    set opts to rest of argv
    tell current application to activate
    set r to choose from list opts with title "Suwayomi - Panel de control" with prompt p OK button name "Aceptar" cancel button name "Salir"
    if r is false then return ""
    return item 1 of r
end run
OSA
    else
        printf '\n%s\n\n' "$prompt" >&2
        n=0
        for i in "$@"; do
            n=$((n + 1))
            printf '  %d) %s\n' "$n" "$i" >&2
        done
        printf '  0) Salir\n\nElige: ' >&2
        read -r choice
        case "$choice" in ''|*[!0-9]*) return 0 ;; esac
        [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "$n" ] || return 0
        n=0
        for i in "$@"; do
            n=$((n + 1))
            if [ "$n" -eq "$choice" ]; then printf '%s\n' "$i"; return 0; fi
        done
    fi
}

# Notificación del sistema (no bloquea)
ui_notify() {
    if [ "$UI_MODE" = gui ]; then
        osascript - "$1" >/dev/null 2>&1 <<'OSA' &
on run argv
    display notification (item 1 of argv) with title "Suwayomi"
end run
OSA
    else
        printf '%s\n' "$1"
    fi
}

# Ejecuta un comando en una ventana de Terminal (para instalar, ver el
# registro, etc.). Recibe el comando ya escapado como una sola cadena.
run_in_terminal() {
    local cmd="$1" tmp
    if [ "$UI_MODE" != gui ]; then
        bash -c "$cmd"
        return
    fi
    tmp=$(mktemp "${TMPDIR:-/tmp}/suwayomi-XXXXXX") || return 1
    mv "$tmp" "$tmp.command"
    tmp="$tmp.command"
    {
        printf '#!/bin/bash\n'
        printf '%s\n' "$cmd"
        printf 'echo\n'
        printf 'read -r -p "Terminado. Pulsa Enter para cerrar esta ventana" _\n'
        printf 'rm -f "$0"\n'
    } > "$tmp"
    chmod +x "$tmp"
    open "$tmp"
}
