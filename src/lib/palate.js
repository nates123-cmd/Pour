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
/**
 * A score, and an honest one.
 *
 * The thing palate-v1 cannot do is predict a rating: leave-one-out R^2 is 0.33,
 * so "this is a 4.2" is a number with no right to be on screen. What it CAN do
 * is order bottles -- 72.7% pairwise overall, 92.3% on bottles at least 1.5
 * stars apart. So the score is built out of ordering rather than prediction: it
 * is a percentile against the 23 bottles he has actually rated.
 *
 * That also fixes a real gap. `rel` is distance from whatever list happens to be
 * in the photograph, so the best bottle on a bad list and the best bottle on a
 * great list read the same. This is measured against a fixed reference, so two
 * bottles scanned on different nights are comparable.
 *
 * WHY IT IS NOT THE PLAIN EMPIRICAL PERCENTILE. That was the first version, and
 * the offline dry-run killed it: a good wine list runs off the top of a
 * 23-bottle cellar, so the top three bottles all scored 100 and the bottom three
 * all scored 0. Every statement was true and the number had stopped being a
 * score exactly where it would be used -- choosing between the good ones.
 *
 * So the percentile is taken against a normal fitted to those 23 fits rather
 * than against the 23 as a bag of items. It is smooth, it never saturates, and
 * it is still entirely his own cellar setting the scale: nothing but the mean
 * and spread of bottles he has rated goes into it. Clamped to 1..99, because 0
 * and 100 are certainties and this model has none. The literal count is still
 * available and still shown -- see `placeInCellar().ahead`, which is the
 * sub-line under the number.
 */
const CELLAR_SD = Math.sqrt(
  CELLAR.reduce((t, w) => t + (w.fit - CELLAR_MEAN) ** 2, 0) / (CELLAR.length - 1),
)

/**
 * Abramowitz & Stegun 7.1.26, max error 1.5e-7 -- far past what 23 bottles
 * justify, but the alternative is a dependency.
 *
 * This approximates erf(x). The normal CDF needs erf(z / sqrt(2)), NOT erf(z),
 * and passing z straight in is the bug that shipped for about ten minutes here:
 * it made the distribution too narrow, so the top four bottles on the sample
 * menu all clamped to 99 and the score saturated again in a new way. Only the
 * cross-check against sip.py's math.erf caught it, which is the entire reason
 * the two rankers are kept in step.
 */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return x >= 0 ? y : -y
}

const normalCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2))

export function palateMatch(axes) {
  const fit = fitIndex(axes)
  const pct = 100 * normalCdf((fit - CELLAR_MEAN) / CELLAR_SD)
  return {
    score: Math.min(99, Math.max(1, Math.round(pct))),
    beats: CELLAR.filter((w) => w.fit < fit).length,
    of: CELLAR.length,
  }
}

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
