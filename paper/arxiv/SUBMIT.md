# arXiv submission guide — MCP ecosystem study

This folder is the **arXiv-ready preprint** of the empirical study (the census +
behavioral conformance run). It is distinct from `../paper.md`, which is the
JOSS-style *software* paper for the tool itself. Submit this one to arXiv; keep the
JOSS paper for a software-journal track later.

## What to upload
arXiv builds LaTeX from source (do **not** upload a PDF; upload the source).
- `main.tex` — self-contained, standard `article` class, bibliography embedded via
  `thebibliography` (no external `.bib` needed, so nothing else to upload).

That single file is the whole submission.

## Metadata to paste into the arXiv submission form

- **Title:** Measuring the Model Context Protocol Server Ecosystem: A
  Population-Scale Census and Conformance Study
- **Author:** Haseeb Mohammed Afsar (ORCID 0009-0000-4038-1272)
- **Primary category:** cs.SE (Software Engineering)
- **Cross-list:** cs.AI (Artificial Intelligence)
- **License:** CC BY 4.0 (recommended for max reuse/citation) — pick on the form
- **Comments (optional but recommended):** e.g. "10 pages. Dataset and re-runnable
  pipeline: https://github.com/itguruhaseeb/mcp-probe ; archived at
  doi:10.5281/zenodo.21347997"
- **Abstract:** paste the plain-text version below.

### Abstract (plain text for the form)
The Model Context Protocol (MCP) is an open standard that lets large language model
(LLM) applications discover and call external tools through a uniform JSON-RPC 2.0
interface. Its adoption has produced a large, rapidly growing population of
independently authored servers, but the ecosystem has not been measured: basic
questions about its size, how servers ship, which transports and spec revisions are in
use, and whether servers conform to the specification and behave reliably have gone
unanswered. We report a two-tier empirical study. A census tier sweeps the entire
official MCP registry (16,548 unique servers at a July 2026 snapshot) and measures only
self-declared metadata, so it runs no third-party code and scales to the whole
published population. A dynamic tier launches a credential-free, stdio-launchable
subset and measures actual behavior with the open-source mcp-probe tool: handshake
success, JSON Schema validity of every advertised tool, presence of safety
annotations, protocol-version negotiation, and latency. Three results stand out.
First, the population is dominated by hosted remote servers (42.6% remote-only) and
npm/stdio local packages, and it has already fragmented across five schema revisions.
Second, hard conformance is high: all 200 tools measured in the behavioral sample
carry valid JSON Schema inputSchema definitions with zero fatal violations. Third, the
real variance is in optional safety metadata: 41.5% of tools omit the annotations
(readOnlyHint, destructiveHint, ...) that tell an autonomous agent whether a tool is
safe to call before calling it, and the omission is a clean server-level,
all-or-nothing decision rather than per-tool oversight. We release the full dataset
and a re-runnable pipeline so the measurement can be repeated at each spec release as a
longitudinal series.

## Two things to settle BEFORE you can submit

1. **Endorsement.** arXiv requires first-time submitters in cs.* to be *endorsed* by
   an established arXiv author, unless your account is auto-endorsed (institutional
   email / prior arXiv activity often auto-qualifies). As an independent researcher on
   a first cs.SE submission you may hit the endorsement gate. Options:
   - Register at arxiv.org and start the submission; the system tells you immediately
     whether you're auto-endorsed for cs.SE.
   - If not, request endorsement from a colleague who has posted to cs.SE/cs.AI (the
     form generates a code they enter). One endorser is enough.
   I cannot clear this for you — it needs your account and a human endorser.

2. **The one placeholder citation.** `main.tex` has a clearly-marked `TODO(owner)`
   bibitem (`toolreliability`) — a placeholder for a peer-reviewed tool-use/agent-
   reliability reference. Either (a) drop that one sentence + citation from the intro,
   or (b) swap in a real reference you're comfortable citing. I did **not** invent a
   citation. Everything else (MCP spec, JSON Schema, the Zenodo dataset DOI) is real.

## Steps (you drive these — submission is a public, permanent publish)
1. Resolve the two items above.
2. arxiv.org → Login → Submit → Start new submission.
3. Subject class: cs.SE primary, cross-list cs.AI.
4. Upload `main.tex`. Let arXiv's build run; check the generated PDF preview.
5. Paste title/authors/abstract/comments; choose CC BY 4.0.
6. Add your ORCID on the author record.
7. Submit. arXiv holds for moderation, then assigns the arXiv ID + DOI.

## After it's live (I can do these on your say-so)
- Add the arXiv ID to `README.md` (a second badge next to the Zenodo one) and to
  `CITATION.cff` as a `preferred-citation` of type `article`.
- Add the arXiv ID as a related identifier on the Zenodo record.
- Seed the citation: a launch post/Note with the arXiv link, and list it on the
  awesome-mcp / registry-adjacent lists.
