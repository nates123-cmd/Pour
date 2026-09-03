/**
 * Wines -> style-axis estimates.
 *
 * This is the step that decides the ranking, and its mistakes are INVISIBLE: a
 * wrong axis estimate produces a confident, plausible-looking order and nothing
 * on screen says otherwise. So it does not get the cheap model, even though the
 * per-scan cost difference is a fraction of a cent at this volume.
 *
 * The model string is the knob for the bake-off: score the 23 known bottles with
 * each candidate and keep whichever ranking best matches the real ratings.
 * Only strings already proven through the proxy are safe to put here.
 */
import { callModel, extractJSON, looksTruncated } from './proxy'
import anchors from '../data/anchors.json'

export const SCORE_MODEL = 'claude-sonnet-4-6'

/**
 * Few-shot anchors from the user's OWN scored bottles.
 *
 * Without these the axis numbers drift and the ranking is meaningless: the
 * coefficients in palate.json only mean anything on the scale those 23 bottles
 * were scored on. Change the anchors and you must refit the model.
 */
const ANCHOR_NAMES = [
  'Nicosia Frappato di Vittoria Sabbie di Sutta 2024',
  'Tornatore Etna Rosso 2022',
  'Patrizi Barbaresco 2022',
  'Chateau Mourgues du Gres Costieres de Nimes Galets Rouge 2023',
  'Pikes Eastside Shiraz 2022',
  'Los Vascos Cromas Gran Reserva Carmenere 2020',
]

const anchorBlock = () =>
  anchors.wines
    .filter((w) => ANCHOR_NAMES.includes(w.name))
    .map((w) => `  ${w.name}: tannin ${w.tannin}, savory ${w.savory}, aromatic_lift ${w.aromaticLift}`)
    .join('\n')

const SYSTEM = () => `You score wines on style axes. Three of them feed a numeric ranking model,
so consistency with the anchor examples matters more than nuance.

Axes, each 1-10:
  tannin        - astringency and grip. 1 = Frappato or Gamay, 5 = a Grenache blend, 10 = young Barolo.
  savory        - earth, herb, olive, iron, smoke, funk, as opposed to pure fruit sweetness.
                  1 = fruit-bomb New World red, 10 = Etna Rosso or old-school Bandol.
  aromatic_lift - floral, perfumed, high-toned aromatics. 1 = heavily oaked Cabernet,
                  10 = Frappato, cru Beaujolais, Nerello Mascalese.
  dryness       - PERCEIVED dryness on the palate, not residual sugar alone. Ripe fruit and
                  new-oak vanillin read as sweetness even at 0 g/L, so a jammy high-alcohol
                  Grenache is NOT a 10. 1 = a sweet wine (Port, recioto, Lambrusco dolce),
                  4 = overtly jammy and oak-sweet New World red, 7 = a ripe but dry Rhone,
                  10 = bone dry and austere (Etna Rosso, traditional Nebbiolo, Loire Cabernet
                  Franc). Most dry reds land 6-10; use the full range within that.

Score STYLE, not quality. An excellent heavy oaked wine still scores low aromatic_lift, and a
sweet wine is not a worse wine for scoring low dryness.

Infer from producer, appellation, varietal and vintage. If you do not recognise the producer,
infer from appellation and varietal alone and LOWER your confidence. Set confidence below 0.4
when you are essentially guessing. Do not silently guess at high confidence - abstaining is
better than a confident wrong answer here.

Anchor examples, already scored on this exact scale. They cover the three ranking axes only --
there is no dryness anchor, so judge dryness from the reference points above:
${anchorBlock()}

Return ONLY a JSON object, no prose and no code fence:
{"scores": [{"raw": "...", "tannin": 1-10, "savory": 1-10, "aromatic_lift": 1-10,
"dryness": 1-10, "confidence": 0.0-1.0, "basis": "one short clause"}]}

Copy each "raw" back VERBATIM from the input so the results can be joined.`

export async function scoreWines(wines) {
  const listing = wines
    .map((w) =>
      `- raw: ${w.raw}\n  producer: ${w.producer}  wine: ${w.wine}  varietal: ${w.varietal}` +
      `  appellation: ${w.appellation}  region: ${w.region}  vintage: ${w.vintage}`)
    .join('\n')

  const raw = await callModel({
    system: SYSTEM(),
    model: SCORE_MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: `Score these ${wines.length} wines:\n\n${listing}` }],
  })

  const parsed = extractJSON(raw)
  if (!parsed) {
    throw new Error(
      looksTruncated(raw)
        ? 'Too many wines to score at once. Try a section of the list.'
        : 'Could not score that list. Try again.',
    )
  }

  return (Array.isArray(parsed.scores) ? parsed.scores : [])
    .map((s) => ({
      raw: String(s?.raw ?? '').trim(),
      tannin: clamp(s?.tannin),
      savory: clamp(s?.savory),
      aromaticLift: clamp(s?.aromatic_lift ?? s?.aromaticLift),
      /* Descriptive only: dryness is shown, never ranked on. It is also the one
       * axis with no anchor from his own bottles, so it must never be able to
       * drop a wine out of the ranking -- hence null-tolerant, and absent from
       * the filter below. */
      dryness: clamp(s?.dryness),
      confidence: Math.max(0, Math.min(1, Number(s?.confidence) || 0)),
      basis: String(s?.basis ?? '').trim(),
    }))
    .filter((s) => s.raw && s.tannin && s.savory && s.aromaticLift)
}

const clamp = (v) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null
}
