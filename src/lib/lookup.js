/**
 * Identify a drink from a typed name, and estimate its style axes.
 *
 * Two jobs in one call. The visible job is identification: you type "Guinness"
 * and get brewery, style and ABV back so the log entry is not just a string.
 *
 * The invisible job is the axes. There is no beer or spirit palate model yet --
 * there is no data to fit one on. Capturing a style estimate at log time is what
 * makes one fittable later, the same way the 23 hand-scored wines made
 * palate-v1 possible. Without it, a year of ratings is a list of names and
 * numbers with nothing to regress against, and the axes would have to be
 * back-derived from memory.
 */
import { callModel, extractJSON } from './proxy'

// Identification is a knowledge lookup with a visible, correctable answer: if it
// names the wrong brewery you can see that. Cheap model is right here.
export const LOOKUP_MODEL = 'claude-haiku-4-5'

export const AXES_BY_CATEGORY = {
  beer: ['bitterness', 'roast', 'malt_sweetness', 'sour_funk', 'hop_aroma', 'body'],
  spirit: ['peat_smoke', 'sweetness', 'oak', 'spice', 'fruit_ester', 'body'],
}

const GUIDE = {
  beer: `  bitterness     1 = pale lager, 10 = double IPA
  roast          1 = pilsner, 10 = imperial stout
  malt_sweetness 1 = bone-dry saison, 10 = wee heavy
  sour_funk      1 = clean lager, 10 = gueuze or wild ale
  hop_aroma      1 = helles, 10 = hazy NEIPA
  body           1 = light lager, 10 = barrel-aged imperial stout`,
  spirit: `  peat_smoke     1 = Speyside or bourbon, 10 = Laphroaig or Octomore
  sweetness      1 = dry gin, 10 = cream or heavily sweetened liqueur
  oak            1 = unaged blanco, 10 = 20-year sherry-cask
  spice          1 = wheated bourbon, 10 = high-rye or overproof
  fruit_ester    1 = neutral vodka, 10 = Jamaican pot-still rum
  body           1 = light blanco, 10 = cask-strength`,
}

const LABEL = { beer: 'beer', spirit: 'spirit or whiskey' }

export async function lookupDrink(query, category) {
  const axes = AXES_BY_CATEGORY[category]
  if (!axes) throw new Error(`No lookup for ${category}.`)

  const system = `You identify a ${LABEL[category]} from a partial or misspelled name and
estimate its style.

Return ONLY a JSON object, no prose and no code fence:
{"found": true, "name": "...", "producer": "...", "style": "...", "origin": "...",
 "abv": 5.4, "axes": {${axes.map((a) => `"${a}": 1-10`).join(', ')}},
 "confidence": 0.0-1.0, "basis": "one short clause"}

Axis guide, each 1-10, describing STYLE not quality:
${GUIDE[category]}

Rules:
- "name" is the canonical product name, corrected from the user's spelling.
- "abv" is a number or null. Never invent one you are not reasonably sure of.
- Lower "confidence" when you are unsure which product is meant, and set it below
  0.4 when you are essentially guessing. Abstaining beats a confident wrong answer.
- If the name matches nothing you recognise, return {"found": false} and nothing else.`

  const raw = await callModel({
    system,
    model: LOOKUP_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: `Identify: ${query}` }],
  })

  const p = extractJSON(raw)
  if (!p) throw new Error('Could not read the lookup. Try again.')
  if (p.found === false) return null

  const clamp = (v) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null
  }
  const cleanAxes = {}
  for (const a of axes) cleanAxes[a] = clamp(p.axes?.[a])

  return {
    name: String(p.name || query).trim(),
    producer: p.producer || null,
    style: p.style || null,
    origin: p.origin || null,
    abv: Number.isFinite(Number(p.abv)) ? Number(p.abv) : null,
    axes: cleanAxes,
    confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
    basis: String(p.basis || '').trim(),
  }
}
