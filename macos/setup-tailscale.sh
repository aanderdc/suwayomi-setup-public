#!/bin/bash
# Configura el acceso privado a Suwayomi desde el móvil en macOS usando Tailscale Serve (HTTPS).
#
# - No abre puertos en el router ni expone Suwayomi a Internet (nunca activa Funnel).
# - Solo los dispositivos con TU cuenta de Tailscale pueden acceder.
# - Usa ventanas nativas de macOS vía common.sh (o menú de texto con --terminal).

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
[ "${1:-}" = "--terminal" ] && export SUWAYOMI_TERMINAL=1
# shellcheck source=common.sh
source "$ROOT/common.sh"

find_tailscale() {
    if command -v tailscale >/dev/null 2>&1; then
        command -v tailscale
        return 0
    fi
    if [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
        echo "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
        return 0
    fi
    return 1
}

ts_backend_state() {
    local ts="$1" out
    out=$("$ts" status --json 2>/dev/null || true)
    printf '%s' "$out" | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

ts_dns_name() {
    local ts="$1" out
    out=$("$ts" status --json 2>/dev/null || true)
    printf '%s' "$out" | sed -n 's/.*"DNSName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | sed 's/\.$//'
}

ts_serve_active() {
    local ts="$1" out
    out=$("$ts" serve status --json 2>/dev/null || true)
    case "$out" in
        *":$SUWAYOMI_PORT"*) return 0 ;;
        *) return 1 ;;
    esac
}

ts_funnel_active() {
    local ts="$1" out
    out=$("$ts" serve status --json 2>/dev/null || true)
    case "$out" in
        *'"AllowFunnel"'*true*) return 0 ;;
        *) return 1 ;;
    esac
}

copy_url() {
    if command -v pbcopy >/dev/null 2>&1; then
        printf '%s' "$1" | pbcopy
    fi
}

ensure_mobile_route() {
    local ts="$1"
    start_mobile_server "$(dirname "$ROOT")/mobile"
    "$ts" serve --bg --set-path /movil "http://127.0.0.1:$SUWAYOMI_MOBILE_PORT" >/dev/null 2>&1 || true
}

run_and_open_url() {
    local ts="$1" prompt_msg="$2" check_fn="$3"
    shift 3
    local tmp pid i txt url opened=0
    tmp=$(mktemp "${TMPDIR:-/tmp}/suwayomi-ts-XXXXXX")
    "$ts" "$@" >"$tmp" 2>&1 &
    pid=$!

    for i in $(seq 1 150); do
        sleep 2
        txt=$(cat "$tmp" 2>/dev/null || true)
        if [ "$opened" = 0 ]; then
            url=$(printf '%s\n' "$txt" | grep -Eo 'https://login\.tailscale\.com/[^[:space:]"'"'"')]+' | head -n 1 || true)
            if [ -n "$url" ]; then
                opened=1
                open "$url" 2>/dev/null || true
                ui_msg "$prompt_msg" note
            fi
        fi
        if "$check_fn" "$ts"; then
            kill "$pid" 2>/dev/null || true
            rm -f "$tmp"
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            break
        fi
    done

    kill "$pid" 2>/dev/null || true
    rm -f "$tmp"
    "$check_fn" "$ts"
}

check_running() {
    [ "$(ts_backend_state "$1")" = "Running" ]
}

do_activate() {
    local ts state dns url
    ts="$(find_tailscale || true)"
    if [ -z "$ts" ]; then
        if ui_yesno "Tailscale no está instalado en este Mac.

Es gratuito y crea una red privada entre tu Mac y tu móvil sin abrir puertos del router.

¿Abrir la página oficial para instalar Tailscale?"; then
            open "https://tailscale.com/download/mac" 2>/dev/null || true
            ui_msg "Instala y abre Tailscale en tu Mac, y cuando termines vuelve a abrir esta opción." note
        fi
        return
    fi

    if [ -d "/Applications/Tailscale.app" ]; then
        open -a Tailscale 2>/dev/null || true
        sleep 1
    fi

    state="$(ts_backend_state "$ts")"
    if [ "$state" != "Running" ]; then
        if ! run_and_open_url "$ts" \
            "Se ha abierto Tailscale en el navegador.

1. Inicia sesión con la MISMA cuenta que usarás en tu móvil.
2. Pulsa Connect.

Pulsa OK cuando lo hayas hecho." \
            check_running up; then
            ui_msg "No se completó el inicio de sesión en Tailscale. Asegúrate de haberlo abierto y vuelve a intentarlo." caution
            return
        fi
    fi

    if ! ts_serve_active "$ts"; then
        if ! run_and_open_url "$ts" \
            "Tailscale pide activar HTTPS privado (Serve) una sola vez.

1. En la página que se ha abierto, pulsa Enable.
2. NO actives Funnel (daría acceso público).

Pulsa OK cuando lo hayas activado." \
            ts_serve_active serve --bg "http://127.0.0.1:$SUWAYOMI_PORT"; then
            ui_msg "No se pudo activar Tailscale Serve todavía. Si acabas de pulsar Enable, espera unos segundos y vuelve a intentarlo." caution
            return
        fi
    fi

    if ts_funnel_active "$ts"; then
        "$ts" funnel --https=443 off >/dev/null 2>&1 || true
    fi

    dns="$(ts_dns_name "$ts")"
    if [ -z "$dns" ]; then
        ui_msg "Acceso activado, pero no pude leer el nombre de tu equipo en Tailscale. Revisa 'tailscale status'." caution
        return
    fi
    ensure_mobile_route "$ts"
    url="https://$dns/movil/"
    copy_url "$url"

    ui_msg "Acceso privado activado (enlace del lector móvil copiado al portapapeles):

$url

En tu móvil:
1. Instala Tailscale y entra con la MISMA cuenta.
2. Activa la conexión VPN.
3. Abre el enlace en Chrome o Safari (funciona con WiFi o datos) y pulsa 'Añadir a pantalla de inicio'.

Recuerda dejar el Mac encendido y Suwayomi en marcha." note
}

do_deactivate() {
    local ts
    ts="$(find_tailscale || true)"
    [ -n "$ts" ] || return
    ui_yesno "¿Desactivar el acceso a Suwayomi desde el móvil?

Podrás volver a activarlo cuando quieras." || return
    "$ts" funnel --https=443 off >/dev/null 2>&1 || true
    "$ts" serve --https=443 --set-path /movil off >/dev/null 2>&1 || true
    "$ts" serve --https=443 off >/dev/null 2>&1 || true
    ui_msg "Acceso desde el móvil desactivado." note
}

# ---------------- Menú principal ----------------
TS="$(find_tailscale || true)"
L_ACT="Activar / configurar acceso móvil"
L_COPY="Copiar enlace privado"
L_QR="Mostrar enlace y código QR"
L_OPEN="Probar enlace en el navegador"
L_OFF="Desactivar acceso móvil"
L_FIX="Desactivar Funnel (hacerlo privado)"

show_qr_terminal() {
    local url="$1"
    run_in_terminal "printf '\nEnlace privado para tu móvil:\n  %s\n\n' '$url'; if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 '$url'; else echo '(Instala qrencode con brew install qrencode si quieres verlo como QR en Terminal, o copia el enlace de arriba.)'; fi"
}

while true; do
    TS="$(find_tailscale || true)"
    items=()
    if [ -n "$TS" ] && ts_funnel_active "$TS"; then
        status="ATENCIÓN: Funnel público activo ⚠️"
        items=("$L_FIX" "$L_OFF")
    elif [ -n "$TS" ] && ts_serve_active "$TS"; then
        ensure_mobile_route "$TS"
        DNS="$(ts_dns_name "$TS")"
        URL="https://$DNS/movil/"
        status="ACTIVO ✅
Enlace lector móvil: $URL"
        items=("$L_COPY" "$L_QR" "$L_OPEN" "$L_OFF")
    else
        status="NO ACTIVADO ⚪️
Acceso privado HTTPS con Tailscale (sin abrir puertos)."
        items=("$L_ACT")
    fi

    choice="$(ui_menu "Acceso desde el móvil (Tailscale)

Estado: $status" "${items[@]}")"
    [ -n "$choice" ] || break

    case "$choice" in
        "$L_ACT")  do_activate ;;
        "$L_COPY") copy_url "$URL"; ui_notify "Enlace copiado al portapapeles." ;;
        "$L_QR")   show_qr_terminal "$URL" ;;
        "$L_OPEN") open "$URL" ;;
        "$L_OFF")  do_deactivate ;;
        "$L_FIX")  "$TS" funnel --https=443 off >/dev/null 2>&1 || true; ui_msg "Funnel desactivado. El acceso vuelve a ser privado." note ;;
    esac
done
