#!/usr/bin/env python3
"""Servidor HTTP local ligero (127.0.0.1:4568) para mobile/ en macOS.
Sirve archivos estáticos de mobile/, acción POST /__action__/clear-history
y proxy bajo demanda hacia una instancia aislada de bóveda (127.0.0.1:4569).
"""
import functools
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit

PORT = int(os.environ.get("SUWAYOMI_MOBILE_PORT", "4568"))
VAULT_PORT = int(os.environ.get("SUWAYOMI_VAULT_PORT", "4569"))
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPTS_DIR)
MOBILE_DIR = os.path.join(REPO_ROOT, "mobile")
VAULT_DATA_DIR = os.path.expanduser("~/Library/Application Support/Tachidesk-Vault")
ACTION_LOCK = threading.Lock()
VAULT_LOCK = threading.Lock()


def server_up(port=4567):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def restart_suwayomi_mac():
    cmd = (
        f'source "{SCRIPTS_DIR}/common.sh" && '
        'dir="$(find_server_dir "$INSTALL_ROOT")" && '
        'java="$(find_java "$dir")" && '
        'mkdir -p "$DATA_DIR" && '
        'cd "$dir" && '
        'nohup "$java" --add-exports=java.desktop/sun.awt=ALL-UNNAMED '
        '-Dapple.awt.UIElement=true '
        '-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false '
        '-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false '
        '-jar bin/Suwayomi-Server.jar >>"$DATA_DIR/suwayomi-stdout.log" 2>&1 &'
    )
    subprocess.run(["bash", "-c", cmd], check=False)
    for _ in range(30):
        if server_up():
            break
        time.sleep(1)


def ensure_vault_repo():
    marker = os.path.join(VAULT_DATA_DIR, ".repo-init")
    if os.path.exists(marker):
        return
    try:
        payload = json.dumps({
            "query": 'mutation { addExtensionStore(input:{indexUrl:"https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"}) { clientMutationId } }'
        }).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{VAULT_PORT}/api/graphql",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            if r.status == 200:
                with open(marker, "w", encoding="utf-8") as fh:
                    fh.write("ok")
    except Exception:
        pass


def start_vault_mac():
    with VAULT_LOCK:
        if server_up(VAULT_PORT):
            ensure_vault_repo()
            return True, ""
        os.makedirs(VAULT_DATA_DIR, exist_ok=True)
        cmd = (
            f'source "{SCRIPTS_DIR}/common.sh" && '
            'dir="$(find_server_dir "$INSTALL_ROOT")" && '
            'java="$(find_java "$dir")" && '
            'cd "$dir" && '
            f'nohup "$java" --add-exports=java.desktop/sun.awt=ALL-UNNAMED '
            f'-Dapple.awt.UIElement=true '
            f'"-Dsuwayomi.tachidesk.config.server.rootDir={VAULT_DATA_DIR}" '
            f'-Dsuwayomi.tachidesk.config.server.ip=127.0.0.1 '
            f'-Dsuwayomi.tachidesk.config.server.port={VAULT_PORT} '
            f'-Dsuwayomi.tachidesk.config.server.webUIEnabled=false '
            f'-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false '
            f'-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false '
            f'-jar bin/Suwayomi-Server.jar >>"{VAULT_DATA_DIR}/vault.log" 2>&1 &'
        )
        subprocess.run(["bash", "-c", cmd], check=False)
        for _ in range(40):
            if server_up(VAULT_PORT):
                ensure_vault_repo()
                return True, ""
            time.sleep(0.5)
        return False, "La bóveda tardó demasiado en iniciar."


def stop_vault_mac():
    with VAULT_LOCK:
        subprocess.run(["pkill", "-f", "Tachidesk-Vault"], check=False)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _clean_path(self):
        path = self.path.split("?", 1)[0]
        if path == "/movil":
            return "/"
        if path.startswith("/movil/"):
            return path[6:]
        return path

    def _proxy_vault(self, method):
        if not server_up(VAULT_PORT):
            self._send_json(503, {"errors": [{"message": "Bóveda cerrada"}]})
            return
        parsed = urlsplit(self.path)
        clean = self._clean_path()
        sub = clean[len("/__vault__"):]
        if parsed.query:
            sub += "?" + parsed.query
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length > 0 else None
        hdrs = {}
        if self.headers.get("Content-Type"):
            hdrs["Content-Type"] = self.headers["Content-Type"]
        req = urllib.request.Request(f"http://127.0.0.1:{VAULT_PORT}{sub}", data=body, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                self._send_raw(resp.status, resp.headers.get("Content-Type", "application/octet-stream"), data)
        except urllib.error.HTTPError as he:
            self._send_raw(he.code, he.headers.get("Content-Type", "application/json"), he.read())
        except Exception as exc:
            self._send_json(502, {"errors": [{"message": str(exc)}]})

    def do_GET(self):
        clean = self._clean_path()
        if clean.startswith("/__vault__/api/"):
            self._proxy_vault("GET")
            return
        self.path = clean
        return super().do_GET()

    def do_HEAD(self):
        clean = self._clean_path()
        if clean.startswith("/__vault__/api/"):
            self._proxy_vault("HEAD")
            return
        self.path = clean
        return super().do_HEAD()

    def do_POST(self):
        path = self._clean_path()
        if path.startswith("/__vault__/api/"):
            self._proxy_vault("POST")
            return
        if path == "/__vault__/start":
            if self.headers.get("X-Suwayomi-Action", "").lower() != "vault":
                self._send_json(403, {"ok": False})
                return
            ok, err = start_vault_mac()
            self._send_json(200 if ok else 500, {"ok": ok, "error": err})
            return
        if path == "/__vault__/stop":
            if self.headers.get("X-Suwayomi-Action", "").lower() != "vault":
                self._send_json(403, {"ok": False})
                return
            stop_vault_mac()
            self._send_json(200, {"ok": True})
            return

        if path != "/__action__/clear-history":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return
        if self.headers.get("X-Suwayomi-Action", "").lower() != "clear-history":
            self._send_json(403, {"ok": False, "error": "Forbidden"})
            return

        qs = parse_qs(urlsplit(self.path).query)
        manga_args = []
        if "mangaId" in qs and qs["mangaId"]:
            val = qs["mangaId"][0]
            if not val.isdigit() or int(val) <= 0:
                self._send_json(400, {"ok": False, "error": "Invalid mangaId"})
                return
            manga_args = ["--manga-id", val]

        with ACTION_LOCK:
            script = os.path.join(SCRIPTS_DIR, "clear-history.sh")
            try:
                proc = subprocess.run(
                    ["bash", script, "--force", *manga_args],
                    cwd=SCRIPTS_DIR,
                    capture_output=True,
                    text=True,
                    timeout=35,
                )
                restart_suwayomi_mac()
                if proc.returncode != 0:
                    err = (proc.stderr or proc.stdout or "Error").strip()
                    self._send_json(500, {"ok": False, "error": err})
                    return
                self._send_json(200, {"ok": True})
            except Exception as exc:
                restart_suwayomi_mac()
                self._send_json(500, {"ok": False, "error": str(exc)})

    def _send_raw(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code, payload):
        self._send_raw(code, "application/json; charset=utf-8", json.dumps(payload).encode("utf-8"))


def main():
    handler = functools.partial(Handler, directory=MOBILE_DIR)
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError:
        sys.exit(0)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
