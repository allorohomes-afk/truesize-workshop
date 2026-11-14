#!/usr/bin/env python3
"""TrueSize Workshop benchmark: how well (and how fast) a local model turns spoken event-planning requests into the
right 3D pieces at the right sizes.

Each case is a real request plus checks on the operations that come back (after the Workshop's own software guards,
exactly as the app runs it). A case passes only if every check passes. Time is the full round trip to Ollama.

  python3 bench/benchmark.py --ollama http://127.0.0.1:11434 --model qwen2.5:14b [--model ...] [--runs 1]

Writes a Markdown table to stdout and raw results to bench/results/<model>.json.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import workshop_server as ws  # noqa: E402

UNIT = {"m": 1, "cm": .01, "mm": .001, "in": .0254, "inch": .0254, "inches": .0254, '"': .0254,
        "ft": .3048, "foot": .3048, "feet": .3048, "'": .3048}


def metres(v, default_unit="ft"):
    """'30ft', '9 ft 6 in', '60in', 2.7 -> metres (bare numbers mean the request's units)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v * UNIT[default_unit]
    total, found = 0.0, False
    for n, u in re.findall(r"(-?\d+(?:\.\d+)?)\s*(mm|cm|m(?!m)|inches|inch|in|\"|feet|foot|ft|')?", str(v).lower()):
        found = True
        total += float(n) * UNIT.get(u or default_unit, 1)
    return total if found else None


def near(v, want, unit="ft", tol=0.03):
    got = metres(v, unit)
    return got is not None and abs(got - want * UNIT[unit]) <= tol * want * UNIT[unit]


def adds(ops, kind):
    return [o for o in ops if o.get("op") == "add" and o.get("kind") == kind]


def P(o):
    return o.get("params") or {}


ARCH = {"id": "arch-1", "kind": "balloonArch", "label": "Balloon arch", "params": {"height": "8ft", "colors": ["white", "gold"]}}
ROOM = {"id": "room-1", "kind": "room", "label": "Room", "params": {"width": "30ft", "depth": "40ft", "height": "12ft"}}
CHAIRS = [{"id": f"chair-{i}", "kind": "chair", "label": "Chair", "params": {"color": "white"}} for i in range(1, 5)]

CASES = [
    ("Ballroom, arch, two tables",
     "Make a 30 by 40 foot ballroom with 12 foot ceilings, put a 9 foot blush, gold and ivory organic balloon arch "
     "against the back wall, and two 60 inch round tables in front of it", [], "imperial",
     {"room 30×40×12 ft": lambda o: any(near(P(r).get("width"), 30) and near(P(r).get("depth"), 40) and near(P(r).get("height"), 12) for r in adds(o, "room")),
      "arch 9 ft tall": lambda o: any(near(P(a).get("height"), 9) for a in adds(o, "balloonArch")),
      "arch colours": lambda o: any({"blush", "gold", "ivory"} <= {str(c).lower() for c in P(a).get("colors", [])} for a in adds(o, "balloonArch")),
      "two 60 in round tables": lambda o: len(adds(o, "roundTable")) == 2 and all(near(P(t).get("diameter"), 60, "in") for t in adds(o, "roundTable"))}),
    ("Room only", "a 20 by 30 foot room with 10 foot ceilings", [], "imperial",
     {"room 20×30×10 ft": lambda o: any(near(P(r).get("width"), 20) and near(P(r).get("depth"), 30) and near(P(r).get("height"), 10) for r in adds(o, "room")),
      "nothing else added": lambda o: all(x.get("kind") == "room" for x in o if x.get("op") == "add")}),
    ("Arch into a room", "add an 8 foot white and gold arch by the back wall", [ROOM], "imperial",
     {"one arch, 8 ft": lambda o: len(adds(o, "balloonArch")) == 1 and near(P(adds(o, "balloonArch")[0]).get("height"), 8),
      "white + gold": lambda o: any({"white", "gold"} <= {str(c).lower() for c in P(a).get("colors", [])} for a in adds(o, "balloonArch")),
      "room left alone": lambda o: not adds(o, "room")}),
    ("Tables and chairs", "two 6 foot banquet tables and 8 white chairs", [ROOM], "imperial",
     {"two 6 ft banquet tables": lambda o: len(adds(o, "banquetTable")) == 2 and all(near(P(t).get("length"), 6) for t in adds(o, "banquetTable")),
      "eight chairs": lambda o: len(adds(o, "chair")) == 8}),
    ("Resize the arch", "make the arch 7 feet", [ROOM, ARCH], "imperial",
     {"arch updated to 7 ft": lambda o: any(x.get("op") == "update" and x.get("id") == "arch-1" and near(P(x).get("height"), 7) for x in o),
      "nothing new added": lambda o: not [x for x in o if x.get("op") == "add"]}),
    ("Remove the chairs", "remove the chairs", [ROOM, *CHAIRS], "imperial",
     {"all four chairs removed": lambda o: {x.get("id") for x in o if x.get("op") == "remove"} >= {c["id"] for c in CHAIRS},
      "room kept": lambda o: "room-1" not in {x.get("id") for x in o if x.get("op") == "remove"}}),
    ("Arch backdrop", "a white arch shaped backdrop 8 feet tall", [], "imperial",
     {"backdrop, arch shape, 8 ft": lambda o: any(str(P(b).get("shape", "")).lower().startswith("arch") and near(P(b).get("height"), 8) for b in adds(o, "backdrop")),
      "not a balloon arch": lambda o: not adds(o, "balloonArch")}),
    ("Metric hall", "a 10 by 12 metre hall with a 2.5 metre balloon arch", [], "metric",
     {"room 10×12 m": lambda o: any(near(P(r).get("width"), 10, "m") and near(P(r).get("depth"), 12, "m") for r in adds(o, "room")),
      "arch 2.5 m": lambda o: any(near(P(a).get("height"), 2.5, "m") for a in adds(o, "balloonArch"))}),
]


def run(model, ollama, runs):
    ws.OLLAMA, ws.MODEL = ollama.rstrip("/"), model
    ws.chat_ops("a 10 by 10 foot room", [], "imperial")   # warm-up: load the model, not timed
    rows = []
    for name, text, scene, units, checks in CASES:
        for _ in range(runs):
            t = time.time()
            try:
                ops = ws.chat_ops(text, scene, units)["ops"]
                err = None
            except Exception as e:  # noqa: BLE001
                ops, err = [], f"{type(e).__name__}: {e}"
            secs = time.time() - t
            results = {k: bool(f(ops)) if not err else False for k, f in checks.items()}
            rows.append({"case": name, "seconds": round(secs, 1), "passed": all(results.values()), "checks": results,
                         "error": err, "ops": ops})
            print(f"  {model:22} {name:28} {'PASS' if rows[-1]['passed'] else 'fail'} {secs:5.1f}s "
                  f"{'' if rows[-1]['passed'] else [k for k, v in results.items() if not v]}", file=sys.stderr)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ollama", default="http://127.0.0.1:11434")
    ap.add_argument("--model", action="append", required=True)
    ap.add_argument("--machine", default="")
    ap.add_argument("--runs", type=int, default=1)
    a = ap.parse_args()
    out = Path(__file__).resolve().parent / "results"
    out.mkdir(exist_ok=True)
    for model in a.model:
        rows = run(model, a.ollama, a.runs)
        (out / f"{model.replace(':', '_').replace('/', '_')}.json").write_text(json.dumps({"model": model, "machine": a.machine, "rows": rows}, indent=1))
        passed = sum(r["passed"] for r in rows)
        checks = [v for r in rows for v in r["checks"].values()]
        secs = sorted(r["seconds"] for r in rows)
        print(f"| {model} | {a.machine} | {passed}/{len(rows)} | {sum(checks)}/{len(checks)} | {secs[len(secs) // 2]} s | {max(secs)} s |")


if __name__ == "__main__":
    main()
