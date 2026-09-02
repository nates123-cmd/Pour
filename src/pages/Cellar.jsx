/**
 * Look up a drink, rate it 1-5, keep the list. Used by both Beer and Spirits.
 *
 * There is no palate model for these yet, so this screen does not rank anything.
 * It exists to build the data a model needs. The lookup also stores a style-axis
 * estimate on each row (see lib/lookup.js), so the ratings become fittable later
 * instead of being a list of names and numbers.
 *
 * Two ways in, the same mode strip the Wine tab uses: type a name, or photograph
 * the label. The photo is the better one when the can is in your hand, because
 * the model is reading rather than recalling.
 *
 * Beer gets one more thing: the brewery is checked against Open Brewery DB. That
 * is the only free corroboration available for any of this. Spirits get none --
 * there is no open distillery database worth the wiring -- and this screen must
 * not imply otherwise.
 */
import { useRef, useState } from 'react'
import { lookupDrink, readDrinkLabel } from '../lib/lookup'
import { confirmBrewery, breweryPlace } from '../lib/brewery'
import { sourceTag } from '../lib/tastings'
import { useDrinks } from '../lib/useDrinks'
import { DrinkList } from '../components/DrinkList'
import { Stars } from '../components/Stars'

const COPY = {
  beer: { title: 'Beer', ph: 'Guinness Draught, Pliny the Elder…', shoot: 'Photograph the can' },
  spirit: { title: 'Spirits', ph: 'Lagavulin 16, Rittenhouse Rye…', shoot: 'Photograph the bottle' },
}

const MODES = [
  { id: 'name', label: 'By name' },
  { id: 'label', label: 'Label' },
]

export default function Cellar({ category }) {
  const fileRef = useRef(null)
  const [mode, setMode] = useState('name')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(null)
  const [error, setError] = useState(null)
  const [found, setFound] = useState(null)
  const [brewery, setBrewery] = useState(null)
  const [checked, setChecked] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const list = useDrinks(category)

  function clear() {
    setError(null); setFound(null); setNotFound(false)
    setBrewery(null); setChecked(false)
  }

  function pickMode(id) {
    if (busy || id === mode) return
    setMode(id); setQuery(''); clear()
  }

  /**
   * Both paths land here. The brewery check is deliberately AFTER the drink is
   * on screen and never blocks it: Open Brewery DB is a third party, and an
   * outage there must cost a footnote, not the lookup.
   */
  async function settle(hit) {
    if (!hit) { setNotFound(true); return }
    setFound(hit)

    if (category !== 'beer' || !hit.producer) return
    setStage('Checking the brewery…')
    const match = await confirmBrewery(hit.producer, hit.origin)
    setBrewery(match)
    setChecked(true)
  }

  async function onLookup(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q || busy) return
    setBusy(true); clear()
    try {
      setStage('Finding it…')
      await settle(await lookupDrink(q, category))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false); setStage(null)
    }
  }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || busy) return
    setBusy(true); clear()
    try {
      setStage('Reading the label…')
      const { drink } = await readDrinkLabel(file, category)
      await settle(drink)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false); setStage(null)
    }
  }

  /* `rating` null saves it to To try. Same row, same write, one field apart --
   * there is no second "wishlist" path that could drift from this one. */
  async function save(rating, lookup) {
    setBusy(true); setError(null)
    try {
      await list.add({
        rating,
        lookup,
        query: query.trim(),
        source: sourceTag(mode === 'label', !!brewery),
      })
      setQuery(''); clear()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const c = COPY[category]

  return (
    <div className="wrap">
      <h1>{c.title}</h1>
      <p className="sub">Add what you are drinking and rate it.</p>

      <div className="modes" role="tablist" aria-label="how to add it">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={'mode' + (mode === m.id ? ' active' : '')}
            onClick={() => pickMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'name' ? (
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
      ) : (
        <button className="shoot" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? stage : c.shoot}
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} />

      {busy && mode === 'name' && stage && <p className="meta">{stage}</p>}
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
          <Corroboration checked={checked} brewery={brewery} />
          <div className="rateline">
            <span className="ratelbl">Rate it</span>
            <Stars value={0} onChange={(n) => save(n, found)} />
          </div>
          <button className="tryline" disabled={busy} onClick={() => save(null, found)}>
            or save it to try
          </button>
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
          <button className="tryline" disabled={busy} onClick={() => save(null, null)}>
            or save it to try
          </button>
        </div>
      )}

      <h2>Your {category === 'beer' ? 'beer' : 'spirits'}</h2>
      {list.error && <div className="err">{list.error}</div>}
      <DrinkList
        rows={list.rows}
        loading={list.loading}
        onRate={list.rate}
        onUnrate={list.unrate}
        onDelete={list.remove}
      />
    </div>
  )
}

/**
 * What the brewery check found.
 *
 * Both outcomes are shown. Printing nothing when unconfirmed would leave "we
 * checked and it is real" indistinguishable from "we never looked", which is
 * the whole value of checking.
 *
 * The unconfirmed wording matters and is not hedging for its own sake: over 17
 * real breweries, four genuinely present in the world did not match. So a miss
 * is worth a glance and is never evidence the beer is fake.
 */
function Corroboration({ checked, brewery }) {
  if (!checked) return null

  if (brewery) {
    const place = breweryPlace(brewery)
    return (
      <div className="conf">
        <span>Brewery confirmed</span>
        {brewery.name}{place ? `, ${place}` : ''}
      </div>
    )
  }

  return (
    <p className="note">
      No brewery by that name in Open Brewery DB. Its coverage has real gaps, so this
      is not evidence the beer is wrong, but it is worth a glance at the name.
    </p>
  )
}
