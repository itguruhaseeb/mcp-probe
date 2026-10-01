# arXiv submission guide

This folder holds the arXiv-ready preprint. It is distinct from `../paper.md`,
which is the JOSS-style *software* paper for the tool itself.

**Version 1 is live as arXiv:2609.10962. Version 2, the correction below, has
NOT been submitted. Replacing the arXiv version requires Haseeb's explicit
approval, as every public step does.**

## Version 2 (prepared 2026-10-01): correction of the annotation figures

`main.tex` in this folder is now the v2 source. What changed, and only this:

- The "annotation" figures in v1 (58.8% random, 41.5% curated, 72/122/0
  servers, "194 of 194 all-or-nothing", 1.53% bound) were produced by a harness
  that counted tools missing a `title`, not tools missing the safety hints
  the text described. Established by re-probing the August servers at pinned
  versions (`study/2026-10/august-recount/`). Section 5.2 is rewritten: the
  numbers are kept under their correct label (titles), the safety-hint
  figures are reported on the 166 recountable servers (58.1% of tools,
  51/112/2), and the October 2026 draw is added as a replication
  (`study/2026-10/sample/`).
- Abstract, contribution bullet, Figure 1 label and caption, a new threats
  paragraph on the instrument error and three further probe defects, and the
  data-availability section. Nothing else moved; inclusion, failure taxonomy,
  schema and redundancy results are unchanged.
- Build check 2026-10-01: two `pdflatex` passes, 11 pages, no errors, no
  undefined references. (The local check ran without `lmodern` and
  `microtype`, which are absent from the sandbox TeX tree; both are in the arXiv
  tree and stay in the preamble.)

For the replacement form:

- **Comments:** "v2: corrects the annotation figures of v1, which measured tool
  titles rather than safety hints (Section 5.2); adds a re-probe at pinned
  versions and a second seeded draw (October 2026). 11 pages. Seeded,
  re-runnable pipeline and per-server outcomes:
  https://github.com/itguruhaseeb/mcp-probe ; archived at
  doi:10.5281/zenodo.21347997"
- Everything else on the form is unchanged from v1.
- The MSR 2027 draft derived from this file must be regenerated from the v2
  source before submission; its Section 5.2 carried the same error.

## What to upload

arXiv builds LaTeX from source. Upload the source, not a PDF.

- `main.tex` is self-contained: standard `article` class, bibliography embedded
  via `thebibliography`, no external `.bib`. That single file is the whole
  submission.

### Build check

Verified 2026-08-22 with `pdflatex` (two passes): 9 pages, no errors, no
undefined references or citations, zero overfull boxes. Preamble uses only
packages present in the arXiv TeX Live tree. `lmodern` is required, because
`microtype` font expansion needs a scalable font.

## Metadata for the submission form

- **Title:** What a Random Draw from the MCP Registry Contains, and What
  Tool-Use Benchmarks Contain Instead
- **Author:** Haseeb Mohammed Afsar (ORCID 0009-0000-4038-1272)
- **Primary category:** cs.SE (Software Engineering)
- **Cross-list:** cs.AI (Artificial Intelligence)
- **License:** CC BY 4.0, recommended for reuse and citation
- **Comments:** "9 pages. Seeded, re-runnable pipeline and per-server outcomes:
  https://github.com/itguruhaseeb/mcp-probe ; archived at
  doi:10.5281/zenodo.21347997"
- **Abstract:** paste the plain-text version from the paper's abstract
  environment, with LaTeX markup stripped.

## The one remaining blocker

**arXiv endorsement.** First-time cs.* submitters must be endorsed by an
established arXiv author unless the account auto-qualifies (an institutional
email or prior arXiv activity often does). Register at arxiv.org and start the
submission; the system says immediately whether you are auto-endorsed for cs.SE.
If not, the endorsement form generates a code for a colleague who has posted to
cs.SE or cs.AI. One endorser is enough. This needs a human account and a human
endorser and cannot be cleared from a sandbox.

The placeholder-citation warning that used to sit here is **resolved**. It was
fixed in commit 39ed6e5 and the current bibliography contains no placeholders.
Every reference was checked against its own arXiv abstract page on 2026-08-22,
not cited from memory.

## Venue recommendation, with the evidence

**Recommendation: arXiv first, then MSR or an ICSE/FSE short track.**

Why arXiv first. Every paper this one engages with appeared on arXiv between
2026-05 and 2026-08 (2605.09817, 2607.02577, 2607.11086, 2608.00150,
2608.00997). This subfield is moving on a weeks-long clock and is currently
publishing preprint-first. A paper measuring a registry that grows by roughly 195
servers a day loses value on a six-month review cycle, and the deployment
crossover reported in Section 6 is already partly historical.

Why MSR next. The paper is a registry-mining study with a seeded sample, a
hash-pinned frame, released scripts, and per-server outcomes published so the
aggregates can be recounted. That is squarely the MSR data-and-tool profile, and
the artifact is already in the shape their evaluation asks for.

Why not JOSS for this one. JOSS rejected the *tool* paper on scope and
significance in August 2026 (openjournals/joss-reviews#11164). This is a research
paper, not a software paper, and it is better used as one of the citing works
that supplies the demonstrated impact JOSS asked for when the tool paper is
resubmitted.

Honest caveat on positioning. Three contributions this lane originally planned
are outscaled by the work above, and the paper says so in Section 2 rather than
ignoring it. The claim it makes is narrow on purpose. See
`.workstream/research/RELATED-WORK.md` in the private workstream repo for the
full assessment.

## Steps, which Haseeb drives

1. Clear the endorsement gate.
2. arxiv.org, log in, Submit, start new submission.
3. Subject class cs.SE primary, cross-list cs.AI.
4. Upload `main.tex`, let arXiv build, check the generated PDF preview.
5. Paste title, authors, abstract, comments. Choose CC BY 4.0.
6. Add ORCID to the author record.
7. Submit. arXiv holds for moderation, then assigns the ID and DOI.

## After it is live, on his say-so

- Add the arXiv ID to `README.md` and to `CITATION.cff` as a `preferred-citation`
  of type `article`.
- Add the arXiv ID as a related identifier on the Zenodo record.
- Announce it. That is a separate approval, per channel.
