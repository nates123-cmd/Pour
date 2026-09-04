/**
 * Comparing producer names, shared by every corroboration source.
 *
 * It lives on its own because the sources disagree about everything except
 * this: whether the name that came back is the name we asked about. Getting
 * that wrong in one source and right in the other is how a checker starts
 * confirming things it should not.
 */

/**
 * Words that carry no identity. "Brasserie Cantillon" is Cantillon; "Willett
 * Distillery" is Willett. Both halves of the drinks vocabulary are here, and
 * that is deliberate rather than sloppy: the beer words never appear in a
 * distillery name and vice versa, so one list costs nothing and there is only
 * one place to fix.
 */
export const GENERIC = new Set([
  // beer
  'brewing', 'brewery', 'breweries', 'brewers', 'brew', 'beer', 'beers',
  'brasserie', 'brouwerij', 'birrificio', 'cerveceria', 'brauerei',
  'bryggeri', 'brewhouse',
  // spirits
  'distillery', 'distilleries', 'distillers', 'distilling', 'distillerie',
  'destileria', 'destilaria', 'brennerei', 'spirits', 'whisky', 'whiskey',
  'bourbon', 'rye', 'vodka', 'gin', 'rum', 'tequila', 'mezcal', 'cognac',
  'scotch', 'liquor',
  // corporate furniture
  'company', 'co', 'inc', 'llc', 'ltd', 'limited', 'group', 'the', 'and',
  'craft', 'works', 'kg', 'gmbh', 'sa', 'bv', 'nv', 'reserve',
])

export const norm = (s) =>
  (s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')

/**
 * The single-character filter is not cosmetic. "Fuller's" normalises to
 * "fuller s", and treating that stray "s" as a word to be matched made a real
 * brewery score 0.5 against its own Wikidata entry.
 */
export const tokens = (s) =>
  norm(s)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !GENERIC.has(t))

/** Share of the query's distinctive words the candidate accounts for. */
export function score(query, candidate) {
  const a = new Set(tokens(query))
  const b = new Set(tokens(candidate))
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const t of a) if (b.has(t)) hit++
  return hit / a.size
}

/**
 * Below this, say nothing.
 *
 * Measured the same way for both sources: real producers on one side, invented
 * ones on the other. 0.75 confirms 16 of 20 real distilleries and 6 of 8 real
 * breweries on Wikidata, and NONE of 14 invented names on either source. The
 * misses are the price and they are the right side to fail on -- an
 * unconfirmed producer is reported as unconfirmed, never as fake.
 */
export const THRESHOLD = 0.75
