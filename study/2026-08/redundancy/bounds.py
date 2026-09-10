#!/usr/bin/env python3
"""bounds.py - turn an observed ZERO into a reportable upper bound.

WHY THIS FILE EXISTS. This lane has a standing rule, written after three
overclaims: never write an absolute. "Zero cross-server clones" and "not a
single server in between" are the shape of claim the next run falsifies.
Observing zero of something in a finite sample earns an UPPER BOUND, not a
denial.

The publishing lane needs those bounds as citable figures, and a figure is only
publishable here if a committed script regenerates it. This is that script.

METHOD. One-sided 95 percent Clopper-Pearson upper bound for 0 successes in n
trials. With k=0 this is the exact binomial bound

    p_upper = 1 - alpha**(1/n)          alpha = 0.05

which is also what scipy.stats.beta.ppf(1-alpha, k+1, n-k) returns at k=0. Both
are computed below and asserted equal, so the number does not depend on scipy
being present or on a particular version's edge-case handling. The familiar
"rule of three" (3/n) is printed alongside as the sanity check it is; it is a
large-n approximation and is NOT the figure to publish.

WHAT n IS, and this is the part that is easy to get wrong. The redundancy metric
in measure-redundancy.py is defined as the "share of DEDUPLICATED tools having at
least one OTHER tool at cosine >= t". The denominator is therefore TOOLS, not
pairs and not servers. threat-tests.py T3 and T4 reuse that same rate() function
after zeroing same-unit pairs, so a 0.0 percent cross-server figure means zero
TOOLS had a cross-server near-duplicate, out of the deduplicated tool count.

Self-test reproduces the 1.53 percent already published for 0 partial-annotation
servers of 194, which is the one bound this lane has previously reported. If that
assertion ever fails, this script and that published figure have diverged and the
published one is the suspect.

Usage:
  python3 bounds.py                # the three bounds this lane cites
  python3 bounds.py --self-test
  python3 bounds.py --n 2756       # any single n
"""
import argparse

ALPHA = 0.05

# (label, n, what the zero was observed over, where it is committed)
OBSERVATIONS = [
    ("cross-server near-duplicates, real MCP, cosine >= 0.70",
     2756,
     "deduplicated real-MCP tools with >=1 cross-server tool at cosine >= 0.70",
     "research/redundancy/THREAT-TESTS.md T4"),
    ("cross-server near-duplicates, @codespar family, cosine >= 0.70",
     125,
     "tools across the 7 @codespar servers, all of which started",
     "research/redundancy/THREAT-TESTS.md T3"),
    ("partial annotation coverage",
     194,
     "servers advertising >=1 tool, annotating some tools but not all",
     "lanes/research.md, behavioral tier n=400"),
]


def upper_bound_zero(n, alpha=ALPHA):
    """Exact one-sided upper bound for 0 of n, as a percentage."""
    if n <= 0:
        raise ValueError("n must be positive")
    return 100.0 * (1.0 - alpha ** (1.0 / n))


def _scipy_agrees(n, alpha=ALPHA):
    """Cross-check against Clopper-Pearson via the beta quantile. Returns None
    if scipy is absent, so the script still runs without it."""
    try:
        from scipy.stats import beta
    except ImportError:
        return None
    return 100.0 * beta.ppf(1.0 - alpha, 1, n)


def self_test():
    # The published 1.53 percent bound for 0 of 194.
    b = upper_bound_zero(194)
    assert abs(b - 1.53) < 0.01, b
    # A bound is a bound: it must never be read as zero.
    assert upper_bound_zero(2756) > 0.0
    # Monotone in n.
    assert upper_bound_zero(125) > upper_bound_zero(2756)
    # Agreement with scipy where available.
    s = _scipy_agrees(194)
    if s is not None:
        assert abs(s - b) < 1e-9, (s, b)
    print("SELF-TEST PASS (0 of 194 reproduces the published 1.53 percent)")


def report():
    print("One-sided 95 percent upper bounds for an observed zero.")
    print("Clopper-Pearson, exact. The rule-of-three column is a check, not the figure.\n")
    print(f"{'observation':62s} {'n':>6s} {'bound':>8s} {'3/n':>8s}")
    print("-" * 88)
    for label, n, _over, _src in OBSERVATIONS:
        b = upper_bound_zero(n)
        print(f"{label:62s} {n:6d} {b:7.2f}% {300.0/n:7.2f}%")
    print()
    for label, n, over, src in OBSERVATIONS:
        b = upper_bound_zero(n)
        print(f"* {label}")
        print(f"    0 of {n} {over}")
        print(f"    -> under {b:.2f} percent at 95 percent confidence. Source: {src}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--n", type=int, help="bound for a single n")
    a = ap.parse_args()
    if a.self_test:
        self_test()
    elif a.n:
        print(f"0 of {a.n}: under {upper_bound_zero(a.n):.4f} percent (95 percent, one-sided)")
    else:
        self_test()
        print()
        report()
