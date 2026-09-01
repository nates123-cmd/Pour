/**
 * Identify a drink, and estimate its style axes.
 *
 * Two ways in, same output: a typed name, or a photograph of the label. Reading
 * beats recall, so the photo path is the more reliable of the two and is worth
 * preferring when the bottle is in your hand.
 *
 * Two jobs in one call either way. The visible job is identification: you type
 * "Guinness" and get brewery, style and ABV back so the log entry is not just a
 * string.
 *
 * The invisible job is the axes. There is no beer or spirit palate model yet --
 * there is no data to fit one on. Capturing a style estimate at log time is what
 * makes one fittable later, the same way the 23 hand-scored wines made
 * palate-v1 possible. Without it, a year of ratings is a list of names and
 * numbers with nothing to regress against, and the axes would have to be
 * back-derived from memory.
 *
 * Neither path is checked by anything here. For beer, lib/brewery.js
 * corroborates the producer separately against Open Brewery DB.
 */
import { callModel, extractJSON, toImageBlock } from './proxy'

// Identification is a knowledge lookup with a visible, correctable answer: if it
// names the wrong brewery you can see that. Cheap model is right here.
export const LOOKUP_MODEL = 'claude-haiku-4-5'

// Reading a label is reading, not recall, and a misread word is equally visible.
// Same model and same reasoning as the wine-list and wine-label paths.
export const LABEL_MODEL = 'gemini-2.5-flash'

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

/** The shared contract. Both paths return exactly this. */
const shape = (axes) =>
  `{"found": true, "name": "...", "producer": "...", "style": "...", "origin": "...",
 "abv": 5.4, "axes": {${axes.map((a) => `"${a}": 1-10`).join(', ')}},
 "confidence": 0.0-1.0, "basis": "one short clause"}`

const rules = `- "name" is the canonical product name.
- "producer" is the brewery or distillery on its own, without the product name.
- "origin" is the country, or the country and region.
- "abv" is a number or null. Never invent one you are not reasonably sure of.
- Lower "confidence" when you are unsure which product is meant, and set it below
  0.4 when you are essentially guessing. Abstaining beats a confident wrong answer.
- Return ONLY the JSON object, no prose and no code fence.`

export async function lookupDrink(query, category) {
  const axes = AXES_BY_CATEGORY[category]
  if (!axes) throw new Error(`No lookup for ${category}.`)

  const system = `You identify a ${LABEL[category]} from a partial or misspelled name and
estimate its style.

Return ONLY a JSON object, no prose and no code fence:
${shape(axes)}

Axis guide, each 1-10, describing STYLE not quality:
${GUIDE[category]}

Rules:
${rules}
- Correct the user's spelling into the canonical product name.
- If the name matches nothing you recognise, return {"found": false} and nothing else.`

  const raw = await callModel({
    system,
    model: LOOKUP_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: `Identify: ${query}` }],
  })

  return normalize(extractJSON(raw), axes, query)
}

/**
 * Photograph of a can, bottle or label -> the same object a typed lookup gives.
 *
 * Worth preferring over typing: the model is reading rather than recalling, so
 * a niche brewery it could never have named from memory is legible on the tin.
 */
export async function readDrinkLabel(file, category) {
  const axes = AXES_BY_CATEGORY[category]
  if (!axes) throw new Error(`No lookup for ${category}.`)

  const { block, dataUrl } = await toImageBlock(file)

  const system = `You read a photograph of a ${LABEL[category]} and identify it, then
estimate its style.

Return ONLY a JSON object, no prose and no code fence:
${shape(axes)}

Axis guide, each 1-10, describing STYLE not quality:
${GUIDE[category]}

Rules:
${rules}
- Read what is PRINTED on the label or can. Prefer the label over what you think
  the product should be.
- A can often prints the beer name far larger than the brewery. Both matter; do
  not mistake one for the other.
- If the label states an ABV, use that number exactly rather than your own estimate.
- Estimate the axes from the style on the label plus what you know of the producer.
- If the photo is not a ${LABEL[category]} at all, return {"found": false} and nothing else.`

  const raw = await callModel({
    system,
    model: LABEL_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'Identify this.' }] }],
  })

  const drink = normalize(extractJSON(raw), axes, null)
  if (drink === undefined) {
    throw new Error('Could not read that label. Fill the frame with the front of the can or bottle.')
  }
  return { drink, thumbnail: dataUrl }
}

/**
 * undefined = unparseable, null = nothing recognised, object = a drink.
 * lookupDrink throws on undefined for backward compatibility; the label path
 * gives a photo-specific message instead.
 */
function normalize(p, axes, fallbackName) {
  if (!p) {
    if (fallbackName === null) return undefined
    throw new Error('Could not read the lookup. Try again.')
  }
  if (p.found === false) return null

  const clamp = (v) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null
  }
  const cleanAxes = {}
  for (const a of axes) cleanAxes[a] = clamp(p.axes?.[a])

  const name = String(p.name || fallbackName || '').trim()
  if (!name) return null

  return {
    name,
    producer: p.producer || null,
    style: p.style || null,
    origin: p.origin || null,
    abv: Number.isFinite(Number(p.abv)) ? Number(p.abv) : null,
    axes: cleanAxes,
    confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
    basis: String(p.basis || '').trim(),
  }
}
