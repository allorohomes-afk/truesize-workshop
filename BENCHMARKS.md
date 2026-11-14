# TrueSize Workshop benchmark

**Question:** can ordinary home computers run a voice-driven 3D event workshop well enough to trust the sizes?
**Answer:** yes. A 4-billion-parameter model on an 8 GB Mac mini got every test right, in about 2.5 seconds.

Measured November 2026. Free models through [Ollama](https://ollama.com), no cloud.

## 1. Words → 3D pieces (the part that has to be right)

Eight real requests, each run 3 times (24 tries per model). A try passes only if **every** check passes: the
right pieces, the right count, and the right sizes. Examples: "a 30 by 40 foot ballroom with 12 foot ceilings, a 9 foot
blush, gold and ivory organic balloon arch… and two 60 inch round tables"; "two 6 foot banquet tables and 8 white
chairs"; "make the arch 7 feet"; "remove the chairs"; "a 10 by 12 metre hall with a 2.5 metre balloon arch".
The checks are in [`bench/benchmark.py`](bench/benchmark.py).

| Model (Ollama) | Computer | Requests right | Checks right | Typical time | Slowest |
|---|---|---|---|---|---|
| **qwen3:4b-instruct** | Mac mini M2, 8 GB (2023) | **24/24** | 57/57 | **2.5 s** | 14.5 s |
| qwen2.5:14b | MacBook Air M5, 16 GB | 24/24 | 57/57 | 16.7 s | 43.4 s |
| qwen2.5-coder:7b | MacBook Air M5, 16 GB | 24/24 | 57/57 | 3.4 s | 31.8 s |
| qwen2.5:3b | MacBook Air M5, 16 GB | 21/24 | 54/57 | 2.2 s | 15.1 s |
| llama3.2:3b | MacBook Air M5, 16 GB | 16/24 | 48/57 | 1.5 s | 10.4 s |

"Typical" is the median. The slowest request is always the longest one (8 chairs + 2 tables means more pieces to write out).

**Why small models do well here:** the model never does arithmetic. It only names pieces; software checks every number
against your words. It drops sizes you never said, uses the number closest to each item for counts ("two 6 foot tables
and 8 chairs" is 8 chairs), reads "30 by 40" as width × depth, and takes shapes like "arch-shaped backdrop" from your
words. The benchmark found two of those rules missing (the counting one and the backdrop shape); with them in place
the 4B, 7B and 14B models are all perfect.

**What fails on 3B models:** qwen2.5:3b put the arch at the wrong height when one sentence held four sizes.
llama3.2:3b often answered without building, or rebuilt instead of resizing. Use 4B or larger.

## 2. Voice (Mac mini M2, 8 GB)

| Step | Model | Time |
|---|---|---|
| Speak a one-sentence reply | Kokoro 82M (12 accents) | **0.7 s** |
| Transcribe 4 s of speech | Whisper small via MLX | **0.5 s** (9 s the first time, while it loads) |

## 3. ✨ Render it (MacBook Air M5, 16 GB)

| Step | Model | Time |
|---|---|---|
| Repaint the 3D view as a photo, depth-locked | SDXL Turbo + depth ControlNet (small), ComfyUI | **about 1 minute** (56–62 s) |

## Run it on your computer

```bash
python3 bench/benchmark.py --runs 3 --model qwen3:4b-instruct --machine "your computer, RAM"
# another computer's Ollama:  --ollama http://<that computer>:11434
```

Please post your table row in an issue (computer, RAM, model, the numbers). Old laptops, mini PCs and
graphics-card desktops are exactly what we want to hear about.
