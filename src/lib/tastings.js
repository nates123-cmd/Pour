/**
 * Reads and writes to pour_tastings.
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
    .from('pour_tastings')
    .select(COLS)
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(error.message)
  return data || []
}

export async function addTasting({ category, rating, lookup, query, notes }) {
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
    source: 'lookup',
  }

  const { data, error } = await supabase.from('pour_tastings').insert(row).select(COLS).single()
  if (error) throw new Error(error.message)
  return data
}

export async function rateTasting(id, rating) {
  const { error } = await supabase.from('pour_tastings').update({ rating }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteTasting(id) {
  const { error } = await supabase.from('pour_tastings').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
