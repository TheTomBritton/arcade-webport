"""COOP/COEP static server rooted at the repo (local stand-in for a host's
per-directory headers), so pthreads/SharedArrayBuffer engines are
cross-origin isolated."""
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # The default listen backlog is 5: a page's first burst of requests can
    # overflow it, and the connection reset that follows loses a script
    # (crt.js, say) and with it the whole page, roughly one load in four.
    request_queue_size = 128


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
    print(f"serving {ROOT} on http://127.0.0.1:{port}")
    Server(("127.0.0.1", port), Handler).serve_forever()
