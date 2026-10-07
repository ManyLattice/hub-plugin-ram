"""Память по агентам: процесс снимает ps раз в N секунд, страница читает снимок по HTTP (порт страницы + 10)."""
import http.server
import json
import os
import threading
import time

import ram

WEB_PORT = int(os.environ.get("HUB_WEB_PORT", "8787"))
PORT = WEB_PORT + 10
EVERY = float(os.environ.get("HUB_RAM_EVERY", "5"))
state = {"ts": 0, "groups": {}, "every": EVERY}


def loop():
    while True:
        try:
            state.update(ts=time.time(), groups=ram.sample())
        except Exception as e:
            state["error"] = str(e)
        time.sleep(EVERY)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        origin = self.headers.get("Origin") or ""
        if origin not in (f"http://127.0.0.1:{WEB_PORT}", f"http://localhost:{WEB_PORT}"):
            self.send_response(403)
            self.end_headers()
            return
        data = json.dumps(state, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=loop, daemon=True).start()
    print(f"память: страница — 127.0.0.1:{PORT}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
