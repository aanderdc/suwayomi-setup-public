#!/bin/bash
# Añade el repositorio de extensiones Keiyoushi a Suwayomi (equivalente a
# setup-sources.ps1). Después eliges e instalas las fuentes desde la propia
# interfaz web. El servidor tiene que estar encendido.
#
# Uso:  bash setup-sources.sh [http://localhost:4567]

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$ROOT/common.sh"

SERVER="${1:-$SUWAYOMI_URL}"
STORE_URL="https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"

wait_server() {
    local i code
    for i in $(seq 1 60); do
        code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$SERVER/" 2>/dev/null || true)
        [ "$code" = "200" ] && return 0
        sleep 2
    done
    echo "El servidor no responde en $SERVER. Enciende Suwayomi primero." >&2
    return 1
}

# Envía una consulta GraphQL; imprime la respuesta. Falla si el HTTP no es 2xx.
graphql() {
    local body resp code
    body=$(printf '{"query":"%s"}' "$1")
    resp=$(curl -sS -m 60 -w $'\n%{http_code}' \
        -H 'Content-Type: application/json' \
        --data "$body" "$SERVER/api/graphql")
    code="${resp##*$'\n'}"
    resp="${resp%$'\n'*}"
    case "$code" in
        2*) printf '%s\n' "$resp" ;;
        *)  echo "GraphQL HTTP $code: $resp" >&2; return 1 ;;
    esac
}

echo "Esperando al servidor en $SERVER ..."
wait_server

echo "Añadiendo repositorio de extensiones Keiyoushi ..."
resp=$(graphql "mutation { addExtensionStore(input:{indexUrl:\\\"$STORE_URL\\\"}) { clientMutationId } }")
case "$resp" in
    *'"errors"'*) echo "  (aviso del servidor, normal si el repositorio ya estaba añadido): ${resp:0:200}" ;;
esac

echo
echo "Listo. Repositorio de extensiones añadido."
echo "Abre $SERVER, ve a Browse/Explorar > Extensions e instala las fuentes que quieras."
