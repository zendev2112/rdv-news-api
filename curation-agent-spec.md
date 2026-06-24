# Curation Agent — Spec & Implementation Plan

Status: **draft for review** · Trigger: **manual-first** (cron later) · Owner: RDV

## 1. Goal

Automate the tedious part of the daily workflow — *deciding which RSS items to
generate and which homepage block they fill* — while reusing the **existing
generation pipeline and the layered Rioplatense Spanish prompts untouched**, and
keeping a human gate before anything goes live.

The agent never invents prompts. It only decides **which URLs** to feed into the
existing `processArticleFromUrl()` and **where they belong** (`front` + `order`).

## 2. Core principles (load-bearing requirements)

1. **Quality floor beats quota.** If no candidate clears a minimum score, the
   slot stays empty. Never generate filler to hit a target number.
2. **Reuse, never reimplement, the prompts.** Generation = existing
   `processArticleFromUrl()` → existing `src/prompts/index.js` + 3-tier voseo
   enforcement. Byte-identical to a manual run.
3. **Human gate stays.** Agent writes **drafts** to Airtable only. Publishing
   (Airtable → Supabase → frontend) remains the existing manual/webhook step.
4. **Newest leads the block.** The agent sets `order: 'principal'` on **every**
   generated article. Since `sortArticlesForSlots` ties `principal` records by
   `created_at` DESC, this means pure recency within each block — the freshest
   article fills the hero slot, older ones cascade down. (Implication: a newer
   agent article will outrank an older manually-pinned `principal` in the same
   block. That's the intended rotation behavior.)
5. **Sensitive topics route to human.** Deaths, accidents, crime, named private
   individuals, election-window politics → flagged, never auto-drafted.
6. **Everything is auditable.** Every pick *and skip* is logged with its score
   and reason, streamed to the existing admin console.

## 3. Trigger model (manual-first)

A **two-step, human-in-the-loop** flow. No cron in v1.

```
[admin.html]  ── click "Plan" ──▶  POST /api/agent/curate?mode=plan
                                     (stages 1–4, NO side effects)
              ◀── proposed assignments + scores + reasons ──

  review panel: per block, checkboxes, score, reason, source link
  (uncheck anything you don't want)

[admin.html]  ── click "Generate selected" ──▶ POST /api/agent/curate?mode=execute
                                                body: { assignments: [...] }
                                                (stage 5: generate drafts)
              ◀── per-item results: drafted / failed ──

  drafts now in Airtable → existing review → Publish (unchanged)
```

`mode=plan` is also a **dry-run**: run it for a week alongside manual work,
compare, build trust, *then* (optionally) add a Vercel cron that calls
`mode=execute` directly per batch.

## 4. Flow stages

| # | Stage | Build | Component |
|---|-------|-------|-----------|
| 1 | Compute demand | reuse + small new | `coverage` logic + new blocks config |
| 2 | Pull supply (RSS, no generation) | reuse | `fetcher.fetchFeedData` |
| 3 | Prefilter (deterministic) | new (pure JS) | dedup / image / length / freshness |
| 4 | Score + assign (LLM) | new | the only "agent brain" |
| 5 | Generate drafts | reuse | `processArticleFromUrl` + `front`/`order` |
| — | Human gate + publish | reuse | Airtable → `/publish` webhook |
| 6 | Feedback | automatic | next plan re-reads coverage |

### Stage 1 — Demand
- Live gaps from the coverage query (`article_with_sections`, `front`, `status`,
  `created_at`): `need = slots − filled`, boosted by `newestAgeHours`.
- Capped by per-batch targets from the new blocks config (derived from
  `editorial-structure-RDV.md`). In manual mode the operator can also override
  scope ("all hungry" / one block).
- Output: ranked hungry blocks `[{front, label, need, staleness, eligibleFeeds}]`.

### Stage 2 — Supply
- For the **union of feeds eligible** for the hungry blocks, `fetchFeedData(url)`
  and collect items — **do not generate**.
- Output: `[{feedId, title, url, summary, pubDate, image, contentLength}]`.

### Stage 3 — Prefilter (no LLM, cheap)
Drop with a recorded reason:
- **Dedup (4-way):** URL/title already in Supabase (published), already a draft
  in Airtable, already picked earlier this run, or cross-feed duplicate.
  Implemented via Airtable + Supabase **queries** (serverless-safe) + an in-run
  Set — *not* the `.state` file ledger (ephemeral on Vercel). See §9 #2.
- **No usable image** (for image-required blocks).
- **Too short** (summary/content below floor → bad reelaboration).
- **Too old** (outside freshness window).

### Stage 4 — Score + assign (LLM, only on survivors)
- **Gemini only**, via existing `generateContent` (`ai-service.js`). No other
  providers. Runs only on the small prefiltered+deduped survivor set, so cost is
  bounded.
- Input: surviving candidates + hungry-block editorial identities.
- Output (structured): `assignments[]` and `skipped[]` (see §6).
- Decides: newsworthiness, **section fit** (which eligible block), **semantic
  dedup**. Role is **not** decided — always `principal` (see principle 4).
  Applies the quality floor + sensitive filter.

### Stage 5 — Generate
For each approved assignment:
- `processArticleFromUrl(url, { section })` (reuse) → draft in the feed's Airtable
  table.
- **Set `front` = assigned block** and **`order` = `'principal'`** on the record,
  so the existing publish path (`supabase.js:241-242`) routes it to the right
  homepage block and the newest article leads it.
- Mark `generatedBy: agent` (new field) for later rejection-rate analysis.
- Skip-and-continue on failure; report per item.

## 5. New config — single source of truth

`src/config/homepage-blocks.js` (replaces the markdown mapping table):

```js
export const HOMEPAGE_BLOCKS = [
  {
    front: 'ActualidadSection',
    label: 'Actualidad',
    slots: 13,
    layer: 2,                       // 1 = manual/curated, 2 = auto-eligible
    requiresImage: true,
    eligibleFeeds: ['primera-plana', 'instituciones', 'local', 'local-facebook'],
    targets: { weekday: { morning: 0, midday: 7, afternoon: 6 }, weekend: 4 },
  },
  // ... one entry per homepage block, eligibleFeeds inverted from the doc table
]
```

Notes baked into the config:
- **Layer 1 (review-required):** PrincipalSection, NoticiasImportantes,
  Actualidad-from-CS, PueblosAlemanes, LaSexta, Huanguelén. These can be
  *proposed* but default to `mode=plan` approval, never `mode=execute` via cron.
- **No-feed blocks:** `PymesYEmprendimientosSection` has **no RSS feed** in
  config → cannot be auto-fed; mark `manualOnly: true`.
- **Recurring/templated feeds** (quiniela, horoscopo, efemerides) are handled by
  their own crons → **excluded** from curation to avoid double-handling.

## 6. Data contracts

**`POST /api/agent/curate?mode=plan`** — Bearer auth (same as coverage). Body:
`{ scope?: 'hungry' | front-name, batch?: 'morning'|'midday'|'afternoon', maxPerRun?: number }`

Response:
```jsonc
{
  "generatedAt": "ISO",
  "demand":  [{ "front": "...", "label": "...", "need": 5, "staleHours": 300 }],
  "plan":    [{ "url": "...", "front": "...", "role": "principal",
               "feedId": "...", "score": 78, "reason": "...", "title": "...",
               "image": "...", "pubDate": "..." }],
  "skipped": [{ "url": "...", "reason": "duplicate|no-image|too-old|low-score|sensitive" }],
  "stats":   { "feedsPulled": 6, "candidates": 120, "afterPrefilter": 31, "assigned": 14 }
}
```

**`POST /api/agent/curate?mode=execute`** — Body: `{ assignments: [{url, front, role, feedId}] }`
Re-runs dedup just-in-time (idempotency), then generates. Response:
```jsonc
{ "results": [{ "url": "...", "front": "...", "status": "drafted|failed",
               "airtableId": "rec...", "error": null }] }
```

## 7. Files

**New**
- `api/agent/curate.js` — orchestrator endpoint (Bearer, CORS, mode switch) + `vercel.json` route
- `src/config/homepage-blocks.js` — blocks + eligibility + targets
- `src/services/curation/demand.js` — hungry-block computation
- `src/services/curation/supply.js` — feed pull + prefilter
- `src/services/curation/score.js` — Gemini scoring/assignment call (`ai-service.js`)
- `src/services/curation/dedup.js` — 4-way dedup
- `public/admin.html` — "🤖 Curation Agent" card (Plan → review panel → Generate)

**Reused (unchanged)**
- `src/services/fetcher.js` · `src/services/article-pipeline.js`
  (`processArticleFromUrl`) · `src/services/ai-service.js` ·
  `api/frontend/coverage.js` logic · Airtable insert path · `/publish` webhook

## 8. Implementation phases

1. **Config** — write `homepage-blocks.js` (invert the doc mapping, set targets).
2. **Read-only plan** — `demand` + `supply` + `dedup` + `score`, wired into
   `curate.js?mode=plan`. No generation. Verify against live data.
3. **Admin panel** — Plan button + review table (checkboxes, score, reason, link).
4. **Execute** — `mode=execute` calling `processArticleFromUrl` with `front`/`order`;
   per-item reporting into the existing console.
5. **Harden** — sensitive filter, quality floor tuning, `maxPerRun` cap,
   `generatedBy` flag, audit log.
6. **(Later) Cron** — only after the dry-run period earns trust.

## 9. Open items — VERIFIED

### ✅ #1 `processArticleFromUrl` — no core change needed; orchestrator composes
`article-pipeline.js:564` — signature is `processArticleFromUrl(url, options={})`.
- **No `section` param**, and it does **not** insert — it **returns a `fields`
  object** (`article-pipeline.js:673-696`) and returns **`null`** for social URLs
  or insufficient content.
- It does **not** set `front`/`order` (only hardcodes `status: 'draft'`).
- The table is chosen later by `airtableService.insertRecords(records, sectionId)`
  (`airtable.js:22-46`), which looks up `tableName` from `config.getSection(sectionId)`.

**So stage 5 composes existing pieces — no edits to the pipeline:**
```js
const fields = await processArticleFromUrl(url)      // reuse, untouched
if (!fields) return { status: 'failed', reason: 'social-or-insufficient' }
fields.front = assignment.front                      // inject block
fields.order = 'principal'                           // inject role
const sectionId = FEED_TO_SECTION[assignment.feedId] // feed's config section → table
await airtableService.insertRecords([{ fields }], sectionId)
```
Note: `sectionId` routes the **Airtable table**; `front` routes the **homepage
block** — two different things, both needed. `insertRecords` also already does the
post-insert image reprocessing (3s wait + CDN URL refresh), so we inherit that.

### ✅ #2 Dedup — reuse the Airtable-query pattern; do NOT rely on the file ledger
Three layers exist:
- **`.state/{sectionId}.json`** persistent ledger in `fetch-to-airtable.js:175-198`
  (cron/CLI path). **⚠️ Caveat: our endpoint is serverless — Vercel's filesystem
  is ephemeral, so `.state` files do NOT persist there.** Don't depend on it.
- **Airtable query dedup** in `slack-integration.js:770-785`
  (`filterByFormula: {url} = '...'`) — **this is what we reuse.**
- `article-pipeline.js` does no dedup.

**Decision:** stage 3 dedup = query **Airtable** (`{url}=...` per candidate table)
+ query **Supabase** (published) + in-run Set. This is queryable/persistent and
serverless-safe. If we later run on the long-lived Express server, we can
additionally read `.state` to stay in sync with cron — but never depend on it.

### ✅ #3 Status field — consistent on insert; nothing to do
Field is `status`, initial value `'draft'` (lowercase) on **every** insert path
(`fetch-to-airtable.js:1259`, `slack-integration.js:*`, `article-pipeline.js:687`).
`processArticleFromUrl` already sets it — agent needs no extra work.
- *Unrelated latent bug noted:* publish flow writes Spanish `'Publicado'`/`'Borrador'`
  but `statusChangeHandler.js:62` checks lowercase `'published'` (won't match).
  Out of scope for this agent — flagging only.

### Design decisions (not code lookups)
- **Multi-home** (one article in several blocks via `article_sections`) — **out of
  scope for v1**; single `front` per article.
- **Sensitive-topic detection** — start with a keyword blocklist in stage 4.
- **Timezone** — only relevant once cron is added (Argentina vs Vercel UTC).

## 9d. Phase 4 — BUILT & VERIFIED (`mode=execute` → drafts)

`src/services/curation/generate.js` (new) + `execute` branch in `curate.js`
(lazy-imports generate so plan-mode cold start stays light).

Per approved assignment, sequentially:
1. **Validate server-side** — block exists and `feedId ∈ eligibleFeeds` (never
   trust the client) → else `invalid-assignment`.
2. **Just-in-time dedup** re-check (filterDuplicates) → `skipped: duplicate`.
3. `processArticleFromUrl(url)` (reused untouched) → `null` ⇒ `failed:
   social-or-insufficient-content`.
4. Inject `fields.front = assignment.front`, `fields.order = 'principal'`.
5. `airtableService.insertRecords([{ fields }], feedId)` → capture record id.
6. Result per item: `drafted | failed | skipped | deferred`.

Safeguards: `EXECUTE_BATCH = 10` per request (each gen is ~10-30s; Vercel cap is
300s) — overflow returns `deferred: batch-limit (run again)`. Sequential to
respect Gemini rate limits.

Verified via the handler: empty → 400; front/feed mismatch → `invalid-assignment`
(no write); one real run scraped → Gemini → **drafted to the Mundo table** with a
record id. Test draft was deleted afterward.

**Caveat observed (pre-existing, not agent-introduced):** some sources scrape
poorly — a BBC URL yielded only 407 chars of boilerplate, so the draft was
off-topic vs its headline. `processArticleFromUrl` is the existing scraper; the
agent only chooses URLs. This is what the Airtable review gate catches. Possible
future hardening: a per-domain scrapability/trust list, or a post-scrape sanity
check (drat title vs source title divergence) before insert. Out of scope here.

## 9c. Phase 3 — BUILT & VERIFIED (admin panel)

`public/admin.html` gained a "🤖 Curation Agent" card (above Live Console Logs):
- Scope selector (defaults "All hungry blocks"; auto-populates with every block
  after a plan, so you can target one), **Plan** button, **Generate selected (N)**
  button.
- Plan → calls `mode=plan`, renders proposals **grouped by block** with a checked
  checkbox, source-linked title, Gemini score badge, reason, and feed/order tags.
  A summary line shows the funnel (proposed · hungry blocks · items → filtered →
  scored). Sensitive skips + feed errors go to the console log.
- Generate → collects checked rows and calls `mode=execute`. Currently surfaces
  the 501 "Phase 4" message cleanly; on success it will report drafted/failed and
  refresh the coverage board. Nothing generates until clicked.

Verified the endpoint handler directly (mock req/res): 401 on bad token, 501 on
execute, 200 plan with correct stats + well-formed assignment. Inline JS passes
`node --check`; DOM balanced.

## 9b. Phase 1 — BUILT & VERIFIED (read-only `mode=plan`)

Files added: `src/config/homepage-blocks.js`, `src/services/curation/{demand,supply,dedup,score}.js`,
`api/agent/curate.js`; routed in `vercel.json`; `ai-service.js` gained an optional
`thinkingBudget` passthrough (additive, existing callers unaffected).

Verified against live data end-to-end: 21 hungry blocks → 24 feeds → 1,155 RSS
items → 825 after prefilter → per-feed cap to ~119 → Gemini → **21 assignments,
one well-fitted fresh pick per block, 9 sensitive flagged.** No generation (plan
only). `execute` returns 501 (Phase 4).

Calibrations discovered during build (now in `homepage-blocks.js`):
- **`MIN_CONTENT_CHARS = 80`** (was 400). RSS summaries are ~150-char teasers, not
  article bodies; the 400 floor dropped 80% of valid items. True article-length
  sufficiency is still gated later by `processArticleFromUrl` after scraping.
- **`CANDIDATES_PER_FEED = 5`** — sending all 825 survivors to the scorer returned
  garbage; capping to the freshest few per feed (≈119 total) fixed it.
- **`thinkingBudget: 0` on the scoring call** — `gemini-2.5-flash` "thinking"
  tokens count against `maxOutputTokens` and truncated the JSON (worse with more
  blocks). Disabling thinking for this structured task fixed truncation.
- **Scorer returns only the chosen assignments** (+ a tiny `sensitive` list), not
  every rejection — code marks the rest `not-selected`. Keeps output small.
- **Front-or-label resolution** — the model sometimes returns the label ("Mundo")
  instead of the id ("MundoSection"); `score.js` resolves either.

Note on current data: nearly every block is *full but stale* (newest 168–957h),
so each shows `need: 1` from the staleness rule — consistent with the disabled
crons. The agent proposes one fresh lead per block to rotate them.

## 10. Security note (unrelated, found while mapping)

`editorial-structure-RDV.md:159` contains what looks like a live token
(`rdv_live_…`) in a tracked file. Rotate it and remove from history.
