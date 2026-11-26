#!/bin/bash
# Equivalente a Suwayomi.bat: doble clic en Finder para abrir el panel de control.
cd "$(dirname "$0")" || exit 1
nohup bash ./macos/suwayomi-gui.sh >/dev/null 2>&1 &
disown 2>/dev/null || true
echo "Panel de Suwayomi abierto. Puedes cerrar esta ventana."
