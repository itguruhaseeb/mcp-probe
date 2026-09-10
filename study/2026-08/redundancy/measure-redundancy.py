#!/usr/bin/env python3
"""measure-redundancy.py - near-duplicate rate within a tool corpus.

THE RULE THIS SCRIPT EXISTS TO ENFORCE: deduplicate GLOBALLY, on name plus the
full description, across the ENTIRE corpus, BEFORE any similarity is computed.
A per-file dedup key once missed cross-file repeats and inflated a measured
redundancy figure from 19.3 to 33.5 percent, in exactly the direction that
flattered the hypothesis. Global dedup is hardcoded here. It is deliberately
NOT a flag, so no future run can turn it off.

Method, identical across corpora:
  unit          name + " " + description
  vectorizer    TF-IDF, word unigrams and bigrams, sublinear term frequency,
                fit SEPARATELY per corpus (never a shared vocabulary)
  similarity    cosine
  redundancy@t  share of DEDUPLICATED tools having at least one OTHER tool at
                cosine >= t. This is the definition. A different definition
                gives a different number, which is exactly why it is written
                down here and reported in the output.

Also reports the exact-duplicate rate of the RAW release, which is a stronger
and more useful finding than the near-duplicate rate: it says how much of a
published file is repetition rather than tools.

Self-test:
  python3 measure-redundancy.py --self-test

Usage:
  python3 measure-redundancy.py --corpus name=path.json [--corpus ...] --out summary.json
"""
import argparse
import json
import os
import tempfile

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

THRESHOLDS = [0.70, 0.80, 0.85, 0.90]
BLOCK = 2000


def key(t):
    """The dedup key: name plus FULL description, whitespace-normalised only.
    Never a prefix, never a hash of the name alone."""
    return (" ".join((t.get("name") or "").split()),
            " ".join((t.get("description") or "").split()))


def measure(path):
    raw = json.load(open(path, encoding="utf-8"))

    # ---- exact-duplicate contamination of the raw release -------------------
    seen, uniq = set(), []
    for t in raw:
        k = key(t)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(t)
    exact_dupes = len(raw) - len(uniq)

    # ---- near-duplicate rate, computed on the DEDUPLICATED corpus -----------
    docs = [f"{k[0]} {k[1]}".strip() for k in (key(t) for t in uniq)]
    vec = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True,
                          lowercase=True, min_df=1)
    X = vec.fit_transform(docs)          # TfidfVectorizer L2-normalises rows
    n = X.shape[0]

    # Blocked sparse matmul: n reaches tens of thousands and a dense n x n will
    # not fit. Hits are recorded on both axes so a pair straddling a block
    # boundary cannot be missed.
    hits = {t: np.zeros(n, dtype=bool) for t in THRESHOLDS}
    for i in range(0, n, BLOCK):
        S = (X[i:i + BLOCK] @ X.T).toarray()
        for r in range(S.shape[0]):
            S[r, i + r] = 0.0            # never count a tool as its own duplicate
        for t in THRESHOLDS:
            over = S >= t
            hits[t][i:i + S.shape[0]] |= over.any(axis=1)
            hits[t] |= over.any(axis=0)

    return {
        "rawTools": len(raw),
        "exactDuplicateRows": exact_dupes,
        "exactDuplicatePct": round(100 * exact_dupes / len(raw), 1) if raw else None,
        "dedupedTools": n,
        "vocabulary": len(vec.vocabulary_),
        "redundancyPct": {f"{t:.2f}": round(100 * int(hits[t].sum()) / n, 1) for t in THRESHOLDS},
        "redundantTools": {f"{t:.2f}": int(hits[t].sum()) for t in THRESHOLDS},
    }


def self_test():
    """A five-tool corpus with an answer worked out by hand."""
    toy = [
        {"name": "get_weather", "description": "Get the current weather for a city"},
        {"name": "get_weather", "description": "Get the current weather for a city"},
        {"name": "fetch_weather", "description": "Get the current weather for a city"},
        {"name": "send_email", "description": "Send an email message to a recipient"},
        {"name": "list_files", "description": "List files in a directory on disk"},
    ]
    d = tempfile.mkdtemp()
    p = os.path.join(d, "toy.json")
    json.dump(toy, open(p, "w"))
    r = measure(p)
    assert r["rawTools"] == 5, r
    assert r["exactDuplicateRows"] == 1, r          # the repeated get_weather
    assert r["dedupedTools"] == 4, r
    assert r["redundantTools"]["0.70"] == 2, r      # get_weather / fetch_weather, both sides
    print("SELF-TEST PASS")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", action="append", help="name=path.json")
    ap.add_argument("--out", default="redundancy.json")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()

    if a.self_test:
        self_test()
        raise SystemExit(0)
    if not a.corpus:
        ap.error("pass --corpus name=path.json, or --self-test")

    out = {"method": {
        "unit": "name + ' ' + description",
        "dedup": "GLOBAL, on name plus full description, before any similarity is computed",
        "vectorizer": "TF-IDF, word unigrams+bigrams, sublinear_tf, fit per corpus",
        "similarity": "cosine",
        "redundancyDefinition": "share of deduplicated tools with at least one OTHER tool at cosine >= threshold",
        "thresholds": THRESHOLDS,
    }, "corpora": {}}

    for spec in a.corpus:
        name, path = spec.split("=", 1)
        print(f"measuring {name} ...", flush=True)
        out["corpora"][name] = measure(path)
        print(json.dumps(out["corpora"][name], indent=2), flush=True)

    json.dump(out, open(a.out, "w"), indent=2)
