#!/usr/bin/env python3
"""Servidor HTTP local ligero (127.0.0.1:4568) para mobile/ en macOS.
Sirve archivos estáticos de mobile/ y la acción POST /__action__/clear-history.
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
from urllib.parse import parse_qs, urlsplit

PORT = int(os.environ.get("SUWAYOMI_MOBILE_PORT", "4568"))
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
MOBILE_DIR = os.path.join(REPO_ROOT, "mobile")
ACTION_LOCK = threading.Lock()


def server_up(port=4567):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def restart_suwayomi_mac():
    cmd = (
        f'source "{REPO_ROOT}/common.sh" && '
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

    def do_GET(self):
        self.path = self._clean_path()
        return super().do_GET()

    def do_HEAD(self):
        self.path = self._clean_path()
        return super().do_HEAD()

    def do_POST(self):
        path = self._clean_path()
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
            script = os.path.join(REPO_ROOT, "clear-history.sh")
            try:
                proc = subprocess.run(
                    ["bash", script, "--force", *manga_args],
                    cwd=REPO_ROOT,
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

    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    handler = functools.partial(Handler, directory=MOBILE_DIR)
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError:
        sys.exit(0)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
