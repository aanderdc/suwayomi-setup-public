#!/bin/bash
# Instala Suwayomi-Server en macOS (equivalente a install.ps1).
# Descarga la release oficial (macOS-arm64 o macOS-x64 según tu Mac) y la
# extrae en ~/Suwayomi. Incluye su propio Java, no necesitas instalarlo.
#
# Uso:
#   bash install.sh
#   bash install.sh --version v2.4.2366 --install-dir "$HOME/Suwayomi"

set -e
set -o pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$ROOT/common.sh"

VERSION="$DEFAULT_VERSION"
INSTALL_DIR="$INSTALL_ROOT"

while [ $# -gt 0 ]; do
    case "$1" in
        --version)     VERSION="$2"; shift 2 ;;
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "Opción desconocida: $1" >&2; exit 1 ;;
    esac
done

# --- Arquitectura -----------------------------------------------------------
# hw.optional.arm64 vale 1 en Apple Silicon incluso si la Terminal corre bajo Rosetta.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
    ARCH="arm64"
elif [ "$(uname -m)" = "x86_64" ]; then
    ARCH="x64"
else
    echo "Arquitectura no soportada: $(uname -m)" >&2
    exit 1
fi

NAME="Suwayomi-Server-$VERSION-macOS-$ARCH"
FILE="$NAME.tar.gz"
URL="https://github.com/Suwayomi/Suwayomi-Server/releases/download/$VERSION/$FILE"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/suwayomi-install-XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Descargando $URL ..."
echo "(son unos 300 MB, puede tardar un rato)"
curl -L --fail --retry 3 -o "$TMP_DIR/$FILE" "$URL" || {
    echo "Falló la descarga. Comprueba tu conexión y que la versión $VERSION existe." >&2
    exit 1
}

mkdir -p "$INSTALL_DIR"
echo "Extrayendo en $INSTALL_DIR ..."
tar -xzf "$TMP_DIR/$FILE" -C "$INSTALL_DIR"

APP="$INSTALL_DIR/$NAME"
if [ ! -d "$APP" ]; then
    # Por si la carpeta interna tuviera otro nombre
    FOUND="$(find_server_dir "$INSTALL_DIR" || true)"
    [ -n "$FOUND" ] || { echo "No se encontró la carpeta extraída en $INSTALL_DIR" >&2; exit 1; }
    APP="$FOUND"
fi

# Por si acaso: permisos de ejecución y sin marca de cuarentena de Gatekeeper
# (curl no la añade, pero así funciona también si se copió con el navegador).
chmod +x "$APP"/jre/bin/* "$APP"/*.command 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo
echo "Instalado en: $APP"
echo "1) Enciende Suwayomi desde el panel (Suwayomi.command) con el botón/opción \"Encender\"."
echo "2) Con el servidor corriendo, elige \"2. Añadir repositorio de extensiones\"."
echo "3) Abre $SUWAYOMI_URL"
