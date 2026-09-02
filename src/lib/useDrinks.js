/**
 * One saved list per category, with its writes. Wine, Beer and Spirits all use
 * it -- the only difference between them is what the database lets you see,
 * which is a policy decision and not this file's business.
 *
 * Writes are optimistic on delete only. Adds and ratings wait for the row the
 * server actually stored, because both can be rewritten on the way in: `source`
 * falls back when a CHECK rejects the tag, and rating stamps `tasted_on`.
 * Showing a guess and then correcting it is worse than a beat of latency.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  listTastings, addTasting, rateTasting, unrateTasting, deleteTasting,
} from './tastings'

export function useDrinks(category) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    listTastings(category)
      .then((data) => { if (live) { setRows(data); setError(null) } })
      .catch((e) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [category])

  const add = useCallback(async (payload) => {
    const saved = await addTasting({ category, ...payload })
    setRows((r) => [saved, ...r.filter((x) => x.id !== saved.id)])
    return saved
  }, [category])

  const replace = (saved) =>
    setRows((r) => r.map((x) => (x.id === saved.id ? saved : x)))

  const rate = useCallback(async (id, rating) => {
    try { replace(await rateTasting(id, rating)) } catch (e) { setError(e.message) }
  }, [])

  const unrate = useCallback(async (id) => {
    try { replace(await unrateTasting(id)) } catch (e) { setError(e.message) }
  }, [])

  const remove = useCallback(async (id) => {
    let prev
    setRows((r) => { prev = r; return r.filter((x) => x.id !== id) })
    try {
      await deleteTasting(id)
    } catch (e) {
      setRows(prev)
      setError(e.message)
    }
  }, [])

  return { rows, loading, error, setError, add, rate, unrate, remove }
}
