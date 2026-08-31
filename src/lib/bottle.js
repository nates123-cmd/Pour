/**
 * One bottle, two ways in: a photograph of the label, or a typed name.
 *
 * Both produce the SAME entry shape that lib/menu.js produces for a line on a
 * wine list, so both feed the existing anchored scorer in lib/score.js
 * unchanged. That matters more than it looks: the palate coefficients only mean
 * anything on the scale the anchors establish, so a second scoring prompt would
 * be a second, silently drifting scale. There is one scorer.
 *
 * Model choice follows the rule the rest of the app follows -- cheap model where
 * a mistake is visible and correctable, capable model where it is not:
 *
 *   label photo -> gemini-2.5-flash   reading, and a garbled producer is obvious
 *   typed name  -> claude-haiku-4-5   recall, and the wrong bottle is obvious
 *   both        -> claude-sonnet-4-6  axis estimates, whose errors are INVISIBLE
 *
 * That third step is score.js. This file only does the first two.
 */
import { callModel, extractJSON, toImageBlock } from './proxy'

export const LABEL_MODEL = 'gemini-2.5-flash'
export const SEARCH_MODEL = 'claude-haiku-4-5'

/**
 * The shape both paths return. `raw` is what the scorer joins on and what the
 * screen shows, so it has to read like a bottle a person would say out loud.
 *
 * `color` exists because palate-v1 was fitted on 23 reds and nothing else. On a
 * list that limitation is a footnote; on a single-bottle screen it is the whole
 * answer, so the caller needs to be able to say so before showing a placement.
 */
const SHAPE = `{"found": true, "raw": "...", "producer": null, "wine": null, "appellation": null,
"region": null, "country": null, "varietal": null, "vintage": null,
"color": "red|white|rose|sparkling|fortified|unknown",
"confidence": 0.0-1.0, "basis": "one short clause"}`

const COMMON = `- "raw" is the bottle as a person would say it: producer, cuvee, vintage. No extra words.
- NEVER invent a vintage, appellation or varietal. null is correct when you cannot tell.
- "vintage" is a number or null. "NV" is null.
- "confidence" is about WHICH BOTTLE this is, not about how good it is. Below 0.4 means you
  are essentially guessing at the producer. Abstaining beats a confident wrong bottle.
- "basis" says in one short clause how you identified it.
- Return ONLY the JSON object, no prose and no code fence.`

const LABEL_SYSTEM = `You read a photograph of a single wine bottle and identify the wine.

Return ONLY a JSON object:
${SHAPE}

Rules:
${COMMON}
- Read what is PRINTED on the label. Prefer the label over what you think the wine should be.
- A label often prints the appellation far larger than the producer. Both matter; do not
  mistake the appellation for the producer.
- If the photo is not a wine bottle at all, return {"found": false} and nothing else.`

const SEARCH_SYSTEM = `You identify a wine bottle from a partial or misspelled name.

Return ONLY a JSON object:
${SHAPE}

Rules:
${COMMON}
- Correct the user's spelling into the canonical producer and cuvee.
- If the user names only a region or a grape ("Etna Rosso", "Barolo") with no producer, that
  is not one bottle. Return found true with the fields you can fill and confidence below 0.4.
- If the name matches no wine you recognise, return {"found": false} and nothing else.`

export async function readBottleLabel(file) {
  const { block, dataUrl } = await toImageBlock(file)

  const raw = await callModel({
    system: LABEL_SYSTEM,
    model: LABEL_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'Identify this bottle.' }] }],
  })

  const bottle = normalize(extractJSON(raw), null)
  if (bottle === undefined) {
    throw new Error('Could not read that label. Fill the frame with the front of the bottle.')
  }
  return { bottle, thumbnail: dataUrl }
}

export async function searchWine(query) {
  const raw = await callModel({
    system: SEARCH_SYSTEM,
    model: SEARCH_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: `Identify: ${query}` }],
  })

  const bottle = normalize(extractJSON(raw), query)
  if (bottle === undefined) throw new Error('Could not read the lookup. Try again.')
  return bottle
}

const COLORS = ['red', 'white', 'rose', 'sparkling', 'fortified', 'unknown']

/** undefined = unparseable, null = nothing recognised, object = a bottle. */
function normalize(p, fallbackRaw) {
  if (!p) return undefined
  if (p.found === false) return null

  const raw = String(p.raw ?? fallbackRaw ?? '').trim()
  if (!raw) return null

  return {
    raw,
    kind: 'wine',
    producer: p.producer ?? null,
    wine: p.wine ?? null,
    appellation: p.appellation ?? null,
    region: p.region ?? null,
    country: p.country ?? null,
    varietal: p.varietal ?? null,
    vintage: num(p.vintage),
    price_glass: null,
    price_bottle: null,
    section: null,
    color: COLORS.includes(p.color) ? p.color : 'unknown',
    confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
    basis: String(p.basis ?? '').trim(),
  }
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 1900 && n < 2100 ? n : null
}
