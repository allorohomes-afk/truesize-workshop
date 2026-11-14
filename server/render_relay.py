#!/usr/bin/env python3
"""Render relay for the TrueSize Workshop: takes a snapshot of the 3D view and repaints it as a photograph with ComfyUI
(SDXL Turbo image-to-image, so the layout stays where it was). Runs on the computer with the GPU, next to ComfyUI.
RENDER_ALLOWED_ORIGINS: extra page addresses allowed to call it, comma-separated (e.g. your Workshop's private address).
RENDER_TRUST_HEADER: a header your private proxy adds to every request it forwards (then those requests are allowed).

  POST /render  {"image": "data:image/png;base64,...", "prompt": "..."}  ->  {"image": "data:image/png;base64,..."}

Only a fixed workflow can run (no arbitrary ComfyUI access). Requests must come from this Mac (127.0.0.1) or through
your private proxy (which adds RENDER_TRUST_HEADER); everything else is refused. Port 8882, localhost only.
"""
import base64
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COMFY = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
CKPT = os.environ.get("RENDER_CHECKPOINT", "sd_xl_turbo_1.0_fp16.safetensors")
TRUST_HEADER = os.environ.get("RENDER_TRUST_HEADER", "").strip()
DEPTH_CN = os.environ.get("RENDER_DEPTH_CONTROLNET", "controlnet-depth-sdxl-1.0-small.fp16.safetensors")
ALLOWED_ORIGINS = {*filter(None, os.environ.get("RENDER_ALLOWED_ORIGINS", "").split(",")), "http://127.0.0.1:5191", "http://127.0.0.1:5190",
                   "http://localhost:5191", "http://localhost:5190"}
STYLE = ("professional architectural and event photograph, photorealistic, natural soft lighting, realistic materials "
         "and fabrics, sharp focus, high detail")
NEGATIVE = "cartoon, 3d render, cgi, lowpoly, text, watermark, blurry, distorted, extra furniture, flowers instead of balloons"


def comfy(path, data=None, headers=None):
    req = urllib.request.Request(f"{COMFY}{path}", data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def upload(png):
    boundary = uuid.uuid4().hex
    name = f"workshop-{uuid.uuid4().hex[:8]}.png"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + png + \
           f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--{boundary}--\r\n".encode()
    out = json.loads(comfy("/upload/image", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    return out["name"]


def render(png, prompt, strength=0.42, seed=42, depth_png=None):
    name = upload(png)
    wf = {
        "1": {"class_type": "LoadImage", "inputs": {"image": name}},
        # keep the view's own framing: scale to 1024 wide, height in proportion (no crop)
        "2": {"class_type": "ImageScale", "inputs": {"image": ["1", 0], "upscale_method": "lanczos", "width": 1024,
                                                     "height": 0, "crop": "disabled"}},
        "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "4": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["3", 2]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": f"{STYLE}. {prompt}", "clip": ["3", 1]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["3", 1]}},
        "7": {"class_type": "KSampler", "inputs": {"seed": seed, "steps": 6, "cfg": 1.0, "sampler_name": "euler_ancestral",
                                                   "scheduler": "simple", "denoise": strength, "model": ["3", 0],
                                                   "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["4", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "truesize-workshop-render", "images": ["8", 0]}},
    }
    if depth_png:
        # Depth from the real 3D geometry holds every piece in place and in shape, so the model can repaint the
        # surfaces more freely (higher denoise) without moving or inventing things.
        wf["10"] = {"class_type": "LoadImage", "inputs": {"image": upload(depth_png)}}
        wf["11"] = {"class_type": "ImageScale", "inputs": {"image": ["10", 0], "upscale_method": "lanczos", "width": 1024,
                                                          "height": 0, "crop": "disabled"}}
        wf["12"] = {"class_type": "ControlNetLoader", "inputs": {"control_net_name": DEPTH_CN}}
        wf["13"] = {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["5", 0], "negative": ["6", 0],
                    "control_net": ["12", 0], "image": ["11", 0], "strength": 0.8, "start_percent": 0.0, "end_percent": 0.85}}
        wf["7"]["inputs"].update({"positive": ["13", 0], "negative": ["13", 1], "denoise": max(strength, 0.55)})
    pid = json.loads(comfy("/prompt", json.dumps({"prompt": wf}).encode(), {"Content-Type": "application/json"}))["prompt_id"]
    for _ in range(900):   # up to 15 min: the GPU may be busy with other models
        time.sleep(1)
        h = json.loads(comfy(f"/history/{pid}"))
        img = h.get(pid, {}).get("outputs", {}).get("9", {}).get("images", [{}])[0]
        if img.get("filename"):
            q = urllib.parse.urlencode({"filename": img["filename"], "type": img.get("type", "output"),
                                        "subfolder": img.get("subfolder", "")})
            return comfy(f"/view?{q}")
    raise TimeoutError("ComfyUI took too long")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def _allowed(self):
        # requests through your private proxy carry its header; direct ones can only come from this computer
        return bool(TRUST_HEADER and self.headers.get(TRUST_HEADER)) or self.client_address[0] == "127.0.0.1"

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") not in ("/render", ""):
            return self.send_error(404)
        if not self._allowed():
            return self.send_error(403)
        try:
            req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0) or 0), 25_000_000)))
            png = base64.b64decode(str(req["image"]).split(",", 1)[-1])
            depth = base64.b64decode(str(req["depth"]).split(",", 1)[-1]) if req.get("depth") else None
            out = render(png, str(req.get("prompt", ""))[:800], float(req.get("strength", 0.42)), depth_png=depth)
            body = json.dumps({"image": "data:image/png;base64," + base64.b64encode(out).decode()}).encode()
            self.send_response(200)
        except Exception as e:
            body = json.dumps({"error": f"{type(e).__name__}: {str(e)[:160]}"}).encode()
            self.send_response(502)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print("TrueSize Workshop render relay on 127.0.0.1:8882 ->", COMFY)
    ThreadingHTTPServer(("127.0.0.1", 8882), Handler).serve_forever()
