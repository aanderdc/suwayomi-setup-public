#!/bin/bash
# Asistente de copias de seguridad y restauración de Suwayomi en macOS.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$ROOT/common.sh"

BACKUP_DIR="$DATA_DIR/backups"
DB="$DATA_DIR/database.mv.db"
mkdir -p "$BACKUP_DIR"

echo "=== COPIAS DE SEGURIDAD DE SUWAYOMI (macOS) ==="
echo "Carpeta: $BACKUP_DIR"
echo
echo "  1) Crear copia de seguridad (DB + .tachibk si está encendido)"
echo "  2) Restaurar una copia de database.mv.db"
echo "  3) Abrir carpeta de copias"
echo "  0) Salir"
echo
printf "Elige una opción: "
read -r OPT

case "$OPT" in
    1)
        STAMP="$(date +%Y%m%d-%H%M%S)"
        if [ -f "$DB" ]; then
            cp "$DB" "$BACKUP_DIR/database.mv.db.bak-$STAMP"
            echo "[OK] Base de datos guardada en: $BACKUP_DIR/database.mv.db.bak-$STAMP"
        else
            echo "[!] Todavía no existe database.mv.db."
        fi
        if server_up; then
            RESP="$(curl -fsS -H 'Content-Type: application/json' \
                --data '{"query":"mutation { createBackup(input: {}) { url } }"}' \
                "$SUWAYOMI_URL/api/graphql" 2>/dev/null || true)"
            REL="$(printf '%s' "$RESP" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
            if [ -n "$REL" ]; then
                curl -fsS -o "$BACKUP_DIR/suwayomi-$STAMP.tachibk" "$SUWAYOMI_URL$REL"
                echo "[OK] Copia .tachibk (Mihon/Tachiyomi) guardada: $BACKUP_DIR/suwayomi-$STAMP.tachibk"
            fi
        fi
        ;;
    2)
        LIST=()
        while IFS= read -r f; do [ -n "$f" ] && LIST+=("$f"); done < <(ls -t "$BACKUP_DIR"/database.mv.db.bak-* "$DATA_DIR"/database.mv.db.bak-* 2>/dev/null || true)
        if [ "${#LIST[@]}" -eq 0 ]; then
            echo "No hay copias disponibles todavía."
            exit 0
        fi
        i=0
        for f in "${LIST[@]}"; do
            i=$((i + 1))
            echo "  $i) $(basename "$f")"
        done
        printf "Número a restaurar (0 para cancelar): "
        read -r SEL
        [ -n "$SEL" ] && [ "$SEL" -ge 1 ] 2>/dev/null && [ "$SEL" -le "${#LIST[@]}" ] || { echo "Cancelado."; exit 0; }
        CHOSEN="${LIST[$((SEL - 1))]}"
        if [ -n "$(server_pids)" ]; then
            echo "Apagando Suwayomi..."
            stop_server
        fi
        [ -f "$DB" ] && cp "$DB" "$BACKUP_DIR/database.mv.db.pre-restore-$(date +%Y%m%d-%H%M%S)"
        cp "$CHOSEN" "$DB"
        echo "[OK] Restaurado desde $(basename "$CHOSEN"). Enciende Suwayomi desde el panel."
        ;;
    3)
        open "$BACKUP_DIR"
        ;;
esac
