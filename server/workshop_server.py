#!/usr/bin/env python3
"""TrueSize Workshop server: serves the built app (dist/), saves projects, and turns words into scene operations with a
local model. Python standard library only, so it runs on old hardware as-is (no installs).

  GET  /api/projects?space=shared           list projects in a workspace
  GET  /api/projects/<name>?space=shared    load one
  PUT  /api/projects/<name>?space=shared    save one (JSON body)
  POST /api/command   {text, scene, units}  -> {reply, ops}   (words -> operations; the AI never computes sizes)
  POST /api/transcribe  audio/wav (16 kHz mono) -> {text}      (hold-to-talk; relayed to the voice service, stays in the house)
  POST /api/speak     {text, voice}           -> audio/wav     (the assistant's voice; relayed to the voice service)
  POST /api/scans?space=shared  room scan from the TrueSize Scan iPad/iPhone app (Apple RoomPlan, metres)
  GET  /api/scans?space=shared  list scans;   GET /api/scans/<name>?space=shared  load one
  GET  /api/config                          workspaces and the render address, for the page

Environment:
  WORKSHOP_DIR   where workspaces live            (default ./projects)
  WORKSHOP_SPACES  workspaces as id:Label pairs     (default me:Me,shared:Shared; e.g. sam:Sam,alex:Alex,shared:Shared)
  WHISPER_URL / WHISPER_TOKEN  voice service (services/voice_server.py) for hold-to-talk and the assistant's voice
  ASSISTANT_NAME the assistant's name in the page and its instructions  (default Ada)
  RENDER_URL     where the page sends "Render it" (default: the render relay on the same computer)
  OLLAMA_URL     Ollama chat endpoint base        (default http://127.0.0.1:11434)
  WORKSHOP_MODEL model for words -> operations    (default qwen2.5:14b; on the hive: qwen3:8b / the garage server)
  PORT           (default 5191)
"""
import json
import os
import re
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
DATA = Path(os.environ.get("WORKSHOP_DIR", ROOT / "projects"))
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("WORKSHOP_MODEL", "qwen3:4b-instruct")   # best in bench/BENCHMARKS.md: right every time, ~2.5 s
PORT = int(os.environ.get("PORT", "5191"))
WHISPER_URL = os.environ.get("WHISPER_URL", "http://127.0.0.1:8881").rstrip("/")
RENDER_URL = os.environ.get("RENDER_URL", "")
WHISPER_TOKEN = os.environ.get("WHISPER_TOKEN", "")
# Kokoro voices (Apache-2.0) speaking English with their own accent; the page offers only these.
VOICES = {"bf_emma", "bf_isabella", "bm_george", "ff_siwis", "if_sara", "im_nicola", "ef_dora", "em_alex",
          "hf_alpha", "hm_omega", "pf_dora", "jf_alpha", "af_heart"}
NAME_RE = re.compile(r"^[A-Za-z0-9 _.-]{1,80}$")
SPACE_LIST = [tuple((pair.split(":", 1) + [pair])[:2]) for pair in os.environ.get("WORKSHOP_SPACES", "me:Me,shared:Shared").split(",") if pair.strip()]
SPACES = {sid.strip() for sid, _ in SPACE_LIST}

ASSISTANT = os.environ.get("ASSISTANT_NAME", "Ada").strip() or "Ada"
SYSTEM = f"""You are {ASSISTANT}, building in a 3D workshop. Turn the user's request into scene operations.
Reply with ONLY JSON: {{"reply": "one short friendly sentence", "ops": [ ... ]}}

Operations:
 {{"op":"add","id":"short-unique-id","kind":KIND,"label":"what it is","params":{{...}},"position":[x,y,z],"rotationY":degrees}}
 {{"op":"update","id":"existing-id","params":{{...}},"position":[x,y,z],"rotationY":degrees,"label":"..."}}   (only changed fields)
 {{"op":"remove","id":"existing-id"}}
 {{"op":"explode"}}   {{"op":"assemble"}}   {{"op":"clear"}}

KINDs and params (sizes are strings WITH units exactly as the user said them, e.g. "9ft", "108in", "2.5m"):
 room          width, depth, height, wallColor, floorColor          (a room shell; floor at y=0, centred at 0,0,0)
 balloonArch   width, height, balloon ("5in","11in","16in"), colors [names], style ("classic" or "organic")
 roundTable    diameter (default "60in"), height, color, linen (colour or false)
 banquetTable  length (default "6ft"), width, height, color, linen
 chair         color, seatHeight
 backdrop      width, height, shape ("rectangle","arch","circle"), color
 box           width, height, depth, color
 cylinder      radius or diameter, height, topRadius, color
 sphere        radius or diameter, color
 cone          radius, height, color
 torus         radius, thickness, color

Rules:
- NEVER invent measurements the user didn't give; leave them out and the defaults apply.
- Positions are [x, y, z] strings with units ("3ft") or plain metres. y is height off the floor (usually 0).
  x is left/right, z is front/back. The room's back wall is at z = -depth/2. Put things where the user says.
- To build an object out of shapes (e.g. a lamp, a robot), add several shapes with ids like "lamp-base", "lamp-shade"
  and stack them with position y.
- Use existing ids from the scene for update/remove. Colours can be names ("blush","gold","sage") or hex.
- An arch or backdrop described by ONE size ("a 9 foot arch") means its HEIGHT; leave width out.
- Positions: give x and z WITH units like "-18ft" or "3m". Leave y out unless something hangs or sits on a stage.
- If the request is unclear, return no ops and ask one short question in "reply".
- Make ONE op for EVERY item the user mentions, in the order they mention them ("two tables" = two add ops).

Example request: "a 20 by 30 foot room, a 7 foot white and silver arch by the back wall, and two 6 foot banquet tables"
Example answer:
{{"reply": "Here's your room with the arch and two banquet tables.", "ops": [
 {{"op":"add","id":"room","kind":"room","label":"Room","params":{{"width":"20ft","depth":"30ft"}}}},
 {{"op":"add","id":"arch","kind":"balloonArch","label":"White and silver arch","params":{{"height":"7ft","colors":["white","silver"]}},"position":["0ft",0,"-14ft"]}},
 {{"op":"add","id":"banquet-1","kind":"banquetTable","label":"Banquet table","params":{{"length":"6ft"}},"position":["-4ft",0,"-6ft"]}},
 {{"op":"add","id":"banquet-2","kind":"banquetTable","label":"Banquet table","params":{{"length":"6ft"}},"position":["4ft",0,"-6ft"]}}]}}"""


def chat_ops(text, scene, units):
    scene_txt = json.dumps(scene)[:6000]
    body = {"model": MODEL, "stream": False, "format": "json", "options": {"temperature": 0.1, "num_ctx": 8192},
            "messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": f"Units the user prefers: {units}\nCurrent scene: {scene_txt}\n\nRequest: {text}"}]}
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        content = json.loads(r.read())["message"]["content"]
    try:
        out = json.loads(content)
    except json.JSONDecodeError:
        out = {"reply": "I didn't get that one right. Could you say it another way?", "ops": []}
    ops = out.get("ops") if isinstance(out.get("ops"), list) else []
    budget = {}
    for pair in _pairs(text):  # each size the user says can be used once (stops "30 by 40 room" leaking into the arch)
        budget[pair] = budget.get(pair, 0) + 1
    ops = [guard_invented_sizes(op, text, budget) for op in ops if isinstance(op, dict)]
    ops = fix_room_by(ops, text)
    ops = fix_backdrop_shape(ops, text)
    ops = fill_counts(ops, text)
    return {"reply": str(out.get("reply") or "Done."), "ops": ops, "model": MODEL}


SIZE_KEYS = {"width", "height", "depth", "length", "diameter", "radius", "balloon", "seatHeight", "thickness", "topRadius"}


UNIT_WORDS = {"ft": ("feet", "foot", "ft", "'"), "in": ("inches", "inch", "in", '"'), "cm": ("cm",), "mm": ("mm",),
              "m": ("meters", "metres", "meter", "metre", "m")}
PAIR_RE = re.compile(r"(\d+(?:\.\d+)?)\s*-?\s*([a-z]+|['\"])?")


def _pairs(text):
    """('9', 'ft') style pairs for every number in the text; unit None when no unit follows it."""
    out = []
    for num, word in PAIR_RE.findall(text.lower()):
        unit = next((u for u, words in UNIT_WORDS.items() if word in words), None) if word else None
        out.append((num, unit))
    return out


def guard_invented_sizes(op, request, budget=None):
    """Software owns the numbers: drop any size the user never said (same number AND same unit), and any size already
    used up by an earlier piece in the same request, so the defaults apply instead."""
    said = _pairs(request)
    said_nums = {n for n, _ in said}
    budget = budget if budget is not None else {p: 99 for p in said}
    params = op.get("params")
    if isinstance(params, dict):
        for k in [k for k in params if k in SIZE_KEYS]:
            for n, u in _pairs(str(params[k])):
                # "30 by 40 foot": a number said without a unit may take the model's unit; a number said WITH a
                # different unit may not ("9 foot" is not "9 inch").
                key = (n, u) if (n, u) in budget else (n, None)
                owner = budget.get(("owner",) + key)            # the kind of piece that used this size first
                same_kind = owner == op.get("kind")              # "two 60 inch tables": both tables may use it
                if (u is None and n not in said_nums) or (u is not None and (n, u) not in said and (n, None) not in said) \
                        or (budget.get(key, 0) <= 0 and not same_kind):
                    params.pop(k)
                    break
                if not same_kind:
                    budget[key] -= 1
                    budget[("owner",) + key] = op.get("kind")
    return op


NUM_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
             "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "a pair of": 2, "a couple of": 2}
KIND_WORDS = [("roundTable", r"round tables?"), ("banquetTable", r"(?:banquet|rectangular|long) tables?"),
              ("chair", r"chairs?"), ("balloonArch", r"(?:balloon )?arch(?:es)?(?! ?shaped| ?backdrop)"),
              ("backdrop", r"backdrops?")]


def fill_counts(ops, text):
    """'two 60 inch round tables', 'four chairs': if the model made fewer, copy the last one and space the copies."""
    t = text.lower()
    for kind, pat in KIND_WORDS:
        noun = re.search(r"\b" + pat, t)
        if not noun:
            continue
        # the count is the number word CLOSEST before the item ("two 6 foot tables and 8 white chairs": chairs = 8),
        # and it must not belong to a size ("6 foot", "60 inch")
        before = t[max(0, noun.start() - 40):noun.start()]
        nums = [m for m in re.finditer(r"\b(a pair of|a couple of|\d+|" + "|".join(k for k in NUM_WORDS if " " not in k) + r")\b(?!\s*(?:-?\s*)(?:ft|feet|foot|in|inch|inches|m|cm|metres?|meters?|'|\"))", before)]
        if not nums or re.search(r"[.,;]|\band\b", before[nums[-1].end():]):
            continue
        word = nums[-1].group(1)
        want = int(word) if word.isdigit() else NUM_WORDS.get(word, 1)
        have = [o for o in ops if o.get("op") == "add" and o.get("kind") == kind]
        if not have or len(have) >= want or want > 60:
            continue
        last = have[-1]
        step = {"roundTable": 8, "banquetTable": 8, "chair": 2.5}.get(kind, 6)   # feet between pieces
        for i in range(len(have), want):
            copy = json.loads(json.dumps(last))
            copy["id"] = f"{last.get('id', kind)}-{i + 1}"
            ops.append(copy)
            have.append(copy)
        for i, o in enumerate(have):   # space the whole row evenly so nothing overlaps
            pos = list(o.get("position") or ["0ft", 0, "0ft"]) + [0, 0, 0]
            o["position"] = [f"{(i - (want - 1) / 2) * step:.1f}ft", pos[1], pos[2]]
    return ops


def fix_backdrop_shape(ops, text):
    """'arch shaped backdrop' / 'round backdrop': the shape comes from the words, not the model's guess."""
    t = text.lower()
    shape = "arch" if re.search(r"arch(?:ed|[- ]shaped|[- ]top)[^.,;]{0,20}backdrop|backdrop[^.,;]{0,20}arch(?:ed|[- ]shaped)", t) else \
            "circle" if re.search(r"(?:round|circle|circular)[^.,;]{0,15}backdrop", t) else None
    if shape:
        for o in ops:
            if o.get("op") == "add" and o.get("kind") == "backdrop":
                o.setdefault("params", {})["shape"] = shape
    return ops


def fix_room_by(ops, text):
    """'30 by 40 foot room' means width 30, depth 40: set it from the words, not the model's guess."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|m|meters?)?\s*(?:by|x|×)\s*(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|m|meters?|metres?)", text.lower())
    if not m:
        return ops
    unit = "m" if m.group(3).startswith("m") else "ft"
    for o in ops:
        if o.get("op") == "add" and o.get("kind") == "room":
            o.setdefault("params", {})
            o["params"]["width"], o["params"]["depth"] = f"{m.group(1)}{unit}", f"{m.group(2)}{unit}"
    return ops


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DIST), **kw)

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _space(self):
        q = dict(p.split("=", 1) for p in (self.path.split("?", 1)[1].split("&") if "?" in self.path else []) if "=" in p)
        space = q.get("space", SPACE_LIST[0][0])
        if space not in SPACES:
            return None
        d = DATA / space
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _name(self):
        name = urllib.request.unquote(self.path.split("?")[0].rsplit("/", 1)[-1])
        return name if NAME_RE.match(name) and not name.startswith(".") else None

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/projects":
            d = self._space()
            if not d:
                return self._json(400, {"error": "unknown workspace"})
            return self._json(200, {"projects": sorted(f.stem for f in d.glob("*.json"))})
        if p.startswith("/api/projects/"):
            d, name = self._space(), self._name()
            if not d or not name or not (d / f"{name}.json").exists():
                return self._json(404, {"error": "not found"})
            return self._json(200, json.loads((d / f"{name}.json").read_text()))
        if p == "/api/scans":
            d = self._space()
            if not d:
                return self._json(400, {"error": "unknown workspace"})
            files = sorted((d / "scans").glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True)
            return self._json(200, {"scans": [f.stem for f in files]})
        if p.startswith("/api/scans/"):
            d, name = self._space(), self._name()
            if not d or not name or not (d / "scans" / f"{name}.json").exists():
                return self._json(404, {"error": "not found"})
            return self._json(200, json.loads((d / "scans" / f"{name}.json").read_text()))
        if p == "/api/config":
            return self._json(200, {"spaces": [{"id": i.strip(), "label": l.strip()} for i, l in SPACE_LIST], "renderUrl": RENDER_URL, "assistant": ASSISTANT})
        if p == "/api/health":
            return self._json(200, {"ok": True, "model": MODEL})
        return super().do_GET()

    def do_PUT(self):
        p = self.path.split("?")[0]
        if not p.startswith("/api/projects/"):
            return self._json(404, {"error": "no such route"})
        d, name = self._space(), self._name()
        if not d or not name:
            return self._json(400, {"error": "bad workspace or name"})
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        data = json.loads(body or b"{}")
        (d / f"{name}.json").write_text(json.dumps(data, indent=2))
        return self._json(200, {"saved": name})

    def do_POST(self):
        if self.path.split("?")[0] == "/api/scans":
            d = self._space()
            if not d:
                return self._json(400, {"error": "unknown workspace"})
            try:
                scan = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0) or 0), 5_000_000)))
                items = [i for i in scan.get("items", []) if isinstance(i, dict)][:2000]
                if not items:
                    raise ValueError("no walls or objects in the scan")
            except Exception as e:
                return self._json(400, {"error": f"bad scan ({e})"})
            name = re.sub(r"[^A-Za-z0-9 _-]", "", str(scan.get("name") or "Room scan")).strip()[:60] or "Room scan"
            (d / "scans").mkdir(exist_ok=True)
            base, n = name, 2
            while (d / "scans" / f"{name}.json").exists():
                name, n = f"{base} {n}", n + 1
            keep = {k: scan[k] for k in ("device", "created") if k in scan}
            (d / "scans" / f"{name}.json").write_text(json.dumps({"name": name, "units": "m", **keep, "items": items}, indent=1))
            return self._json(200, {"saved": name, "items": len(items)})
        if self.path.split("?")[0] == "/api/transcribe":
            audio = self.rfile.read(min(int(self.headers.get("Content-Length", 0) or 0), 20_000_000))
            req = urllib.request.Request(f"{WHISPER_URL}/transcribe", data=audio,
                                         headers={"Content-Type": "audio/wav", "X-Voice-Token": WHISPER_TOKEN})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    return self._json(200, json.loads(r.read()))
            except Exception as e:
                return self._json(502, {"error": f"speech service unavailable ({type(e).__name__})"})
        if self.path.split("?")[0] == "/api/speak":
            req = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length", 0) or 0), 100_000)) or b"{}")
            voice = str(req.get("voice", ""))
            if voice not in VOICES:
                return self._json(400, {"error": "unknown voice"})
            data = json.dumps({"text": str(req.get("text", ""))[:1200], "voice": voice}).encode()
            r = urllib.request.Request(f"{WHISPER_URL}/speak", data=data,
                                       headers={"Content-Type": "application/json", "X-Voice-Token": WHISPER_TOKEN})
            try:
                with urllib.request.urlopen(r, timeout=60) as resp:
                    wav = resp.read()
            except Exception as e:
                return self._json(502, {"error": f"voice service unavailable ({type(e).__name__})"})
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
            return
        if self.path.split("?")[0] != "/api/command":
            return self._json(404, {"error": "no such route"})
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)) or b"{}")
        text = str(req.get("text", "")).strip()[:2000]
        if not text:
            return self._json(400, {"error": "empty request"})
        try:
            return self._json(200, chat_ops(text, req.get("scene", []), req.get("units", "imperial")))
        except Exception as e:  # model offline, timeout, ...
            return self._json(502, {"reply": f"I couldn't reach my model ({type(e).__name__}). Try again in a moment.", "ops": []})

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    print(f"TrueSize Workshop on :{PORT}  data={DATA}  model={MODEL} via {OLLAMA}")
    ThreadingHTTPServer(("127.0.0.1" if os.environ.get("LOCAL_ONLY", "1") == "1" else "0.0.0.0", PORT), Handler).serve_forever()
