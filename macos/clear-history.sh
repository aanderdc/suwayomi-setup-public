#!/bin/bash
# Borra el historial de lectura de Suwayomi-Server (equivalente a clear-history.ps1).
#
# El historial de la interfaz web se construye a partir de la columna
# LAST_READ_AT de la tabla CHAPTER. La API de Suwayomi no permite modificarla,
# así que este script lo hace directamente en la base de datos H2, usando el
# Java y la herramienta H2 que ya trae el propio Suwayomi.
#
# Solo se pone LAST_READ_AT a 0. Los capítulos siguen marcados como leídos y se
# conservan el progreso, la biblioteca y las descargas.
# Antes de modificar nada se hace una copia de database.mv.db.
#
# Uso:
#   bash clear-history.sh
#   bash clear-history.sh --force                       # cierra el servidor si está en marcha
#   bash clear-history.sh --install-dir RUTA --data-dir RUTA

set -e
set -o pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$ROOT/common.sh"

INSTALL_DIR=""
MANGA_ID=""
FORCE=0

while [ $# -gt 0 ]; do
    case "$1" in
        --install-dir) INSTALL_DIR="$2"; shift 2 ;;
        --data-dir)    DATA_DIR="$2"; shift 2 ;;
        --manga-id)    MANGA_ID="$2"; shift 2 ;;
        --force)       FORCE=1; shift ;;
        -h|--help)
            sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "Opción desconocida: $1" >&2; exit 1 ;;
    esac
done

if [ -n "$MANGA_ID" ]; then
    case "$MANGA_ID" in
        ''|*[!0-9]*|0) echo "ID de manga no válido: $MANGA_ID" >&2; exit 1 ;;
    esac
fi

# --- Localizar la carpeta del servidor --------------------------------------
if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR="$(find_server_dir "$INSTALL_ROOT" "$HOME/Downloads" || true)"
    if [ -z "$INSTALL_DIR" ]; then
        echo "No encuentro la carpeta del servidor. Indícala con --install-dir \"/ruta/Suwayomi-Server-vX-macOS-arm64\"." >&2
        exit 1
    fi
fi
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"

JAVA="$(find_java "$INSTALL_DIR" || true)"
JAR="$INSTALL_DIR/bin/Suwayomi-Server.jar"
DB="$DATA_DIR/database.mv.db"

[ -n "$JAVA" ] && [ -x "$JAVA" ] || { echo "No encuentro Java en $INSTALL_DIR/jre" >&2; exit 1; }
[ -f "$JAR" ] || { echo "No existe: $JAR" >&2; exit 1; }
[ -f "$DB" ]  || { echo "No existe: $DB" >&2; exit 1; }

echo "Servidor: $INSTALL_DIR"
echo "Datos:    $DATA_DIR"

# --- Comprobar que el servidor está cerrado ---------------------------------
if [ -n "$(server_pids)" ]; then
    if [ "$FORCE" = 1 ]; then
        echo "Cerrando el servidor ..."
        stop_server
        sleep 2
    else
        echo "Suwayomi está en marcha. Ciérralo con \"Apagar\" (o ejecuta de nuevo con --force)." >&2
        exit 1
    fi
fi

# --- Consultas a H2 ---------------------------------------------------------
DB_BASE="$DATA_DIR/database"

invoke_h2() {  # invoke_h2 "SQL" [ro]
    local url="jdbc:h2:file:$DB_BASE" out
    [ "${2:-}" = "ro" ] && url="$url;ACCESS_MODE_DATA=r"
    if ! out=$("$JAVA" -cp "$JAR" org.h2.tools.Shell -url "$url" -sql "$1" 2>&1); then
        echo "Error ejecutando H2:" >&2
        echo "$out" >&2
        return 1
    fi
    printf '%s\n' "$out"
}

WHERE_SQL="LAST_READ_AT > 0"
if [ -n "$MANGA_ID" ]; then
    WHERE_SQL="MANGA = $MANGA_ID AND LAST_READ_AT > 0"
fi

echo
echo "Capítulos con historial ahora mismo:"
invoke_h2 "SELECT COUNT(*) FROM CHAPTER WHERE $WHERE_SQL" ro

# --- Copia de seguridad -----------------------------------------------------
BACKUP="$DATA_DIR/database.mv.db.bak-$(date +%Y%m%d-%H%M%S)"
cp "$DB" "$BACKUP"
echo
echo "Copia de seguridad: $BACKUP"

# --- Borrar el historial ----------------------------------------------------
invoke_h2 "UPDATE CHAPTER SET LAST_READ_AT = 0 WHERE $WHERE_SQL" >/dev/null

echo
echo "Capítulos con historial después (debe ser 0):"
invoke_h2 "SELECT COUNT(*) FROM CHAPTER WHERE $WHERE_SQL" ro

echo
echo "Listo. Arranca Suwayomi y recarga la página Historial (Cmd+R)."
echo "Para deshacerlo: cierra Suwayomi y restaura la copia sobre database.mv.db."
