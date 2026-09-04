/**
 * Corroborate a producer against Wikidata, and link to it.
 *
 * This is the source that finally covers SPIRITS. The app shipped for weeks
 * saying no open distillery database existed; nobody had checked. Wikidata
 * types distilleries, breweries and drinks brands, is free, needs no key, and
 * serves `Access-Control-Allow-Origin: *` to an anonymous request, so the PWA
 * calls it directly -- no proxy, no credential, same as Open Brewery DB.
 *
 * Measured at THRESHOLD on real names against invented ones: 16 of 20 real
 * distilleries, 6 of 8 real breweries, and 0 of 14 invented producers. The
 * misses are small or new craft producers (Uncle Nearest, Westward, St. George
 * Spirits, Clear Creek) plus a couple of European breweries with thin entries.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT SPARQL. The obvious route is query.wikidata.org, and it works: same
 * recall, one request. It also takes about EIGHT SECONDS, which is too slow
 * even for a check that never blocks the screen. CirrusSearch does the type
 * filter server-side via haswbstatement and comes back in about a third of a
 * second, so that is what this uses.
 *
 * TWO THINGS THAT COST REAL RECALL, both fixed here and both easy to reinvent:
 *
 *  - Search on the producer name AS GIVEN. Feeding the generic-stripped,
 *    punctuation-flattened string to a search engine loses Fuller's and
 *    Schneider Weisse. The stripped tokens are for SCORING what comes back --
 *    a different job, done in names.js.
 *  - Score against every label AND alias in every language returned, not the
 *    English label. Schneider Weisse is typed as a brewery but has no English
 *    label, so it came back as a bare Q-id and scored zero against its own
 *    name.
 */
import { score, THRESHOLD } from './names'

const API = 'https://www.wikidata.org/w/api.php'

/**
 * What counts as corroboration.
 *
 * `business` and `enterprise` are deliberately absent. They would confirm any
 * plausible-sounding company name, which is the entire failure this check
 * exists to prevent -- an invented producer handed back wearing a confirmation
 * is worse than no check at all.
 *
 * The brands are included because of what is actually being asked. The question
 * is not "is there a building" but "did the model invent this producer", and
 * Four Roses being a known alcohol brand answers it. No invented name in
 * testing matched a brand either.
 */
const TYPES = {
  Q1251750: 'distillery',
  Q10373548: 'whisky distillery',
  Q131734: 'brewery',
  Q57778855: 'brewery building',
  Q571254: 'microbrewery',
  Q80359036: 'alcohol brand',
  Q15075508: 'beer brand',
}

/** A place beats a brand when both match, so "Cantillon" links the brewery. */
const FACILITY = new Set([
  'Q1251750', 'Q10373548', 'Q131734', 'Q57778855', 'Q571254',
])

const STATEMENT = Object.keys(TYPES).map((q) => `P31=${q}`).join('|')

/* `origin=*` is what makes MediaWiki serve anonymous CORS. No custom headers
 * anywhere in this file: one would turn these into preflighted requests for no
 * gain. */
const get = async (params) => {
  const url = `${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`wikidata ${res.status}`)
  return res.json()
}

const claimIds = (claims, prop) =>
  (claims?.[prop] || [])
    .map((c) => c?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean)

const firstValue = (claims, prop) => {
  for (const c of claims?.[prop] || []) {
    const v = c?.mainsnak?.datavalue?.value
    if (typeof v === 'string') return v
  }
  return null
}

/**
 * @param {string} producer name as the model gave it
 * @returns {Promise<null|{name,qid,url,website,type}>} null = not corroborated,
 *   which does NOT mean the producer is fake. Coverage has real gaps and the
 *   copy on screen has to say so.
 */
export async function confirmOnWikidata(producer) {
  const name = (producer || '').trim()
  if (!name) return null

  try {
    const found = await get({
      action: 'query',
      list: 'search',
      srsearch: `${name} haswbstatement:${STATEMENT}`,
      srlimit: '20',
    })
    const ids = (found?.query?.search || []).map((h) => h.title).filter(Boolean)
    if (!ids.length) return null

    // One batched call for all candidates. Twenty separate lookups would be
    // twenty round trips for a check that is not allowed to be slow.
    const detail = await get({
      action: 'wbgetentities',
      ids: ids.join('|'),
      props: 'claims|labels|aliases|sitelinks',
      languages: 'en|de|fr|it|es|nl|ja|pt|sv|da',
      sitefilter: 'enwiki',
    })
    const entities = detail?.entities || {}

    let best = null
    let bestScore = 0
    let bestIsFacility = false

    for (const qid of ids) {
      const e = entities[qid]
      if (!e) continue

      const names = [
        ...Object.values(e.labels || {}).map((l) => l.value),
        ...Object.values(e.aliases || {}).flat().map((a) => a.value),
      ].filter(Boolean)
      if (!names.length) continue

      const types = claimIds(e.claims, 'P31')
      const isFacility = types.some((t) => FACILITY.has(t))
      const s = Math.max(...names.map((n) => score(name, n)))

      if (s > bestScore || (s === bestScore && s > 0 && isFacility && !bestIsFacility)) {
        const wiki = e.sitelinks?.enwiki?.title
        best = {
          name: e.labels?.en?.value || names[0],
          qid,
          // The Wikipedia article when there is one, because that is the page a
          // person actually wants; the Wikidata item otherwise, which always
          // exists and is still a real record rather than a search result.
          url: wiki
            ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki.replace(/ /g, '_'))}`
            : `https://www.wikidata.org/wiki/${qid}`,
          website: firstValue(e.claims, 'P856'),
          type: TYPES[types.find((t) => TYPES[t])] || null,
        }
        bestScore = s
        bestIsFacility = isFacility
      }
    }

    if (!best || bestScore < THRESHOLD) return null
    return best
  } catch {
    // A third-party outage must never block logging a drink. Uncorroborated is
    // a fine outcome; a broken screen is not.
    return null
  }
}
