import { useRef, useState } from 'react'
import { readMenu } from '../lib/menu'
import { scoreWines } from '../lib/score'
import { rank, priceOf, MODEL_VERSION } from '../lib/palate'

const STAGES = {
  idle: null,
  reading: 'Reading the list…',
  scoring: 'Comparing to your palate…',
}

/**
 * Position on the palate scale, from `rel` — the wine's distance from this
 * list's own average. `rel` is the only fit number the model is honest enough
 * to surface; `fitIndex` looks like a star rating and must never reach the
 * screen. See DESIGN.md for what the colours mean.
 */
function step(rel) {
  const r = Number(rel) || 0
  if (r >= 0.55) return 's1'
  if (r >= 0.2) return 's2'
  if (r >= -0.05) return 's3'
  if (r >= -0.3) return 's4'
  if (r >= -0.6) return 's5'
  return 's6'
}

/**
 * How decisively the top pick won, read off the gap to second place. Says
 * something true about the ordering without ever putting a number on screen
 * that could be mistaken for a rating.
 */
function lead(ranked) {
  if (ranked.length < 2) return 'Only one bottle scored'
  const gap = ranked[0].rel - ranked[1].rel
  if (gap >= 0.35) return 'Clear of the field'
  if (gap >= 0.12) return 'Ahead of the rest'
  return 'Narrowly ahead'
}

/* The cover's grape cluster, laid out as the axis it actually is: it teaches
 * the row colours before the reader meets them. */
function Scale() {
  return (
    <div className="scale" aria-hidden="true">
      <div className="circles">
        {['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => (
          <i className={'dot ' + s} key={s} />
        ))}
      </div>
      <div className="ends"><span>Fresh, savoury</span><span>Ripe, oaky</span></div>
    </div>
  )
}

export default function Wine() {
  const fileRef = useRef(null)
  const [stage, setStage] = useState('idle')
  const [error, setError] = useState(null)
  const [thumb, setThumb] = useState(null)
  const [result, setResult] = useState(null)
  const [skipped, setSkipped] = useState(null)

  const busy = stage !== 'idle'

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError(null); setResult(null); setSkipped(null); setThumb(null)
    try {
      setStage('reading')
      const { entries, unreadable, thumbnail } = await readMenu(file)
      setThumb(thumbnail)

      const wines = entries.filter((x) => x.kind === 'wine')
      const others = entries.filter((x) => x.kind !== 'wine')
      if (!wines.length) throw new Error('No wines found on that list.')

      setStage('scoring')
      const scores = await scoreWines(wines)
      const ranked = rank(wines, scores)

      setResult(ranked)
      setSkipped({ others: others.length, unreadable: unreadable.length })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setStage('idle')
    }
  }

  return (
    <div className="wrap">
      <h1>Sip</h1>
      <p className="sub">Photograph a wine list. Get it ranked against your palate.</p>

      <Scale />

      <button className="shoot" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? STAGES[stage] : 'Photograph a wine list'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} />

      {error && <div className="err">{error}</div>}
      {thumb && <img className="thumb" src={thumb} alt="the list you photographed" />}

      {result && <Results result={result} skipped={skipped} />}

      <p className="note">
        Ranking only, never a predicted score: {MODEL_VERSION} orders bottles well but
        predicts exact ratings poorly. Built from 23 red wines, so whites, rosé and
        sparkling are guesses. Beer and whiskey are read but not yet ranked.
      </p>
    </div>
  )
}

function Results({ result, skipped }) {
  const { ranked, unsure, unmatched } = result
  if (!ranked.length) {
    return (
      <div className="err">
        Nothing on that list could be scored with confidence. Usually that means the
        producers are not named.
      </div>
    )
  }

  const top = ranked[0]
  return (
    <>
      <div className="pick">
        {/* Sentence case in the markup, uppercased in CSS: a screen reader
            spells an all-caps string out letter by letter. */}
        <div className="lbl">Top pick</div>
        <div className="body">
          <div className={'dot bigdot ' + step(top.rel)} />
          <div>
            <div className="name selectable">{top.entry.raw}</div>
            <div className="why selectable">{top.axes.basis}</div>
            <div className="badge">{lead(ranked)}</div>
          </div>
        </div>
      </div>

      <h2>Ranked</h2>
      {ranked.map((r, i) => (
        <div className="row" key={r.entry.raw}>
          <div className="rank">{i + 1}</div>
          {/* Colour carries the fit, so it needs a text equivalent too. */}
          <div
            className={'dot ' + step(r.rel)}
            role="img"
            aria-label={r.rel >= 0 ? 'above this list’s average' : 'below this list’s average'}
          />
          <div className="name selectable">
            {r.entry.raw}
            <div className="why2">{r.axes.basis}</div>
          </div>
          {priceOf(r.entry) != null && <div className="price">${priceOf(r.entry)}</div>}
        </div>
      ))}

      {unsure.length > 0 && (
        <>
          <h2>Too little to go on</h2>
          <div className="held selectable">
            {unsure.map((r) => <span key={r.entry.raw}>{r.entry.raw}</span>)}
          </div>
        </>
      )}

      {(unmatched.length > 0 || skipped?.others > 0 || skipped?.unreadable > 0) && (
        <p className="note">
          {unmatched.length > 0 && `${unmatched.length} entries the scorer did not return. `}
          {skipped?.others > 0 && `${skipped.others} non-wine entries skipped. `}
          {skipped?.unreadable > 0 && `${skipped.unreadable} lines were illegible.`}
        </p>
      )}
    </>
  )
}
