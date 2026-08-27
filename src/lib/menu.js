/**
 * Photo of a drinks list -> structured entries.
 *
 * Reading a menu is reading, not reasoning, and mistakes here are VISIBLE: a
 * garbled wine name is obvious on screen and you can correct it. So this runs on
 * the cheapest capable model the proxy relays. reading-app measured the same
 * model line-for-line against Sonnet on page transcription at ~300 input tokens
 * and under two seconds.
 */
import { callModel, extractJSON, looksTruncated, toImageBlock } from './proxy'

export const PARSE_MODEL = 'gemini-2.5-flash'

const SYSTEM = `You read photographs of drinks lists and extract every entry.

Return ONLY a JSON object, no prose and no code fence:
{"entries": [{"raw": "...", "kind": "wine|beer|whiskey|other", "producer": null, "wine": null,
"appellation": null, "region": null, "country": null, "varietal": null, "vintage": null,
"price_glass": null, "price_bottle": null, "section": null}], "unreadable": ["..."]}

Rules:
- "raw" is the line EXACTLY as printed, including abbreviations. Do not tidy it.
- Split producer from cuvee only where the convention is clear. Leave fields null when unsure.
- NEVER invent a vintage, region, varietal or price that is not on the page. null is correct.
- Prices: by-the-glass in price_glass, bottle in price_bottle. If there is one price column,
  use the section heading to decide which it is.
- "section" is the menu heading the entry sits under.
- If a line is clearly a drink but genuinely illegible, put the fragment in "unreadable"
  instead of guessing at its contents.
- Numbers must be numbers, not strings. Omit currency symbols.`

const USER = 'Extract every drink entry from this list.'

export async function readMenu(file) {
  const { block, dataUrl } = await toImageBlock(file)

  const raw = await callModel({
    system: SYSTEM,
    model: PARSE_MODEL,
    max_tokens: 8192, // a long wine list is a big payload; truncation is a real failure mode
    messages: [{ role: 'user', content: [block, { type: 'text', text: USER }] }],
  })

  const parsed = extractJSON(raw)
  if (!parsed) {
    throw new Error(
      looksTruncated(raw)
        ? 'That list was too long to read in one go. Photograph it in two halves.'
        : 'Could not read that photo. Fill the frame with the list and keep it flat.',
    )
  }

  const entries = (Array.isArray(parsed.entries) ? parsed.entries : [])
    .map((e) => ({
      raw: String(e?.raw ?? '').trim(),
      kind: ['wine', 'beer', 'whiskey', 'other'].includes(e?.kind) ? e.kind : 'other',
      producer: e?.producer ?? null,
      wine: e?.wine ?? null,
      appellation: e?.appellation ?? null,
      region: e?.region ?? null,
      country: e?.country ?? null,
      varietal: e?.varietal ?? null,
      vintage: num(e?.vintage),
      price_glass: num(e?.price_glass),
      price_bottle: num(e?.price_bottle),
      section: e?.section ?? null,
    }))
    .filter((e) => e.raw)

  return { entries, unreadable: parsed.unreadable || [], thumbnail: dataUrl }
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : null
}
