"""Static file server for development.

Optional -- Colorcraft has no build step and index.html opens fine straight from
disk. This exists only because `python -m http.server` lets the browser cache
aggressively, which serves stale JS while you are editing it. Here every response
carries no-store, and conditional request headers are dropped so nothing 304s.

    python serve.py [port]
"""

import http.server
import sys

DEFAULT_PORT = 5580


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
