/**
 * The ranking math. Deliberately local and deterministic.
 *
 * The model supplies style estimates; this file turns them into an order. That
 * split is the point: when a recommendation looks wrong you can tell whether the
 * axis estimate was bad or the coefficients were, instead of shrugging at a
 * black box.
 *
 * Ported from pour.py and verified to produce the identical order on
 * fixtures/sample_menu.json.
 */
import palate from '../data/palate.json'

const M = palate.model
export const AXES = M.axesUsed // ['tannin','savory','aromaticLift']
export const MODEL_VERSION = palate.version

/**
 * Raw fit is intercept-plus-deviations on the 1-5 star scale. NEVER show it as
 * a predicted rating: palate-v1 predicts scores poorly (leave-one-out R^2 0.33)
 * even though it ranks well (92% correct on bottles far apart). Use it for
 * order, and show `rel` (distance from this list's own average) to humans.
 */
export function fitIndex(axes) {
  let total = M.intercept
  for (const a of AXES) {
    total += M.coefStandardized[a] * ((Number(axes[a]) - M.axisMean[a]) / M.axisSd[a])
  }
  return total
}

/** Below this the model is guessing, and abstaining beats a confident wrong pick. */
export const CONFIDENCE_FLOOR = 0.4

/**
 * Join entries to their scores on the verbatim `raw` string, rank, and split
 * out the ones we cannot honestly score.
 */
export function rank(entries, scores) {
  const byRaw = new Map(scores.map((s) => [s.raw, s]))
  const joined = []
  const unmatched = []

  for (const e of entries) {
    const s = byRaw.get(e.raw)
    if (!s) { unmatched.push(e); continue }
    joined.push({ entry: e, axes: s, fit: fitIndex(s), confidence: Number(s.confidence) })
  }

  joined.sort((a, b) => b.fit - a.fit)

  const ranked = joined.filter((r) => r.confidence >= CONFIDENCE_FLOOR)
  const unsure = joined.filter((r) => r.confidence < CONFIDENCE_FLOOR)

  // Relative position within this list, so nothing on screen reads like a score.
  if (ranked.length) {
    const base = ranked.reduce((t, r) => t + r.fit, 0) / ranked.length
    for (const r of ranked) r.rel = r.fit - base
  }

  return { ranked, unsure, unmatched }
}

export const priceOf = (e) =>
  e.price_bottle != null ? e.price_bottle : e.price_glass != null ? e.price_glass : null
