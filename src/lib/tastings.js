/**
 * Reads and writes to sip_tastings.
 *
 * RLS is `auth.uid() = user_id` on all four verbs, and user_id defaults to
 * auth.uid(), so a signed-out client gets an empty list rather than an error.
 * That is the suite's usual failure mode and it looks like data loss, so the
 * caller is told to check the session rather than shown an empty cellar.
 */
import { supabase } from './supabase'

const COLS =
  'id, category, name, producer, style, origin, abv, rating, notes, axes, axes_confidence, lookup_basis, source, tasted_on, created_at'

export async function listTastings(category) {
  const { data: sess } = await supabase.auth.getSession()
  if (!sess?.session) throw new Error('Signed out. Sign in and try again.')

  const { data, error } = await supabase
    .from('sip_tastings')
    .select(COLS)
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(error.message)
  return data || []
}

/**
 * `source` records how the row was identified and whether anything corroborated
 * it: 'lookup' (typed), 'label' (photographed), and a '+obdb' suffix when Open
 * Brewery DB confirmed the brewery. That distinction is what would let a future
 * beer fit weight corroborated rows above uncorroborated ones, which is the
 * same argument that put the axes here in the first place.
 *
 * It is stored in the existing free-text column rather than a new one: this repo
 * is not linked to the shared suite project, so the column's constraints could
 * not be checked from here, and adding a column to a shared ledger unseen is the
 * worse risk. See the retry in addTasting for how that uncertainty is handled.
 */
export const sourceTag = (viaLabel, confirmed) =>
  `${viaLabel ? 'label' : 'lookup'}${confirmed ? '+obdb' : ''}`

export async function addTasting({ category, rating, lookup, query, notes, source }) {
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
    notes: notes || null,
    axes: lookup?.axes ?? null,
    axes_confidence: lookup?.confidence ?? null,
    lookup_basis: lookup?.basis ?? null,
    source: source || 'lookup',
  }

  const { data, error } = await supabase.from('sip_tastings').insert(row).select(COLS).single()
  if (!error) return data

  // 'lookup' is the only value proven to insert here. If a CHECK constraint on
  // the column rejects the new tags, losing the tag is acceptable; losing the
  // drink he just rated is not. Retry once with the known-good value.
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

export async function rateTasting(id, rating) {
  const { error } = await supabase.from('sip_tastings').update({ rating }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteTasting(id) {
  const { error } = await supabase.from('sip_tastings').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
