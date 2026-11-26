#!/bin/bash
# OPCIONAL: crea "Suwayomi.app" junto a esta carpeta para abrir el panel con doble clic
# sin que se quede una ventana de Terminal abierta. Necesita macOS (osacompile).
# La app apunta a esta carpeta: si la mueves, vuelve a ejecutar este script.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
command -v osacompile >/dev/null 2>&1 || { echo "osacompile no está disponible (solo macOS)." >&2; exit 1; }
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
SCRIPT="$(esc "$ROOT/suwayomi-gui.sh")"
rm -rf "$ROOT/Suwayomi.app"
osacompile -o "$ROOT/Suwayomi.app" -e "do shell script \"/bin/bash \" & quoted form of \"$SCRIPT\" & \" >/dev/null 2>&1 &\""
xattr -dr com.apple.quarantine "$ROOT/Suwayomi.app" 2>/dev/null || true
echo "Creada: $ROOT/Suwayomi.app"
echo "Puedes arrastrarla al Dock. Ábrela con doble clic."
