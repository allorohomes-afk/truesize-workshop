#!/usr/bin/env python3
"""TrueSize Workshop voice service: Kokoro text-to-speech (Apache-2.0) and Whisper speech-to-text (MIT, via MLX on
Apple Silicon) behind a tiny HTTP endpoint. Run it on any Apple Silicon Mac on your network.

  POST /speak       {"text": "...", "voice": "bm_george"}  ->  audio/wav (24 kHz mono)
  POST /transcribe  audio/wav, 16 kHz mono 16-bit          ->  {"text": "..."}   (Whisper on the Mac's GPU, via MLX)
  GET  /health                                              ->  {"ok": true, "voices": [...]}

Every request needs the header  X-Voice-Token: <token>  (read from ~/.truesize-voice-token; make one with
`python3 -c "import secrets; print(secrets.token_urlsafe(24))" > ~/.truesize-voice-token` and give it to the Workshop server as WHISPER_TOKEN). Port 8881.

Install:  python3 -m venv .venv && .venv/bin/pip install kokoro soundfile numpy mlx-whisper
"""
import io
import json
import os
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from kokoro import KPipeline

TOKEN = open(os.path.expanduser("~/.truesize-voice-token")).read().strip()
PIPES = {}  # lang code -> pipeline (British voices start with "b", American with "a")
WHISPER = os.environ.get("WHISPER_MODEL", "mlx-community/whisper-small-mlx")


def transcribe(wav_bytes):
    """16 kHz mono 16-bit WAV (the browser converts before sending, so no ffmpeg is needed here) -> text."""
    import mlx_whisper  # loaded on first use; the model downloads once (~480 MB)
    with wave.open(io.BytesIO(wav_bytes)) as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError("send 16 kHz mono 16-bit WAV")
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    out = mlx_whisper.transcribe(pcm, path_or_hf_repo=WHISPER, language="en", fp16=True)
    return (out.get("text") or "").strip()


def pipe(voice):
    lang = "b" if voice.startswith("b") else "a"
    if lang not in PIPES:
        PIPES[lang] = KPipeline(lang_code=lang)
    return PIPES[lang]


def speak(text, voice):
    chunks = [audio for _, _, audio in pipe(voice)(text, voice=voice, speed=1.0)]
    pcm = np.concatenate([np.asarray(c, dtype=np.float32) for c in chunks]) if chunks else np.zeros(2400, np.float32)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _auth(self):
        if self.headers.get("X-Voice-Token") != TOKEN:
            self.send_response(403)
            self.end_headers()
            return False
        return True

    def do_GET(self):
        if self.path != "/health" or not self._auth():
            return self.send_error(404) if self.path != "/health" else None
        body = json.dumps({"ok": True, "voices": ["bm_george", "bm_fable", "am_michael", "af_heart"]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path not in ("/speak", "/transcribe"):
            return self.send_error(404)
        if not self._auth():
            return
        if self.path == "/transcribe":
            raw = self.rfile.read(min(int(self.headers.get("Content-Length", 0) or 0), 20_000_000))
            try:
                body = json.dumps({"text": transcribe(raw)}).encode()
                self.send_response(200)
            except Exception as e:
                body = json.dumps({"error": str(e)[:200]}).encode()
                self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)) or 0) or b"{}")
        text = str(req.get("text", "")).strip()[:5000]
        if not text:
            return self.send_error(400, "empty text")
        wav = speak(text, str(req.get("voice") or "bm_george"))
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    pipe("bm_george")  # load the model once at start, not on the first request
    ThreadingHTTPServer(("0.0.0.0", 8881), Handler).serve_forever()
