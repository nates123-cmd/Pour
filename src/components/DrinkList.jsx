/**
 * The saved list, in two states: bottles you mean to try, and bottles you have.
 *
 * "To try" is not a separate table or a status column -- it is a row with no
 * rating. Rating one is what moves it across, which means there is exactly one
 * way to be in either list and the two can never disagree.
 *
 * Tried is ordered by rating, best first. That is a ranking of what you have
 * actually drunk, made of your own scores -- not the palate model. The model
 * ranks bottles you have NOT tried; this ranks the ones you have, and the two
 * must not be confused for each other.
 */
import { useState } from 'react'
import { Stars } from './Stars'

const VIEWS = [
  { id: 'totry', label: 'To try' },
  { id: 'tried', label: 'Tried' },
]

const metaLine = (r) =>
  [r.producer, r.style, r.origin, r.abv != null ? `${r.abv}%` : null]
    .filter(Boolean)
    .join(' · ')

export function DrinkList({ rows, loading, onRate, onUnrate, onDelete }) {
  const [view, setView] = useState('totry')

  const totry = rows.filter((r) => r.rating == null)
  /* Best first. `created_at` breaks ties so the order never wobbles between
   * renders, which it would under an unstable sort on equal ratings. */
  const tried = rows
    .filter((r) => r.rating != null)
    .sort((a, b) => Number(b.rating) - Number(a.rating) ||
      String(b.created_at).localeCompare(String(a.created_at)))

  const counts = { totry: totry.length, tried: tried.length }
  const shown = view === 'totry' ? totry : tried

  return (
    <>
      <div className="modes listfilter" role="tablist" aria-label="which list">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={'mode' + (view === v.id ? ' active' : '')}
            onClick={() => setView(v.id)}
          >
            {v.label} ({loading ? '…' : counts[v.id]})
          </button>
        ))}
      </div>

      {loading && <div className="held"><span>Loading…</span></div>}

      {!loading && shown.length === 0 && (
        <div className="held">
          <span>
            {view === 'totry'
              ? 'Nothing waiting. Add one above and leave it unrated.'
              : 'Nothing rated yet. Rate something in To try.'}
          </span>
        </div>
      )}

      {shown.map((r, i) => (
        <div className="row logged" key={r.id}>
          {view === 'tried' && <div className="rank">{i + 1}</div>}
          <div className="name selectable">
            {r.name}
            <div className="meta">{metaLine(r) || '—'}</div>
            <Stars
              value={r.rating ?? 0}
              size={13}
              onChange={(n) => onRate(r.id, n)}
            />
          </div>
          <div className="rowacts">
            {view === 'tried' && (
              <button
                className="kill quiet"
                onClick={() => onUnrate(r.id)}
                aria-label={`move ${r.name} back to to try`}
                title="Back to To try"
              >
                ↩
              </button>
            )}
            <button
              className="kill"
              onClick={() => onDelete(r.id)}
              aria-label={`delete ${r.name}`}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
