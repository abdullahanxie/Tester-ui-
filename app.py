"""Standalone test UI for the generate_reference_variants microservice.

Hits http://127.0.0.1:8407/run directly. Forwards up to 6 uploaded images and
shows the wireframe variant output as soon as the service responds.
"""
import os
import base64
import uuid
import logging
from datetime import datetime
import httpx
from flask import Flask, render_template, request, jsonify, send_from_directory

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("variants-tester")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUT_DIR, exist_ok=True)

SERVICE_URL = os.environ.get("VARIANTS_SERVICE_URL", "http://127.0.0.1:8407/run")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32 MB total


def _file_to_dataurl(file_storage):
    raw = file_storage.read()
    mime = file_storage.mimetype or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def _save_b64(b64: str, prefix: str) -> str:
    raw = base64.b64decode(b64)
    fname = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{prefix}_{uuid.uuid4().hex[:6]}.png"
    path = os.path.join(OUT_DIR, fname)
    with open(path, "wb") as f:
        f.write(raw)
    return f"/outputs/{fname}"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/health")
def health():
    health_url = SERVICE_URL.rsplit("/", 1)[0] + "/health"
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(health_url)
            return jsonify(r.json()), r.status_code
    except httpx.HTTPError as e:
        return jsonify({"status": "error", "error": str(e)}), 502


@app.route("/api/run", methods=["POST"])
def run():
    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "Upload at least one image"}), 400

    refs = [_file_to_dataurl(f) for f in files if f.filename]
    if not refs:
        return jsonify({"error": "Empty upload"}), 400
    if len(refs) > 6:
        return jsonify({"error": "Upload at most 6 images"}), 400

    log.info("Forwarding %d image(s) to %s", len(refs), SERVICE_URL)

    envelope = {
        "data": {
            "reference_images": refs,
            "include_data_uri": True,
            "upload_artifacts": False,
            "prompts": [
                "keeping everything 100% same make clear 3d wireframe of this ring geometry in white background with arrows labeling each part (band, prongs, stone, setting)"
            ],
        },
        "meta": {"trace_id": f"ui-{uuid.uuid4().hex[:8]}"},
    }

    try:
        with httpx.Client(timeout=600.0) as client:
            r = client.post(SERVICE_URL, json=envelope)
    except httpx.HTTPError as e:
        log.exception("Service unreachable")
        return jsonify({"error": f"Service unreachable: {e}"}), 502

    if r.status_code >= 400:
        log.error("Service returned %s: %s", r.status_code, r.text[:600])
        try:
            return jsonify({"error": "service_error", "status": r.status_code, "body": r.json()}), 502
        except Exception:
            return jsonify({"error": "service_error", "status": r.status_code, "body": r.text}), 502

    data = r.json()
    out = []
    for v in data.get("variants", []) or []:
        item = {
            "index": v.get("index"),
            "prompt": v.get("prompt"),
            "success": v.get("success"),
            "elapsed_ms": v.get("elapsed_ms"),
            "error": v.get("error"),
        }
        if v.get("b64"):
            item["url"] = _save_b64(v["b64"], f"v{v.get('index',0):02d}")
        out.append(item)

    return jsonify({
        "input_count": len(refs),
        "variant_count": data.get("variant_count"),
        "success_count": data.get("success_count"),
        "elapsed_ms": data.get("elapsed_ms"),
        "variants": out,
    })


@app.route("/outputs/<path:fname>")
def outputs(fname):
    return send_from_directory(OUT_DIR, fname)


if __name__ == "__main__":
    log.info("Test UI -> %s", SERVICE_URL)
    app.run(host="0.0.0.0", port=8505, debug=True, use_reloader=False)
