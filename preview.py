"""Serve the booking prototype and its public Mappedin map index locally."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


MAP_INDEX = (
    "https://mappedin-public-mvf-prod.azurewebsites.net/mvf"
    "?venue=686e226a0c030e000b832a48&version=2.0.0"
)


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] != "/map-index":
            super().do_GET()
            return

        try:
            with urlopen(MAP_INDEX, timeout=8) as response:
                index = response.read()
        except (URLError, TimeoutError):
            self.send_error(502, "Mappedin is unavailable")
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(index)))
        self.send_header("Cache-Control", "private, max-age=60")
        self.end_headers()
        self.wfile.write(index)


if __name__ == "__main__":
    handler = partial(PreviewHandler, directory=Path(__file__).resolve().parent)
    with ThreadingHTTPServer(("127.0.0.1", 8000), handler) as server:
        print("Preview available at http://127.0.0.1:8000/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
