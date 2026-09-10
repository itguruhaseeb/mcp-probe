#!/usr/bin/env python3
"""threat-tests.py - can the low real-MCP redundancy be explained away?

Kim et al. (arXiv:2605.09817) find pervasive CODE cloning across 7,508 MCP
repositories. We measure 2.8 percent description redundancy among real MCP tools
and call the ecosystem diverse. Both can be true, but the obvious alternative
explanation is that our probe silently discards clones: we only see servers that
complete a handshake, which is 48.8 percent of a random draw.

Each test is written so a result in the wrong direction KILLS the finding rather
than shading it. Results are written up in THREAT-TESTS.md.

  T1  Do the servers the handshake filter REMOVED look more duplicated than the
      ones it kept? A server that never starts advertises no tools, so the
      testable proxy is the npm-authored package description, which exists for
      both groups. LOW POWER, see the write-up.
  T2  Is author-family concentration (npm scopes shipping several packages)
      higher in the excluded group? A filter removing clone families shows here.
  T3  Adversarial single case: the author shipping the MOST servers, all of them
      INCLUDED. If any author produces cross-server near-duplicates, it is this.
  T4  How much of each corpus's redundancy is WITHIN one authoring unit rather
      than between independent ones? MCP unit = server; benchmarks = task row.
  T5  Is the corpus rate driven by a few very large servers? Per-server cap.

Usage:
  python3 threat-tests.py --study <dir of probe-sample records> \\
      --npm npm-meta.json --mcp mcp_grouped.json \\
      --bfcl bfcl_grouped.json --ultratool ultratool_grouped.json

The *_grouped.json inputs are [{name, description, group}] records; group is the
server package for MCP and the task row id for the benchmarks.
"""
import argparse
import glob
import json
import os
import re
from collections import Counter

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

T = [0.70, 0.80, 0.85, 0.90]


def dedup(rows):
    """Global dedup on name plus full description. First occurrence keeps its group."""
    seen, out = set(), []
    for name, desc, grp in rows:
        k = (" ".join((name or "").split()), " ".join((desc or "").split()))
        if k in seen:
            continue
        seen.add(k)
        out.append((f"{k[0]} {k[1]}".strip(), grp))
    return out


def sim(docs):
    X = TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True,
                        lowercase=True, min_df=1).fit_transform(docs)
    S = (X @ X.T).toarray()
    np.fill_diagonal(S, 0.0)
    return S


def rate(S, n):
    return {f"{t:.2f}": round(100 * int((S >= t).any(axis=1).sum()) / n, 1) for t in T}


def scope(pkg):
    m = re.match(r"^(@[^/]+)/", pkg)
    return m.group(1) if m else None


def grp(t):
    return t.get("group") or t.get("server")


def main(a):
    recs = [json.load(open(f)) for f in glob.glob(os.path.join(a.study, "*.json"))]
    inc = [r for r in recs if r["status"] == "included"]
    exc = [r for r in recs if r["status"] == "excluded"]

    npm = json.load(open(a.npm))
    print("T1  handshake-filter bias, unit = npm package name + npm description")
    for label, group in (("INCLUDED (started)", inc), ("EXCLUDED (never started)", exc)):
        rows = [(r["package"], (npm.get(r["package"]) or {}).get("description"), r["package"])
                for r in group if (npm.get(r["package"]) or {}).get("description")]
        d = dedup(rows)
        if len(d) < 2:
            continue
        print(f"  {label:26s} n={len(d):3d}  {rate(sim([x for x, _ in d]), len(d))}")
    print("  NOTE: LOW POWER. Reads descriptions, not code. A clone that rewrites its")
    print("  description is invisible to this test. T2 and T3 are better powered.")

    print("\nT2  author-family concentration by npm scope")
    for label, group in (("INCLUDED", inc), ("EXCLUDED", exc)):
        sc = Counter(scope(r["package"]) for r in group if scope(r["package"]))
        multi = {k: v for k, v in sc.items() if v > 1}
        print(f"  {label:9s} n={len(group):3d} scopes={len(sc):3d} "
              f"multi-package scopes={len(multi)} packages in them={sum(multi.values())}")
        print(f"            {sorted(multi.items(), key=lambda x: -x[1])[:5]}")

    tools = json.load(open(a.mcp))
    top = Counter(scope(r["package"]) for r in inc if scope(r["package"])).most_common(1)
    if top:
        fam = top[0][0]
        fam_tools = [t for t in tools if str(grp(t)).startswith(fam + "/")]
        d = dedup([(t["name"], t.get("description"), grp(t)) for t in fam_tools])
        g = np.array([y for _, y in d])
        S = sim([x for x, _ in d])
        S[g[:, None] == g[None, :]] = 0.0
        print(f"\nT3  adversarial case: {fam}, {top[0][1]} servers, {len(fam_tools)} tools, all INCLUDED")
        print(f"  cross-server rate {rate(S, len(d))}   max cross-server cosine {S.max():.3f}")

    print("\nT4  within-unit vs cross-unit redundancy")
    for name, path in (("mcp (unit=server)", a.mcp), ("bfcl (unit=task row)", a.bfcl),
                       ("ultratool (unit=task row)", a.ultratool)):
        if not path:
            continue
        rows = json.load(open(path))
        d = dedup([(r["name"], r.get("description"), grp(r)) for r in rows])
        docs = [x for x, _ in d]
        g = np.array([y for _, y in d])
        S = sim(docs)
        allp = rate(S, len(docs))
        S2 = S.copy()
        S2[g[:, None] == g[None, :]] = 0.0
        cross = rate(S2, len(docs))
        ng = len(set(g))
        print(f"  {name:26s} unique={len(docs):5d} units={ng:5d} ({len(docs)/ng:4.1f} tools/unit)")
        print(f"    {'all pairs':24s} {allp}")
        print(f"    {'CROSS-unit only':24s} {cross}")
    print("  CAVEAT: units are not comparably sized. Removing same-unit pairs subtracts")
    print("  much less from a corpus averaging under 2 tools per unit than from one")
    print("  averaging 14, so the cross-unit columns are NOT power-matched.")

    print("\nT5  per-server cap on the MCP corpus")
    d = dedup([(t["name"], t.get("description"), grp(t)) for t in tools])
    for cap in (10, 25, 50):
        seen, kept = {}, []
        for x, gg in d:
            seen[gg] = seen.get(gg, 0) + 1
            if seen[gg] <= cap:
                kept.append(x)
        print(f"  cap {cap:2d} tools/server  n={len(kept):5d}  {rate(sim(kept), len(kept))}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--study", required=True)
    ap.add_argument("--npm", required=True)
    ap.add_argument("--mcp", required=True)
    ap.add_argument("--bfcl")
    ap.add_argument("--ultratool")
    main(ap.parse_args())
