#!/bin/bash
# Envía un paquete mágico Wake-on-LAN (UDP puerto 9) o muestra la MAC local.
# Uso:  bash wake-pc.sh [AA:BB:CC:DD:EE:FF]

set -e
MAC="${1:-}"

if [ -z "$MAC" ]; then
    echo "=== DIRECCIÓN MAC DE ESTE EQUIPO (para Wake-on-LAN) ==="
    if command -v ifconfig >/dev/null 2>&1; then
        ifconfig | awk '/^[a-z0-9]+:/{iface=$1} /ether /{print iface, $2}'
    elif command -v ip >/dev/null 2>&1; then
        ip link show | awk '/^[0-9]+:/{iface=$2} /link\/ether/{print iface, $2}'
    fi
    echo
    echo "Para despertar un PC en tu red local: bash wake-pc.sh AA:BB:CC:DD:EE:FF"
    exit 0
fi

python3 - "$MAC" <<'PY'
import re, socket, sys
clean = re.sub(r'[^0-9a-fA-F]', '', sys.argv[1])
if len(clean) != 12:
    sys.exit("Dirección MAC no válida")
mac = bytes.fromhex(clean)
pkt = b'\xff' * 6 + mac * 16
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.sendto(pkt, ('255.255.255.255', 9))
s.close()
print(f"Paquete Wake-on-LAN enviado a {sys.argv[1]}")
PY
