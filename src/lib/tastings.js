/**
 * Reads and writes to sip_tastings.
 *
 * RLS is per-category. Beer and spirits are `auth.uid() = user_id`. Wine is
 * shared across the household -- Nate and Amanda keep one wine list with one
 * rating per bottle, either of them can set it, and neither sees the other's
 * whisky. That split lives in the policy, not here (see
 * supabase/migrations/20260902_sip_shared_wine_and_lists.sql), so this file
 * queries all three categories identically and the database decides what comes
 * back.
 *
 * A signed-out client gets an empty list rather than an error. That is the
 * suite's usual failure mode and it looks like data loss, so the caller is told
 * to check the session rather than shown an empty cellar.
 */
import { supabase } from './supabase'

const COLS =
  'id, user_id, category, name, producer, style, origin, abv, rating, notes, axes, axes_confidence, lookup_basis, source, tasted_on, created_at'

const today = () => new Date().toISOString().slice(0, 10)

export async function listTastings(category) {
  const { data: sess } = await supabase.auth.getSession()
  if (!sess?.session) throw new Error('Signed out. Sign in and try again.')

  const { data, error } = await supabase
    .from('sip_tastings')
    .select(COLS)
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(400)

  if (error) throw new Error(error.message)
  return data || []
}

/**
 * `source` records how the row was identified and whether anything corroborated
 * it: 'lookup' (typed), 'label' (photographed), 'menu' (off a scanned list), and
 * a '+obdb' suffix when Open Brewery DB confirmed the brewery. That distinction
 * is what would let a future beer fit weight corroborated rows above
 * uncorroborated ones, which is the same argument that put the axes here in the
 * first place.
 */
export const sourceTag = (viaLabel, confirmed) =>
  `${viaLabel ? 'label' : 'lookup'}${confirmed ? '+obdb' : ''}`

/**
 * One row, rated or not. `rating: null` is the whole of "To try" -- a bottle you
 * have written down and not drunk yet. No status column: the absence of a rating
 * already says it, and a second field that could disagree with the first is a
 * bug waiting to happen.
 *
 * `tasted_on` is set only when a rating is, so a wishlist row does not carry a
 * date it never earned. It is OMITTED rather than sent as null on an unrated
 * row: the column is still NOT NULL in prod until the migration lands, and an
 * explicit null fails there while a missing key falls back to the old
 * CURRENT_DATE default. Once the migration is applied the default is gone and
 * the same omission yields the null this wants. Correct either way.
 */
export async function addTasting({
  category, rating = null, lookup, query, notes, source, extra,
}) {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess?.session?.user?.id
  if (!uid) throw new Error('Signed out. Sign in and try again.')

  const row = {
    user_id: uid,
    category,
    name: lookup?.name || query,
    producer: lookup?.producer ?? null,
    style: lookup?.style ?? null,
    origin: lookup?.origin ?? null,
    abv: lookup?.abv ?? null,
    rating,
    ...(rating == null ? {} : { tasted_on: today() }),
    notes: notes || null,
    axes: lookup?.axes ?? null,
    axes_confidence: lookup?.confidence ?? null,
    lookup_basis: lookup?.basis ?? null,
    source: source || 'lookup',
    ...extra,
  }

  const { data, error } = await supabase.from('sip_tastings').insert(row).select(COLS).single()
  if (!error) return data

  // 'lookup' is the only value proven to insert here. If a CHECK constraint on
  // the column rejects the new tags, losing the tag is acceptable; losing the
  // drink he just rated is not. Retry once with the known-good value.
  //
  // The constraint IS still there as of 2026-09-02 -- it allows lookup/menu/
  // import only -- so every 'label' and '+obdb' tag written so far has come
  // back through this path. The migration widens it; drop this retry once that
  // has actually been applied.
  if (row.source !== 'lookup') {
    const retry = await supabase
      .from('sip_tastings')
      .insert({ ...row, source: 'lookup' })
      .select(COLS)
      .single()
    if (!retry.error) return retry.data
  }

  throw new Error(error.message)
}

/** Rating a row is what moves it out of To try, so it stamps the date too. */
export async function rateTasting(id, rating) {
  const { data, error } = await supabase
    .from('sip_tastings')
    .update({ rating, tasted_on: today() })
    .eq('id', id)
    .select(COLS)
    .single()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Back to To try. Kept separate from delete: a wrong rating is not a wrong
 * bottle.
 *
 * Clearing tasted_on is the right thing and fails while the column is still
 * NOT NULL, so a rejection falls back to clearing the rating alone. That leaves
 * a stale date on a row that is once again untried -- worse than nothing, but
 * only until the migration runs, and much better than the button not working.
 * Delete the fallback then.
 */
export async function unrateTasting(id) {
  const clear = (patch) =>
    supabase.from('sip_tastings').update(patch).eq('id', id).select(COLS).single()

  const { data, error } = await clear({ rating: null, tasted_on: null })
  if (!error) return data

  const retry = await clear({ rating: null })
  if (!retry.error) return retry.data
  throw new Error(error.message)
}

export async function deleteTasting(id) {
  const { error } = await supabase.from('sip_tastings').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
