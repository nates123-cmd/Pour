/**
 * Look up a drink, rate it 1-5, keep the list. Used by both Beer and Spirits.
 *
 * There is no palate model for these yet, so this screen does not rank anything.
 * It exists to build the data a model needs. The lookup also stores a style-axis
 * estimate on each row (see lib/lookup.js), so the ratings become fittable later
 * instead of being a list of names and numbers.
 */
import { useEffect, useState } from 'react'
import { lookupDrink } from '../lib/lookup'
import { listTastings, addTasting, rateTasting, deleteTasting } from '../lib/tastings'
import { Stars } from '../components/Stars'

const COPY = {
  beer: { title: 'Beer', ph: 'Guinness Draught, Pliny the Elder…' },
  spirit: { title: 'Spirits', ph: 'Lagavulin 16, Rittenhouse Rye…' },
}

export default function Cellar({ category }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [found, setFound] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    listTastings(category)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [category])

  async function onLookup(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q || busy) return
    setBusy(true); setError(null); setFound(null); setNotFound(false)
    try {
      const hit = await lookupDrink(q, category)
      if (hit) setFound(hit)
      else setNotFound(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(rating, lookup) {
    setBusy(true); setError(null)
    try {
      const row = await addTasting({ category, rating, lookup, query: query.trim() })
      setRows((r) => [row, ...r])
      setQuery(''); setFound(null); setNotFound(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function reRate(id, rating) {
    const prev = rows
    setRows((r) => r.map((x) => (x.id === id ? { ...x, rating } : x)))
    try { await rateTasting(id, rating) } catch (e) { setRows(prev); setError(e.message) }
  }

  async function remove(id) {
    const prev = rows
    setRows((r) => r.filter((x) => x.id !== id))
    try { await deleteTasting(id) } catch (e) { setRows(prev); setError(e.message) }
  }

  const c = COPY[category]

  return (
    <div className="wrap">
      <h1>{c.title}</h1>
      <p className="sub">Add what you are drinking and rate it.</p>

      <form className="lookup" onSubmit={onLookup}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={c.ph}
          autoCapitalize="words"
          autoCorrect="off"
          enterKeyHint="search"
        />
        <button type="submit" disabled={busy || !query.trim()}>
          {busy ? '…' : 'Look up'}
        </button>
      </form>

      {error && <div className="err">{error}</div>}

      {found && (
        <div className="pick">
          <div className="lbl">Found</div>
          <div className="name selectable">{found.name}</div>
          {/* Metadata, not a characterizing phrase, so it stays in the text face.
              The italic serif is reserved for tasting notes (see DESIGN.md). */}
          <div className="meta">
            {[found.producer, found.style, found.origin,
              found.abv != null ? `${found.abv}%` : null]
              .filter(Boolean).join(' · ')}
          </div>
          {found.confidence < 0.4 && (
            <div className="meta">Not sure this is the right one. Check the name.</div>
          )}
          <div className="rateline">
            <span className="ratelbl">Rate it</span>
            <Stars value={0} onChange={(n) => save(n, found)} />
          </div>
        </div>
      )}

      {notFound && (
        <div className="pick">
          <div className="lbl">Logging by name</div>
          <div className="name selectable">{query.trim()}</div>
          <div className="meta">Not recognised. You can still log it by name.</div>
          <div className="rateline">
            <span className="ratelbl">Rate it</span>
            <Stars value={0} onChange={(n) => save(n, null)} />
          </div>
        </div>
      )}

      <h2>{loading ? 'Loading' : `Logged (${rows.length})`}</h2>
      {!loading && rows.length === 0 && (
        <div className="held"><span>Nothing yet. Look one up above.</span></div>
      )}
      {rows.map((r) => (
        <div className="row logged" key={r.id}>
          <div className="name selectable">
            {r.name}
            <div className="meta">
              {[r.producer, r.style, r.abv != null ? `${r.abv}%` : null]
                .filter(Boolean).join(' · ') || '—'}
            </div>
            <Stars value={r.rating} size={13} onChange={(n) => reRate(r.id, n)} />
          </div>
          <button className="kill" onClick={() => remove(r.id)} aria-label={`delete ${r.name}`}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
