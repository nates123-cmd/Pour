/**
 * Is this producer real, and where can you read about it?
 *
 * The half of a beer or spirit lookup a model is most likely to invent is the
 * producer: a plausible brewery in a plausible town. This is the only part of a
 * lookup that can be checked against something outside the model, so it is
 * checked against two open sources and neither of them is trusted to say yes on
 * its own -- both are scored here, in names.js, at a threshold measured against
 * invented names.
 *
 * Beer gets both sources. Open Brewery DB knows small American breweries that
 * have no encyclopedia entry, down to the city; Wikidata knows the European and
 * historic ones and carries a link. Spirits get Wikidata, which is new -- until
 * now they got nothing at all, on the incorrect belief that no open distillery
 * database existed.
 *
 * Wine gets nothing, and that is not an oversight: a wine's producer is checked
 * implicitly by the palate model, which has to place the bottle on a style
 * scale to rank it at all.
 */
import { confirmBrewery, breweryPlace } from './brewery'
import { confirmOnWikidata } from './wikidata'

/** Which sources are worth asking, per category. */
const SOURCES = {
  beer: ['obdb', 'wd'],
  spirit: ['wd'],
}

export const checksFor = (category) => SOURCES[category] || []

/**
 * Both sources are asked at once and BOTH answers are kept. Two independent
 * confirmations are better evidence than one, and the tag written to the
 * database records which ones spoke -- that is what would let a future beer fit
 * weight corroborated rows above uncorroborated ones.
 *
 * @param {string} producer name as the model gave it
 * @param {object} opts
 * @param {string} opts.category 'beer' | 'spirit'
 * @param {string|null} opts.origin country hint, breaks ties in Open Brewery DB
 * @returns {Promise<null|{name,place,url,website,type,sources:string[]}>}
 *   null = not corroborated, which does NOT mean the producer is fake.
 */
export async function confirmProducer(producer, { category, origin = null } = {}) {
  const want = checksFor(category)
  if (!producer || !want.length) return null

  const [obdb, wd] = await Promise.all([
    want.includes('obdb') ? confirmBrewery(producer, origin) : null,
    want.includes('wd') ? confirmOnWikidata(producer) : null,
  ])
  if (!obdb && !wd) return null

  const sources = [obdb && 'obdb', wd && 'wd'].filter(Boolean)

  return {
    // Open Brewery DB wins the name and the place when it has them, because
    // "Santa Rosa, United States" is more use standing at a bar than "brewery".
    name: obdb?.name || wd?.name,
    place: obdb ? breweryPlace(obdb) : null,
    type: wd?.type || obdb?.type || null,
    // Only Wikidata carries somewhere to read; Open Brewery DB's website_url is
    // the producer's own marketing site, which corroborates nothing.
    url: wd?.url || null,
    website: wd?.website || obdb?.website_url || null,
    sources,
  }
}

/**
 * How the row records what happened: 'label+obdb+wd', 'lookup+wd', 'lookup'.
 *
 * The database CHECK on `source` is a PATTERN, not a list of literals, since
 * 2026-09-04. The old fixed list is why every tag written between the brewery
 * confirmer shipping and that migration was rejected and silently downgraded to
 * 'lookup' -- the ratings survived, the provenance never did. Adding a third
 * source needs no migration now.
 */
export const sourceTag = (viaLabel, sources = []) =>
  [viaLabel ? 'label' : 'lookup', ...sources].join('+')
