/**
 * The ranking math. Deliberately local and deterministic.
 *
 * The model supplies style estimates; this file turns them into an order. That
 * split is the point: when a recommendation looks wrong you can tell whether the
 * axis estimate was bad or the coefficients were, instead of shrugging at a
 * black box.
 *
 * Ported from sip.py and verified to produce the identical order on
 * fixtures/sample_menu.json.
 */
import palate from '../data/palate.json'
import anchors from '../data/anchors.json'

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

/* ---- one bottle, no list ---------------------------------------------------
 *
 * A single bottle cannot be given a `rel`, because `rel` is distance from the
 * list's own average and a list of one averages to itself: the number is 0 by
 * construction and the circle would always be the same colour.
 *
 * So swap the baseline, not the quantity. The 23 bottles the model was fitted on
 * are a real, fixed reference set, and measuring against their average gives the
 * same units, the same honesty and the same six colours. It also gives a
 * statement worth reading: a POSITION IN YOUR OWN CELLAR. That is a rank, which
 * is what palate-v1 is good at, and never a predicted score, which it is not.
 *
 * The spread happens to line up: cellar rel runs -0.77..+0.76, close enough to a
 * typical list's spread that the colour thresholds in Wine.jsx need no second
 * set of numbers.
 */
const CELLAR = anchors.wines.map((w) => ({ name: w.name, fit: fitIndex(w) }))
const CELLAR_MEAN = CELLAR.reduce((t, w) => t + w.fit, 0) / CELLAR.length

/**
 * `near` is names only, deliberately. Each anchor also carries `myRating`, and
 * putting the nearest bottle's real score on screen beside a new bottle would
 * read as a prediction for the new bottle -- exactly the thing palate-v1 cannot
 * do. The names alone are enough: you remember what you thought of them.
 */
export function placeInCellar(axes, nearCount = 3) {
  const fit = fitIndex(axes)
  const near = [...CELLAR]
    .sort((a, b) => Math.abs(a.fit - fit) - Math.abs(b.fit - fit))
    .slice(0, nearCount)
    .map((w) => w.name)

  return {
    fit,
    rel: fit - CELLAR_MEAN,
    ahead: CELLAR.filter((w) => w.fit < fit).length,
    of: CELLAR.length,
    near,
  }
}

export const priceOf = (e) =>
  e.price_bottle != null ? e.price_bottle : e.price_glass != null ? e.price_glass : null
