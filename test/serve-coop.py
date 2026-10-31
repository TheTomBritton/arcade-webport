"""COOP/COEP static server rooted at the repo (local stand-in for a host's
per-directory headers), so pthreads/SharedArrayBuffer engines are
cross-origin isolated. Answers Range requests: The House of the Dead's
engine reads its game folder a piece at a time through them."""
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
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    # Range requests (the live host answers them; the House of the Dead
    # engine reads its game folder a piece at a time through them).
    def send_head(self):
        rng = self.headers.get("Range")
        if not rng or not rng.startswith("bytes="):
            return super().send_head()
        import os, posixpath, urllib.parse
        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        spec = rng[6:].split(",")[0].strip()
        lo, _, hi = spec.partition("-")
        try:
            if lo == "":
                n = int(hi); start, end = max(0, size - n), size - 1
            else:
                start = int(lo); end = int(hi) if hi else size - 1
        except ValueError:
            return super().send_head()
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        end = min(end, size - 1)
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "_range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        self._range_left = None
        while left > 0:
            chunk = source.read(min(65536, left))
            if not chunk: break
            outputfile.write(chunk)
            left -= len(chunk)


class Server(http.server.ThreadingHTTPServer):
    # The default listen backlog is 5: a page's first burst of requests can
    # overflow it, and the connection reset that follows loses a script
    # (crt.js, say) and with it the whole page, roughly one load in four.
    request_queue_size = 128


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
    print(f"serving {ROOT} on http://127.0.0.1:{port}")
    Server(("127.0.0.1", port), Handler).serve_forever()
