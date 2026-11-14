# TrueSize Workshop

A free, local, voice-driven 3D workshop for planning events and builds **at true size**. Say *"a 30 by 40 foot
ballroom with a 9 foot blush and gold balloon arch and two 60 inch round tables"* and it builds it, counts the
balloons, and answers out loud. Measure anything, pull it apart to see every piece, change a single balloon, scan a
real room with an iPhone or iPad, and turn the view into a photo-real picture.

It runs on computers you already own. No account, no subscription, nothing leaves your network.

> Part of the **affordable home AI** movement: if it can be done for free on old hardware, it should be published so
> anyone can do it. Make content with it, build on it, sell your designs. The code is MIT.

## What it does

| | |
|---|---|
| **Talk or type** | A local language model turns your words into building steps. Software, not the AI, does every size and count, so "two tables" means two and "9 ft" means 9 ft. |
| **True-size 3D** | Rooms, balloon arches (classic or organic), round and banquet tables, chairs, backdrops, plus basic shapes. |
| **Shopping list** | Balloon counts by size, colour and finish, table seats, chairs. |
| **📏 Measure** | Click two points: distance, rise and angle. |
| **Pull apart** | Walls fold down, pieces lift and separate into labelled components. Click any single balloon to see and change its size, colour and finish, alone or every balloon like it. |
| **TrueSize Scan** (iPhone/iPad Pro) | A small free iOS app using Apple RoomPlan: scans a real room's walls, doors, windows and furniture and sends them to the Workshop at exact size. |
| **✨ Render it** | Repaints the 3D view as a photograph with ComfyUI, locked to the scene's real depth so nothing moves. |
| **Voice** | Hold-to-talk (Whisper) and spoken replies in 12 accents (Kokoro), on your own Mac. |
| **Workspaces** | Separate project folders per person, plus shared. |

## How it fits together

```
 phone / tablet / laptop browser
          │
   Workshop server  (server/workshop_server.py — Python standard library only, runs on almost anything)
     ├── Ollama (any computer)            words → building steps
     ├── voice service (an Apple Silicon Mac: services/voice_server.py)   hold-to-talk + spoken replies
     └── render relay (the computer with a GPU: server/render_relay.py → ComfyUI)   "Render it"
```

Everything is optional except the Workshop server and a model in Ollama. Without the voice service it uses the
device's own voice; without a GPU there's just no Render button result.

## Quick start (one computer)

```bash
git clone <this repo> && cd truesize-workshop
npm install && npm run build                 # builds the page into dist/
ollama pull qwen3:4b-instruct                # 2.5 GB; right on every benchmark request (see BENCHMARKS.md)
WORKSHOP_SPACES="me:Me,shared:Shared" ASSISTANT_NAME=Ada python3 server/workshop_server.py
# open http://127.0.0.1:5191
```

To use it from phones and tablets, run the server with `LOCAL_ONLY=0` and reach it over your home network or a
private VPN (a WireGuard-based mesh VPN with HTTPS sharing works well). Don't expose it to the open internet: it has no logins.

### Settings (environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `OLLAMA_URL` / `WORKSHOP_MODEL` | where the model runs, and which | `http://127.0.0.1:11434` / `qwen3:4b-instruct` |
| `WORKSHOP_SPACES` | workspaces as `id:Label` pairs | `me:Me,shared:Shared` |
| `WORKSHOP_DIR` | where projects and scans are saved | `./projects` |
| `PORT`, `LOCAL_ONLY` | port; `0` to listen on the network | `5191`, `1` |
| `WHISPER_URL`, `WHISPER_TOKEN` | the voice service | `http://127.0.0.1:8881` |
| `RENDER_URL` | where the page sends renders | the relay on the same computer |
| `RENDER_ALLOWED_ORIGINS` (relay) | page addresses allowed to call the render relay | localhost only |
| `RENDER_TRUST_HEADER` (relay) | a header your private proxy adds, to allow requests through it | none |
| `ASSISTANT_NAME` | what the assistant is called | `Ada` |

### Voice (optional, Apple Silicon Mac)

```bash
cd services && python3 -m venv .venv && .venv/bin/pip install kokoro soundfile numpy mlx-whisper
python3 -c "import secrets; print(secrets.token_urlsafe(24))" > ~/.truesize-voice-token
.venv/bin/python voice_server.py            # port 8881; give the Workshop WHISPER_URL and WHISPER_TOKEN
```

### Render it (optional, needs a GPU or Apple Silicon)

Install [ComfyUI](https://github.com/comfyanonymous/ComfyUI), put `sd_xl_turbo_1.0_fp16.safetensors` in
`models/checkpoints` and `controlnet-depth-sdxl-1.0-small` (fp16) in `models/controlnet`, then run
`python3 server/render_relay.py`. **Model licences:** SDXL Turbo is under Stability AI's community licence (free for
personal and small-business use; check the current terms before selling renders). The depth ControlNet is OpenRAIL++.
Any SDXL checkpoint works via `RENDER_CHECKPOINT`.

### TrueSize Scan (optional, iPhone Pro / iPad Pro)

See [`scan-app/README.md`](scan-app/README.md). You build it yourself in Xcode with your own Apple ID (free accounts
work; the app then needs re-installing every 7 days). Set your own bundle id in Signing & Capabilities.

## Benchmark

See [BENCHMARKS.md](BENCHMARKS.md). Run your own: `python3 bench/benchmark.py --model <model> --machine "<your computer>"`,
and please share the result in an issue so others know what their hardware can do.

## Credits

[three.js](https://threejs.org) (MIT) · [Vite](https://vitejs.dev) (MIT) · [Ollama](https://ollama.com) (MIT) ·
[Qwen](https://github.com/QwenLM) models (Apache-2.0 for the sizes we recommend) · [Kokoro](https://github.com/hexgrad/kokoro) (Apache-2.0) ·
[Whisper](https://github.com/openai/whisper) (MIT) via [mlx-whisper](https://github.com/ml-explore/mlx-examples) ·
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) (GPL-3.0, run separately) · Apple RoomPlan.

Inspired by voice-driven "JARVIS"-style workshop demos, rebuilt to be local, free and accurate to the inch.
