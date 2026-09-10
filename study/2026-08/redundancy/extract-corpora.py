#!/usr/bin/env python3
"""extract-corpora.py - pull (name, description) tool records out of each corpus.

One extractor per corpus, each stating exactly which files and which field it
reads, so the corpus definition is auditable rather than implied. Two of the
three disagreements with the earlier unverified run are almost certainly corpus
definition differences, which is the whole reason this file records sha256 for
every source file it touches.

Fetch the sources first:
  BFCL v4    https://raw.githubusercontent.com/ShishirPatil/gorilla/main/
             berkeley-function-call-leaderboard/bfcl_eval/data/BFCL_v4_*.json
  UltraTool  https://raw.githubusercontent.com/JoeYing1019/UltraTool/main/
             data/English-dataset/{dev,test}.json
  MCP        produced by ../sample/probe-sample.mjs (the toolCatalog field)

Usage:
  python3 extract-corpora.py --bfcl <dir> --ultratool <dir> --mcp <file> --out <dir>
"""
import argparse
import glob
import hashlib
import json
import os


def read_rows(path):
    """These releases ship a mix of JSONL and JSON-array files. Handle both."""
    raw = open(path, encoding="utf-8").read().strip()
    if not raw:
        return []
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, list) else [obj]
    except json.JSONDecodeError:
        return [json.loads(line) for line in raw.splitlines() if line.strip()]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_bfcl(d):
    """Every tool definition in every BFCL v4 row's `function` list.

    SCOPE, stated because it is a real limit. Seven of the twenty released files
    carry `function: null` and contribute ZERO tools: the four multi_turn files
    and the memory file reference tool CLASSES by name, with definitions living
    in multi_turn_func_doc/, and format_sensitivity and web_search carry none.
    So this corpus is effectively the 13 single / multiple / parallel / live /
    irrelevance files, and the multi-turn function documents are OUT OF SCOPE.
    Verified: running over all 20 files and over the 13 gives the identical
    8,726 records.

    A tool appearing in N rows is emitted N times. That repetition is the thing
    being measured, so it must not be collapsed here."""
    tools, files = [], []
    for path in sorted(glob.glob(os.path.join(d, "*.json"))):
        files.append({"file": os.path.basename(path), "sha256": sha256(path)})
        n = 0
        for row in read_rows(path):
            for fn in row.get("function", []) or []:
                if isinstance(fn, dict) and fn.get("name"):
                    tools.append({"name": fn["name"], "description": fn.get("description") or ""})
                    n += 1
        files[-1]["tools"] = n
    return tools, files


def extract_ultratool(d):
    """Every tool in every English-split row's `tools` list, dev PLUS test.

    The earlier unverified run reported 1,726 deduplicated tools where this
    definition yields 2,032, so it probably used one split rather than both.
    Stated, not reconciled."""
    tools, files = [], []
    for path in sorted(glob.glob(os.path.join(d, "*.json"))):
        files.append({"file": os.path.basename(path), "sha256": sha256(path)})
        n = 0
        for row in read_rows(path):
            for fn in row.get("tools", []) or []:
                if isinstance(fn, dict) and fn.get("name"):
                    tools.append({"name": fn["name"], "description": fn.get("description") or ""})
                    n += 1
        files[-1]["tools"] = n
    return tools, files


def extract_mcp(path):
    """Tools advertised by the 195 included servers of the 2026-08-22 probability
    sample. Real, independently authored, deployed tools."""
    rows = json.load(open(path, encoding="utf-8"))
    return ([{"name": r["name"], "description": r.get("description") or ""} for r in rows],
            [{"file": os.path.basename(path), "sha256": sha256(path), "tools": len(rows)}])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bfcl")
    ap.add_argument("--ultratool")
    ap.add_argument("--mcp")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    prov = {}
    for name, fn, src in (("bfcl", extract_bfcl, a.bfcl),
                          ("ultratool", extract_ultratool, a.ultratool),
                          ("mcp", extract_mcp, a.mcp)):
        if not src:
            continue
        tools, files = fn(src)
        json.dump(tools, open(os.path.join(a.out, f"{name}.json"), "w"))
        prov[name] = {"rawTools": len(tools), "sources": files}
        print(f"{name}: {len(tools)} raw tool records from {len(files)} file(s)")
    json.dump(prov, open(os.path.join(a.out, "provenance.json"), "w"), indent=2)
