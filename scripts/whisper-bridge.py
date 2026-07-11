"""Optional local Whisper bridge for Octopus.

Install:
    pip install faster-whisper flask

Run:
    python scripts/whisper-bridge.py

Exposes:
    GET  /health
    POST /transcribe  (multipart: file, optional language)

The Octopus /api/transcribe route tries this first (port 7677) and only
falls back to OpenAI Whisper if this bridge is down.
"""
from __future__ import annotations

import io
import os
import tempfile

from flask import Flask, jsonify, request
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("OCTOPUS_WHISPER_MODEL", "base")
COMPUTE_TYPE = os.environ.get("OCTOPUS_WHISPER_COMPUTE", "int8")

print(f"loading faster-whisper model={MODEL_NAME} compute={COMPUTE_TYPE}...")
model = WhisperModel(MODEL_NAME, compute_type=COMPUTE_TYPE)
print("model ready.")

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(ok=True, model=MODEL_NAME)


@app.post("/transcribe")
def transcribe():
    f = request.files.get("file")
    if not f:
        return jsonify(error="file missing"), 400
    lang = request.form.get("language") or None

    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        f.save(tmp.name)
        path = tmp.name
    try:
        segments, _info = model.transcribe(path, language=lang, vad_filter=True)
        text = "".join(seg.text for seg in segments).strip()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    return jsonify(text=text)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=7677)
