/**
 * Corroborate a brewery against Open Brewery DB.
 *
 * This does NOT identify anything. The model already does that well. What it
 * could not do until now is be checked, and the half of a beer lookup a model
 * is most likely to invent is the producer: a plausible-sounding brewery in a
 * plausible-sounding town.
 *
 * Open Brewery DB is free, needs no key, and reflects the caller's origin in
 * its CORS headers, so the PWA calls it directly. No proxy, no credential.
 *
 * Breweries only. Spirits are covered by wikidata.js, which also covers beer;
 * both are combined in producer.js. This one is kept for beer because it knows
 * things Wikidata does not -- city and state for small American breweries that
 * have no encyclopedia entry at all.
 *
 * ---------------------------------------------------------------------------
 * THE TRAP: a non-empty response is not a match.
 *
 * The endpoint is a fuzzy search that almost always returns SOMETHING. Asking
 * it for "Brasserie Cantillon" returns Brasserie Chouffe, Brasserie du Moulin
 * and Brasserie de Bastogne, with no Cantillon anywhere -- it matched on the
 * word "Brasserie". Treating a non-empty result as corroboration would take a
 * hallucinated brewery and hand it back wearing a confirmation, which is worse
 * than not checking at all.
 *
 * So: strip the generic words, search on what is left, and score the results
 * ourselves. Measured over 17 real breweries and 6 invented ones, 0.75 confirms
 * 13 of the real and NONE of the invented. The four real misses (Cloudwater,
 * Birrificio Italiano, Fuller's, Schneider Weisse) are the price, and they are
 * the right side to fail on: an unconfirmed brewery is reported as unconfirmed,
 * never as wrong.
 */

import { norm, tokens, score, THRESHOLD } from './names'

const API = 'https://api.openbrewerydb.org/v1/breweries/search'

/**
 * "planning" breweries are filings, not breweries: paperwork for something that
 * may never pour. They carry ordinary-sounding names, so they are precisely the
 * rows that turn an invented producer into a confirmed one. A made-up
 * "Saltmarsh Brewing" matched a planning row in Foxboro during testing.
 *
 * "closed" stays eligible. A beer from a brewery that has since shut is a real
 * beer, and refusing to corroborate it would be wrong.
 */
const NOT_A_BREWERY = new Set(['planning'])

/**
 * @param {string} producer  brewery name as the model gave it
 * @param {string|null} origin  the model's guess at country, used only to break
 *   ties between equally-scoring hits. "Guinness" matches both a Baltimore
 *   brewpub and Dublin; the hint picks Dublin instead of the first row.
 * @returns {Promise<null|{name,city,country,state,type}>} null = not confirmed,
 *   which explicitly does NOT mean the brewery is fake. Coverage has real gaps.
 */
export async function confirmBrewery(producer, origin = null) {
  const q = tokens(producer).join(' ') || norm(producer).trim()
  if (!q) return null

  let rows
  try {
    const res = await fetch(`${API}?query=${encodeURIComponent(q)}&per_page=8`)
    if (!res.ok) return null
    rows = await res.json()
  } catch {
    // A third-party outage must never block logging a drink. Uncorroborated is
    // a fine outcome; a broken screen is not.
    return null
  }
  if (!Array.isArray(rows) || !rows.length) return null

  const wants = (origin || '').toLowerCase()
  let best = null
  let bestScore = 0

  for (const row of rows) {
    if (NOT_A_BREWERY.has(row?.brewery_type)) continue
    const s = score(producer, row?.name || '')
    if (s > bestScore) {
      best = row
      bestScore = s
    } else if (s === bestScore && s > 0 && wants && best) {
      const rowMatches = (row?.country || '').toLowerCase().includes(wants)
      const bestMatches = (best?.country || '').toLowerCase().includes(wants)
      if (rowMatches && !bestMatches) best = row
    }
  }

  if (bestScore < THRESHOLD || !best) return null

  return {
    name: best.name,
    city: best.city || null,
    state: best.state_province || null,
    country: best.country || null,
    type: best.brewery_type || null,
  }
}

/** "Brooklyn, United States" — what to print next to the confirmation. */
export const breweryPlace = (b) =>
  [b?.city, b?.country].filter(Boolean).join(', ') || null
