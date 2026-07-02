# Autonomous Curation & Publishing — Implementation Spec

Status: DRAFT for review · Author: pairing with Claude · Date: 2026-06

## 1. Goal & non-goals

**Goal.** Automate the news pipeline end to end — fetch → select → generate → review → publish — so that low-risk content publishes itself and the operator's role shrinks from *pre-publish reviewer* to *post-publish monitor* (a daily digest + a one-click kill). "Automate as much as possible, with as little review as possible."

**Non-goals.**
- Not replacing Gemini for article generation. Generation stays on Gemini (`ai-service.js`); Claude is added only at the judgment layer (selection + review).
- No changes to `rdv-frontend` (read-only constraint).
- Not auto-publishing high-risk content (local hard news, named private individuals, deaths, crime, electoral politics) — those always route to a human, pre-annotated.

**Operating principle.** Trust is earned per content tier with data, not granted up front. Every tier runs in *shadow* (agent annotates, human publishes) until measured agreement justifies promotion to auto-publish.

## 2. Current state (already built)

- **Fetch:** `pullSupply` (`src/services/curation/supply.js`).
- **Dedup:** `filterDuplicates` (`src/services/curation/dedup.js`) — Supabase + Airtable.
- **Generate:** `generateDrafts` (`src/services/curation/generate.js`) → Airtable, Gemini, handles social + regular.
- **Block/tier config:** `src/config/homepage-blocks.js` — `layer` field (1 = manual/curated, 2 = auto-eligible) is the seed of the risk tiering.
- **Publish (web):** `POST /webhooks/airtable/publish` → `webhook.js:33` → `supabaseService.publishArticle` (`supabase.js:157`). `front`/`order` carry through → homepage placement automatic.
- **Publish (social):** `POST /webhooks/airtable/social-media` → creates a `Redes Sociales` Airtable record.
- **Infra:** Vercel crons (quiniela/clima/etc.), bearer auth (`ADMIN_API_TOKEN`), `maxDuration: 300` per-function pattern.

The whole loop is already HTTP-callable. This spec adds two new "brains" (selection, review) and wires the existing pieces into a headless orchestrator.

## 3. Architecture

```
            ┌──────────── Vercel cron (schedule) ────────────┐
            ▼                                                 │
   [A] Fetch + dedup            (existing: supply.js, dedup.js)
            ▼
   [B] Select  ← Claude (batch) NEW: which titles are newsworthy / fit a block
            ▼
   [C] Generate                 (existing: generate.js, Gemini)  → Airtable draft
            ▼
   [D] Review  ← Claude (batch) NEW: faithfulness + policy + quality → verdict
            ▼
   [E] Route by tier + verdict  NEW:
        ├─ pass + auto-tier  → publish webhooks (web + social)  → live
        └─ else              → stays draft, flagged, for human
            ▼
   [F] Slack digest of what went live + one-click kill          NEW
```

300s limit: split into two crons + an Airtable "queue" status so no single invocation must do everything (see §9).

## 4. Phased delivery

Each phase is independently shippable and useful.

### Phase 0 — Secure the publish webhooks (PREREQUISITE)
- Add shared-secret header check to `POST /webhooks/airtable/publish` and `/webhooks/airtable/social-media` (reuse `ADMIN_API_TOKEN`, `Authorization: Bearer`).
- Update the Airtable publish script to send the header.
- **Why first:** both endpoints are currently unauthenticated — anyone can publish to the live site. A scheduled agent makes this load-bearing.
- **Acceptance:** unauthenticated POST returns 401; Airtable button still works; agent calls with header succeed.
- **Effort:** ~0.5 day.

### Phase 1 — Shadow lean gate
- New `src/services/claude-service.js`: Anthropic SDK wrapper, structured outputs, `ANTHROPIC_API_KEY`. Mirrors the shape of `ai-service.js`.
- New `src/services/curation/review.js`: single combined critic call returning a structured verdict (§7).
- Hook into the generate flow (or a sweep cron) to write verdict fields to the Airtable draft (§5).
- Log `(agentVerdict, humanDecision)` pairs for measurement.
- **No publishing authority.** Human still publishes manually. Drafts just carry annotations.
- **Acceptance:** every generated draft gets a verdict in Airtable; a scorecard query shows agent-vs-human agreement per tier.
- **Effort:** ~3 days code + 2–3 weeks accumulating calibration data.

### Phase 2 — Headless orchestration (drafts only)
- New `src/services/curation/select.js` (revive/repurpose the unused `score.js`): Claude scores fresh candidates per block, picks top-N by slot count, respects dedup.
- Two-phase cron (§9): Cron A fetch+select→queue; Cron B generate+review→draft. Still no auto-publish.
- **Acceptance:** with no human action, fresh drafts appear in Airtable, reviewed and flagged, sized to block slots.
- **Effort:** ~3–4 days.

### Phase 3 — Auto-publish Tier 0–1
- Close the two `generate.js` gaps (§5): set `status` and `section`.
- Routing: `pass` + auto-eligible tier + verdict above threshold → agent POSTs the publish webhooks (web + social). Everything else stays draft.
- Safety rails: kill switch (env flag), max-per-run / max-per-day caps, idempotency (don't double-publish), audit log.
- Slack: daily digest of what went live + one-click un-publish (set Supabase `status` back to draft).
- **Acceptance:** a Tier-0/1 article that passes the robust gate goes live with no human; kill switch halts all publishing instantly; digest lists every auto-published item.
- **Effort:** ~2–3 days.

### Phase 4 — Robust gate + widen tiers
- Upgrade the auto-publish slice from 1 critic to 3 independent adversarial critics (faithfulness / policy / plausibility); publish only on agreement.
- Promote additional tiers to auto as their shadow agreement data justifies.
- Optional later: Google Search grounding for real-world corroboration on higher tiers.
- **Effort:** ongoing.

## 5. Data model changes

**`generate.js` — two required fixes for correct auto-publish** (harmless for human drafts, silently break auto-publish):
1. Set `status: 'published'` on records intended to go live (else `publishArticle` defaults to `'draft'`, `supabase.js:233`, and the frontend hides it).
2. Set `section` to the content-category name (else `publishArticle` defaults everything to `primera-plana`, `supabase.js:186`). Source the value from `config.getSection(feedId)`.

**New Airtable fields on draft records (the gate's output):**
| Field | Type | Meaning |
|---|---|---|
| `agentVerdict` | single-select | `pass` / `review` / `reject` |
| `faithfulness` | number | 0–100, article-vs-source fidelity |
| `flags` | text/multiselect | e.g. `added-fact`, `sensitive-topic`, `voseo`, `boilerplate`, `no-image` |
| `agentReason` | text | one-line rationale |
| `checkedAt` | datetime | when reviewed |
| `riskTier` | single-select | `0`/`1`/`2`/`3` (derived from block `layer`/feed) |
| `autoPublished` | checkbox | set when the agent published it |
| `humanDecision` | single-select | shadow-mode: what the operator did (publish/hold) — for the scorecard |

**Audit log:** every agent decision (selection, verdict, publish) persisted with source text + generated article + reasoning + timestamp (Airtable table or Supabase table — TBD, §12).

## 6. Risk tiering

Maps onto the existing `layer` field in `homepage-blocks.js`, refined by feed:

| Tier | Content | Autonomy |
|---|---|---|
| 0 | Templated/recurring (quiniela, horóscopo, clima, efemérides, dólar) | Full auto (already crons) |
| 1 | Soft news (recetas, lifestyle, turismo, vinos, autos, tech, cine/espectáculos) | Auto-publish candidate after shadow proves out |
| 2 | General/national (mundo, política y economía, agro) | Pre-annotated draft, human clicks |
| 3 | Local hard news + anything with named private individuals, deaths, crime, money, health claims, electoral politics | Always human |

## 7. The review gate

**Inputs:** RSS source text (the ground truth the article was reelaborated from) + the generated article fields.

**Checks (one combined prompt for lean; three independent prompts for robust):**
- **Faithfulness** — does the article assert anything not supported by the source? (primary failure mode: reelaboration drift.)
- **Policy** — trips the skip rules (death, accident, crime, minors, named private individuals, electoral politics)?
- **Quality** — voseo, no emojis, no "publicó en Facebook" leak, title/bajada present, image present, not boilerplate.

**Verdict schema (Claude structured output):**
```json
{
  "verdict": "pass | review | reject",
  "faithfulness": 0,
  "flags": ["..."],
  "reason": "one line"
}
```

**Lean vs robust:** lean = 1 combined call (cheaper, a screen). Robust = 3 independent adversarial calls, each prompted to *refute*; publish only if ≥2 agree it's clean. Robust is used only on the auto-publish slice.

**Selection brain (Phase 2):** Claude scores fresh candidate titles per block for newsworthiness + block fit, returns top-N sized to the block's `slots`. Reintroduces the `MIN_SCORE` concept removed earlier — justified now because there is no human eye in the loop.

## 8. Models

- **Generation:** Gemini `gemini-2.5-flash` (unchanged).
- **Selection + lean review:** `claude-sonnet-4-6` (best quality-per-dollar judgment).
- **Robust auto-publish adjudication / borderline:** `claude-opus-4-8` on the small slice where being wrong is public.
- **Optional cheap mechanical checks:** `claude-haiku-4-5`.
- All gate/selection calls via **Message Batches API** (50% off; the cron is not latency-sensitive). Exception: synchronous in-line shadow verdicts cannot batch.
- Use structured outputs (`output_config.format`) for every verdict.

## 9. Orchestration

- **Cron A (frequent, cheap):** fetch + dedup + select → write candidates to Airtable with `status: queued`. Fast, no generation.
- **Cron B (frequent):** pull N `queued` → generate (Gemini) + review (Claude batch) → set `status: reviewed` or auto-publish. Drains the queue a handful per run, respecting `maxDuration: 300`.
- Each function declares `export const config = { maxDuration: 300 }` in-file (Vercel ignores `vercel.json` builds maxDuration for functions).
- Caps: `MAX_PER_RUN`, `MAX_PER_DAY` env-configurable.

## 10. Safety rails

- **Kill switch:** `AUTO_PUBLISH_ENABLED` env flag; when false, agent produces drafts only.
- **Rate caps:** per-run and per-day publish ceilings so a bad feed can't flood the site.
- **Idempotency:** never publish a record already `autoPublished` or already in Supabase.
- **Audit trail:** source + article + verdict + decision logged for every action.
- **Slack:** failure alerts (existing Slack integration) + daily digest of auto-published items with one-click un-publish (Supabase `status` → draft).
- **Shadow discipline:** during Phase 1, operator records their own decision *before* viewing the agent's verdict; otherwise the agreement metric is meaningless.

## 11. Security

- Authenticate both publish webhooks (Phase 0).
- Rotate the live token leaked in `editorial-structure-RDV.md:159`.
- Keep `ANTHROPIC_API_KEY` server-side only (Vercel env).

## 12. Cost

**Assumptions:** 80 articles/day ≈ 2,400/month. Per review pass ≈ 3,000 input + 400 output tokens. Pricing (per 1M tokens): Sonnet 4.6 $3/$15, Opus 4.8 $5/$25, Haiku 4.5 $1/$5. Selection ≈ a few batched runs/day ≈ ~$3/month (negligible). Figures ±~15% with article length.

**Per-article gate cost (standard price):**
| Model | Lean (1 critic) | Robust (3 critics) |
|---|---|---|
| Haiku 4.5 | $0.005 | $0.015 |
| Sonnet 4.6 | $0.015 | $0.045 |
| Opus 4.8 | $0.025 | $0.075 |

**Monthly @ 2,400 articles — standard price:**
| Model | Lean | Robust |
|---|---|---|
| Haiku | $12 | $36 |
| Sonnet | $36 | $108 |
| Opus | $60 | $180 |

**Monthly @ 2,400 — Batch API (−50%, applies to the cron pipeline):**
| Model | Lean | Robust |
|---|---|---|
| Haiku | $6 | $18 |
| Sonnet | $18 | $54 |
| Opus | $30 | $90 |

**Cost by phase (steady-state monthly):**
| Phase | Config | Cost/mo |
|---|---|---|
| 1 — shadow lean, synchronous (no batch) | Sonnet, 1 critic | ~$36 |
| 1 — shadow lean, batched sweep | Sonnet, 1 critic | ~$18 |
| 4 — recommended steady state | Sonnet robust gate (batched) + Opus on auto slice/borderline | **~$55–70** |
| Worst case | Opus robust on everything, no batch | ~$180 |

**Generation (Gemini) is unchanged and not in these numbers** — it's the bulk of any AI-news cost and stays on Gemini by design.

**Bottom line:** the gate that removes pre-publish review costs **~$20 (lean shadow) to ~$70 (full robust, recommended)** per month at 80 articles/day. Cost is not the deciding factor; calibration time is.

## 13. Timeline

- Coding: ~1.5–2 weeks across phases (0 → 4).
- Calendar to fully autonomous: ~4–6 weeks, dominated by the 2–3 weeks of Phase-1 shadow calibration (cannot be compressed by coding faster).

## 14. Open decisions

1. **Selection policy:** smart Claude newsworthiness scorer vs dumb slot-fill of all fresh non-duplicates? (Spec assumes smart.)
2. **First tier to auto-publish** once shadow proves out — recommend Tier 1 soft news.
3. **Max articles/day cap** for the auto-publisher.
4. **Audit log location:** new Airtable table vs Supabase table.
5. **Shadow gate placement:** synchronous in `generate.js` (instant verdict, full price) vs batched sweep cron (delayed verdict, half price).
6. **Corroboration:** add Google Search grounding later, or stay source-faithful only?

## 15. Constraints (standing)

- Gemini-only for generation; Claude only at the judgment layer.
- No file changes in `rdv-frontend`.
- Respect `maxDuration` in-file export on every Vercel function.
