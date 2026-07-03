// ── Day sheet (pauta editorial diaria): the picker's demand model ───────────
//
// Daily article quotas per source table, replacing homepage-slot vacancy as the
// selection target. Derived from the editor's publication schedule (2026-07-03).
// NUMBERS ARE A DRAFT — the editor corrects them here; nothing else needs to
// change when a quota moves.
//
// Tiers encode the asymmetry the editor set:
//  - 'local'     — the product. Quota is a TARGET, quality is the veto: propose
//                  everything publishable up to the quota; when supply is dry,
//                  the day simply runs lighter (never filler).
//  - 'secondary' — abundant supply. Quota is exact: the best N, high standard.
//  - 'recurring' — templated daily items (quiniela, horóscopo...): no editorial
//                  judgment, the freshest item is auto-proposed, no scoring.
//
// Weekend = Sat/Sun in Argentina (America/Argentina/Buenos_Aires, UTC-3 fixed).

export const DAY_SHEET = {
  // ── Tier LOCAL: rotation is non-negotiable ─────────────────────────────
  'local':                  { tier: 'local', weekday: 6,  weekend: 2 },
  'instituciones':          { tier: 'local', weekday: 6,  weekend: 2 },
  'local-facebook':         { tier: 'local', weekday: 4,  weekend: 1 },
  'pueblos-alemanes':       { tier: 'local', weekday: 8,  weekend: 2 },
  'huanguelen':             { tier: 'local', weekday: 3,  weekend: 2 },
  'la-sexta':               { tier: 'local', weekday: 11, weekend: 5 },
  'deporte-local-regional': { tier: 'local', weekday: 3,  weekend: 3 }, // weekend = match results

  // ── Tier SECONDARY: fills around the locals ────────────────────────────
  'primera-plana':       { tier: 'secondary', weekday: 10, weekend: 5 },
  'politica':            { tier: 'secondary', weekday: 4,  weekend: 0 },
  'economia':            { tier: 'secondary', weekday: 4,  weekend: 0 },
  'deportes':            { tier: 'secondary', weekday: 4,  weekend: 2 },
  'mundo':               { tier: 'secondary', weekday: 4,  weekend: 2 },
  'agro':                { tier: 'secondary', weekday: 4,  weekend: 1 },
  'turismo':             { tier: 'secondary', weekday: 2,  weekend: 1 },
  'vinos':               { tier: 'secondary', weekday: 2,  weekend: 1 },
  'autos':               { tier: 'secondary', weekday: 2,  weekend: 1 },
  'historia-literatura': { tier: 'secondary', weekday: 1,  weekend: 0 },
  'cine-series':         { tier: 'secondary', weekday: 2,  weekend: 1 },
  'cultura':             { tier: 'secondary', weekday: 1,  weekend: 0 },
  'espectaculos':        { tier: 'secondary', weekday: 5,  weekend: 1 },
  'recetas':             { tier: 'secondary', weekday: 3,  weekend: 1 },
  'lifestyle':           { tier: 'secondary', weekday: 3,  weekend: 1 },
  'salud':               { tier: 'secondary', weekday: 4,  weekend: 1 },
  'tecnologia':          { tier: 'secondary', weekday: 4,  weekend: 0 },

  // ── Tier RECURRING: today's item, always ───────────────────────────────
  'quiniela':   { tier: 'recurring', weekday: 1, weekend: 1 },
  'horoscopo':  { tier: 'recurring', weekday: 1, weekend: 1 },
  'efemerides': { tier: 'recurring', weekday: 1, weekend: 1 },
  'clima':      { tier: 'recurring', weekday: 1, weekend: 1 },
}
// Weekday total ≈ 100 (locals 41 · secondary 55 · recurring 4)
// Weekend total ≈ 39  (locals 17 · secondary 18 · recurring 4)

const ART_TZ = 'America/Argentina/Buenos_Aires'

/** Is the given instant a Saturday/Sunday in Argentina? */
export function isWeekendArt(date = new Date()) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: ART_TZ, weekday: 'short' }).format(date)
  return day === 'Sat' || day === 'Sun'
}

/**
 * Start of the current Argentine day as an ISO string (ART is UTC-3, no DST),
 * used to count "approved today" in Airtable via IS_AFTER(CREATED_TIME(), ...).
 */
export function startOfDayArtIso(date = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: ART_TZ }).format(date) // YYYY-MM-DD
  return `${ymd}T03:00:00.000Z`
}

/**
 * Resolve today's sheet: one row per quota'd table.
 * @returns {Array<{feedId: string, tier: string, quota: number}>}
 */
export function daySheetFor(date = new Date()) {
  const weekend = isWeekendArt(date)
  return Object.entries(DAY_SHEET).map(([feedId, row]) => ({
    feedId,
    tier: row.tier,
    quota: weekend ? row.weekend : row.weekday,
  }))
}

export function getSheetRow(feedId, date = new Date()) {
  const row = DAY_SHEET[feedId]
  if (!row) return null
  return { feedId, tier: row.tier, quota: isWeekendArt(date) ? row.weekend : row.weekday }
}

export default { DAY_SHEET, daySheetFor, getSheetRow, isWeekendArt, startOfDayArtIso }
