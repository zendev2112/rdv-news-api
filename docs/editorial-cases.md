# Editorial Cases & Candidate Features

Running log of real cases the shadow review gate surfaces, and the "should-have-done"
rule each one implies. Let the pile build, then sort into the few real rules before
encoding anything. Nothing here is committed policy yet.

## Candidate features

### Ticker / breves on the front (parked 2026-06-30)
A short news ticker for **competitor-sourced hard-news facts** — the content class
that's awkward as a full article but valuable as a one-liner.

Why it fits:
- Built for facts without expression: one line, no padding, no Q&A.
- **No image needed** → sidesteps competitor image-rights entirely.
- Attribution reads as natural ("vía La Nueva Radio Suárez"), not apologetic.
- Low commitment: a breve isn't your full reported story, so echoing a competitor's
  fact there is appropriate, where on the front page it felt like theft.

Pipeline split it implies — output becomes two types, not one:
| Output | Source | Generation | Image |
|---|---|---|---|
| Full article | Institutional / own reporting | Full reelaboración | Yes |
| Ticker breve | Competitor hard-news fact | Compress to one line + attribution | No |

Open decisions before building:
1. Freshness/TTL — items expire (24–48h?), newest-first. This makes or breaks it.
2. Volume — needs steady flow to look alive; gut-check breves/day.
3. Still attributed, still fact-only — not a loophole to dump competitor content.

Division of labor: backend (breves table, one-line compress path, routing) = ours;
ticker UI on the front = user's (rdv-frontend, hands-off here).

## Cases log

Format: one line per case — `<draft> · <what it is> · <should-have-done>`

- «Padre Burgui asume como párroco» · interview from La Nueva Radio Suárez · should
  NOT be a full article; either drop, down-convert to attributed fact, or route to
  ticker. Ideally re-source from the parish/diocese (institutional) and publish freely.
  → RESOLVED (2026-06-30): otros-medios interviews now detected before generation and
  run through **fact-brief mode** — a short attributed brief of the news fact only
  (no quotes, no Q&A). Interviews with no reportable fact return NO_FACT and are
  skipped. Implemented in content-type.js + prompts.extractFactsBrief + article-pipeline
  brief mode. The brief is the natural feed for the future ticker.
