#!/bin/bash
# Comprueba la última release oficial de Suwayomi-Server en GitHub y actualiza
# conservando intacta la biblioteca y base de datos en DATA_DIR.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$ROOT/common.sh"

echo "=== ACTUALIZAR SUWAYOMI (macOS) ==="

ARCH="$(uname -m)"
case "$ARCH" in
    arm64)  SUF="macOS-arm64.zip" ;;
    x86_64) SUF="macOS-x64.zip" ;;
    *) echo "Arquitectura no soportada: $ARCH" >&2; exit 1 ;;
esac

CUR_DIR="$(find_server_dir "$INSTALL_ROOT" || true)"
CUR_VER="(no instalado)"
if [ -n "$CUR_DIR" ]; then
    CUR_VER="$(basename "$CUR_DIR")"
fi
echo "Instalado actual: $CUR_VER"

echo "Consultando última versión oficial en GitHub..."
JSON="$(curl -fsSL -H 'User-Agent: suwayomi-setup-public' https://api.github.com/repos/Suwayomi/Suwayomi-Server/releases/latest)"
TAG="$(printf '%s' "$JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
URL="$(printf '%s' "$JSON" | grep -Eo "https://github\.com/Suwayomi/Suwayomi-Server/releases/download/[^\"]*${SUF}" | head -n 1)"

[ -n "$TAG" ] && [ -n "$URL" ] || { echo "No se encontró el paquete $SUF en GitHub." >&2; exit 1; }
echo "Última versión:   $TAG"

case "$CUR_VER" in
    *"$TAG"*)
        echo "Ya tienes la última versión instalada."
        exit 0 ;;
esac

echo
echo "Tu biblioteca y base de datos ($DATA_DIR) se conservan intactas."
printf "¿Actualizar a %s ahora? [S/n] " "$TAG"
read -r ANS
case "$ANS" in n|N|no|NO) echo "Cancelado."; exit 0 ;; esac

if [ -n "$(server_pids)" ]; then
    echo "Apagando Suwayomi..."
    stop_server
fi

TMP="$(mktemp "${TMPDIR:-/tmp}/suwayomi-upd-XXXXXX.zip")"
echo "Descargando $URL ..."
curl -fL --retry 3 -o "$TMP" "$URL"
mkdir -p "$INSTALL_ROOT"
echo "Extrayendo en $INSTALL_ROOT ..."
unzip -qo "$TMP" -d "$INSTALL_ROOT"
rm -f "$TMP"
xattr -dr com.apple.quarantine "$INSTALL_ROOT" 2>/dev/null || true

echo
echo "Actualizado a $TAG. Usa \"Encender\" en el panel para abrir la nueva versión."
