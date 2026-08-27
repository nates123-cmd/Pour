import { useRef, useState } from 'react'
import { readMenu } from '../lib/menu'
import { scoreWines } from '../lib/score'
import { rank, priceOf, MODEL_VERSION } from '../lib/palate'

const STAGES = {
  idle: null,
  reading: 'Reading the list…',
  scoring: 'Comparing to your palate…',
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
      <h1>Pour</h1>
      <p className="sub">Photograph a wine list. Get it ranked against your palate.</p>

      <button className="shoot" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? STAGES[stage] : 'Photograph a wine list'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} />

      {error && <div className="err">{error}</div>}
      {thumb && <img className="thumb" src={thumb} alt="the list you photographed" />}

      {result && <Results result={result} skipped={skipped} />}

      <p className="note">
        Ranking only, never a predicted score: {MODEL_VERSION} orders bottles well but predicts
        exact ratings poorly. Built from 23 red wines, so whites, rosé and sparkling are guesses.
        Beer and whiskey are read but not yet ranked.
      </p>
    </div>
  )
}

function Results({ result, skipped }) {
  const { ranked, unsure, unmatched } = result
  if (!ranked.length) {
    return (
      <div className="err">
        Nothing on that list could be scored with confidence. Usually that means the producers
        are not named.
      </div>
    )
  }

  const top = ranked[0]
  return (
    <>
      <div className="pick">
        <div className="lbl">TOP PICK</div>
        <div className="name selectable">{top.entry.raw}</div>
        <div className="why">{top.axes.basis}</div>
      </div>

      <h2>RANKED</h2>
      {ranked.map((r, i) => (
        <div className="row" key={r.entry.raw}>
          <div className="rank">{i + 1}</div>
          <div className="name selectable">
            {r.entry.raw}
            <div className="why2">{r.axes.basis}</div>
          </div>
          {priceOf(r.entry) != null && <div className="price">${priceOf(r.entry)}</div>}
        </div>
      ))}

      {unsure.length > 0 && (
        <>
          <h2>NOT RANKED, TOO LITTLE TO GO ON</h2>
          <div className="held selectable">{unsure.map((r) => r.entry.raw).join(' · ')}</div>
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
