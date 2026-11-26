#!/bin/bash
# Comprueba en VirusTotal las extensiones (.jar) instaladas en Suwayomi en macOS
# (equivalente a verificar-extensiones.ps1). Necesita una API key gratuita de VirusTotal.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$ROOT/common.sh"

DIR="${1:-$DATA_DIR/extensions}"
if [ ! -d "$DIR" ]; then
    echo "No existe la carpeta $DIR. Instala alguna extensión desde Suwayomi primero." >&2
    exit 1
fi

shopt -s nullglob
JARS=("$DIR"/*.jar)
if [ "${#JARS[@]}" -eq 0 ]; then
    echo "No hay archivos .jar en $DIR" >&2
    exit 1
fi

KEY="${VT_API_KEY:-}"
if [ -z "$KEY" ]; then
    printf "Pega tu API key gratuita de VirusTotal: "
    read -r KEY
fi
[ -n "$KEY" ] || { echo "API key vacía." >&2; exit 1; }

BASE="https://www.virustotal.com/api/v3"
echo "Carpeta: $DIR"

for JAR in "${JARS[@]}"; do
    NAME="$(basename "$JAR")"
    HASH="$(shasum -a 256 "$JAR" | awk '{print $1}')"
    echo
    echo "== $NAME"
    echo "   SHA256: $HASH"

    RESP="$(curl -sS -w $'\n%{http_code}' -H "x-apikey: $KEY" "$BASE/files/$HASH")"
    CODE="${RESP##*$'\n'}"
    BODY="${RESP%$'\n'*}"

    if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
        echo "   API key no válida." >&2
        exit 1
    elif [ "$CODE" = "200" ]; then
        MAL="$(printf '%s' "$BODY" | sed -n 's/.*"malicious"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -n 1)"
        SUS="$(printf '%s' "$BODY" | sed -n 's/.*"suspicious"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -n 1)"
        echo "   Malicioso: ${MAL:-0}  Sospechoso: ${SUS:-0}"
        echo "   Informe: https://www.virustotal.com/gui/file/$HASH"
    elif [ "$CODE" = "404" ]; then
        echo "   No conocido por VirusTotal. Puedes subirlo manualmente o consultarlo en virustotal.com."
    else
        echo "   Error HTTP $CODE consultando VirusTotal."
    fi
    sleep 16
done
