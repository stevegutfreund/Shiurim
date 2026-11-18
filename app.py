#!/usr/bin/env python3
"""
Shiurim – calculator and reference tables for halachic measurements
(volume, length, coins), built from the "מחשבון שיעורים" Google Sheet.

Run:
    python app.py

Access at:  http://127.0.0.1:5005

data/units.json holds the unit table copied from the sheet (read-only).
data/modern.json holds your edits to the modern values per shita
(ביצה in ml, טפח in cm, דינר in grams); delete it to go back to the sheet's values.
"""

import json
import os
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

PORT = 5005
DATA_DIR = Path(__file__).with_name("data")
UNITS_FILE = DATA_DIR / "units.json"
MODERN_FILE = DATA_DIR / "modern.json"

# Requests must address the app by one of these names (blocks DNS rebinding).
# EXTRA_HOSTS (comma-separated, set by start-all.ps1) adds the Wi-Fi IP and
# Tailscale names so the phone can reach it too.
HOSTNAMES = ["127.0.0.1", "localhost"] + [
    h.strip() for h in os.environ.get("EXTRA_HOSTS", "").split(",") if h.strip()
]
ALLOWED_HOSTS = {f"{h}:{PORT}" for h in HOSTNAMES}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}


def load_units() -> dict:
    return json.loads(UNITS_FILE.read_text(encoding="utf-8"))


def load_modern() -> dict:
    try:
        return json.loads(MODERN_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def merged_units() -> dict:
    """Unit table with each category's current modern values filled in."""
    data = load_units()
    overrides = load_modern()
    for cat in data["categories"]:
        values = dict(cat["defaults"])
        values.update(overrides.get(cat["key"], {}))
        cat["values"] = values
    return data


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")

    # Behind the login gateway (dashboard/gateway/gateway.py) the app lives under a path
    # prefix such as /bdays; X-Forwarded-Prefix makes url_for() include it.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=0, x_proto=0, x_host=0, x_port=0, x_prefix=1)

    @app.before_request
    def guard_request():
        if request.host not in ALLOWED_HOSTS:
            abort(400)
        # Refuse writes coming from other websites (CSRF).
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            fetch_site = request.headers.get("Sec-Fetch-Site")
            if fetch_site is not None:
                if fetch_site not in ("same-origin", "none"):
                    abort(403)
            else:
                origin = request.headers.get("Origin")
                if origin is not None and origin not in ALLOWED_ORIGINS:
                    abort(403)

    @app.after_request
    def security_headers(resp):
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self'; img-src 'self' data:; "
            "frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
        )
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/favicon.ico")
    def favicon():
        return "", 204

    @app.get("/api/units")
    def api_units():
        return jsonify(merged_units())

    @app.put("/api/modern")
    def api_save_modern():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            abort(400)
        data = load_units()
        shitot = [s["key"] for s in data["shitot"]]
        clean = {}
        for cat in data["categories"]:
            given = body.get(cat["key"])
            if given is None:
                continue
            if not isinstance(given, dict):
                abort(400)
            clean[cat["key"]] = {}
            for s in shitot:
                v = given.get(s)
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not (0 < v < 1e6):
                    return jsonify(error=f"ערך לא תקין: {cat['label']} / {s}"), 400
                clean[cat["key"]][s] = v
        MODERN_FILE.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
        return jsonify(merged_units())

    @app.delete("/api/modern")
    def api_reset_modern():
        MODERN_FILE.unlink(missing_ok=True)
        return jsonify(merged_units())

    return app


if __name__ == "__main__":
    # debug stays off: the Werkzeug debugger is a remote-code console.
    create_app().run(host="127.0.0.1", port=PORT, debug=False)
