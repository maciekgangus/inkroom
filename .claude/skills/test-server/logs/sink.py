"""A fake Telegram Bot API for the local log stack: every POST is appended to /sink/received.jsonl.

GET / shows the last messages as text, so a browser tab is enough to see that an alert arrived.
"""
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

FILE = "/sink/received.jsonl"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8", "replace")
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = body
        with open(FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({"time": time.strftime("%Y-%m-%dT%H:%M:%S"), "path": self.path, "body": parsed}, ensure_ascii=False) + "\n")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true,"result":{}}')

    def do_GET(self):
        try:
            with open(FILE, encoding="utf-8") as f:
                text = "".join(f.readlines()[-20:])
        except OSError:
            text = "(nothing received yet)\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(text.encode("utf-8"))

    def log_message(self, *_):
        pass


HTTPServer(("0.0.0.0", 9199), Handler).serve_forever()
