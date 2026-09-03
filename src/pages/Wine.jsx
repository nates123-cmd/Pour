import { useRef, useState } from 'react'
import { readMenu } from '../lib/menu'
import { readBottleLabel, searchWine } from '../lib/bottle'
import { scoreWines } from '../lib/score'
import { rank, placeInCellar, palateMatch, priceOf, CONFIDENCE_FLOOR, MODEL_VERSION } from '../lib/palate'
import { useDrinks } from '../lib/useDrinks'
import { DrinkList } from '../components/DrinkList'
import { Stars } from '../components/Stars'

/* Three ways in, one scorer behind all of them. A list gets ranked against
 * itself; a single bottle has no list, so it gets placed against the 23 bottles
 * the model was fitted on (see placeInCellar). */
const MODES = [
  { id: 'list', label: 'Wine list' },
  { id: 'bottle', label: 'Bottle' },
  { id: 'search', label: 'By name' },
]

const STAGES = {
  idle: null,
  reading: 'Reading the list…',
  label: 'Reading the label…',
  finding: 'Finding that bottle…',
  scoring: 'Comparing to your palate…',
}

const SHOOT = { list: 'Photograph a wine list', bottle: 'Photograph the bottle' }

/**
 * Position on the palate scale, from `rel` — distance from a baseline average.
 * For a list that baseline is the list; for one bottle it is your own cellar.
 * `rel` is a RELATIVE quantity and the circle is the only place it appears; the
 * absolute number beside it is `palateMatch`, measured against the cellar and
 * therefore comparable between lists. Neither is `fitIndex`, which looks like a
 * star rating and must never reach the screen.
 * See DESIGN.md for what the colours mean.
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

/** The same claim for one bottle: a rank among bottles you have actually rated. */
function standing({ ahead, of }) {
  if (ahead === 0) return `Behind all ${of} you have rated`
  if (ahead === of) return `Ahead of all ${of} you have rated`
  return `Ahead of ${ahead} of the ${of} you have rated`
}

/**
 * The score, and the reason it is allowed to exist.
 *
 * palate-v1 cannot predict a rating, so this is not one. It is a percentile
 * against the spread of the 23 bottles he has actually rated, built out of
 * ordering, which is the thing the model does well. Not on the 1-5 scale, and
 * not in the same type as the rating circles. See DESIGN.md.
 *
 * The sub-line says where the scale comes from rather than repeating a count.
 * The literal count is a DIFFERENT claim and lives in the badge above -- two
 * numbers that mean two things, each said once.
 */
function Score({ axes }) {
  return (
    <div className="score">
      <b>{palateMatch(axes).score}</b>
      <span>
        Palate match
        <i>Against the 23 bottles you have rated</i>
      </span>
    </div>
  )
}

/**
 * A scanned or searched wine, flattened into a sip_tastings row.
 *
 * `raw` is the name deliberately: it is the line as printed on the list, which
 * is what he will recognise later. The axes ride along because they are what
 * makes this list refittable into a better palate model than the 23 bottles
 * scraped off wine.com -- a name and a rating alone would not be.
 */
function wineRow(e, axes) {
  return {
    name: e.raw,
    producer: e.producer ?? null,
    style: e.varietal ?? null,
    origin: [e.appellation, e.region, e.country].filter(Boolean).join(', ') || null,
    axes,
    confidence: axes?.confidence ?? null,
    basis: axes?.basis ?? null,
  }
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
  const [mode, setMode] = useState('list')
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('idle')
  const [error, setError] = useState(null)
  const [thumb, setThumb] = useState(null)
  const [result, setResult] = useState(null)
  const [bottle, setBottle] = useState(null)
  const [skipped, setSkipped] = useState(null)
  const list = useDrinks('wine')

  const busy = stage !== 'idle'

  /* Saved names, so a bottle already on the list offers no second save. Keyed on
   * the printed line, which is the only stable identifier a menu entry has. */
  const saved = new Set(list.rows.map((r) => r.name))

  const keep = (entry, axes, source) => (rating) =>
    list.add({ rating, lookup: wineRow(entry, axes), source }).catch((e) => setError(e.message))

  function clear() {
    setError(null); setResult(null); setBottle(null); setSkipped(null); setThumb(null)
  }

  function pickMode(id) {
    if (busy || id === mode) return
    setMode(id); setQuery(''); clear()
  }

  /* Both single-bottle paths converge here: identify first, then hand the wine
   * to the SAME anchored scorer the list uses. A second scoring prompt would be
   * a second scale, and the coefficients only mean anything on the anchors'. */
  async function place(found) {
    if (!found) {
      throw new Error(
        mode === 'bottle'
          ? 'No wine bottle in that photo. Fill the frame with the front label.'
          : 'No wine found by that name. Try adding the producer.',
      )
    }

    setStage('scoring')
    const [axes] = await scoreWines([found])
    if (!axes) throw new Error('Could not read that bottle’s style. Try again.')

    // Identification and style estimation are two chances to be wrong, so the
    // placement is only as trustworthy as the weaker of them.
    const confidence = Math.min(found.confidence, axes.confidence)
    setBottle({ found, axes, confidence, place: placeInCellar(axes) })
  }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    clear()
    try {
      if (mode === 'bottle') {
        setStage('label')
        const { bottle: found, thumbnail } = await readBottleLabel(file)
        setThumb(thumbnail)
        await place(found)
        return
      }

      setStage('reading')
      const { entries, unreadable, thumbnail } = await readMenu(file)
      setThumb(thumbnail)

      const wines = entries.filter((x) => x.kind === 'wine')
      const others = entries.filter((x) => x.kind !== 'wine')
      if (!wines.length) throw new Error('No wines found on that list.')

      setStage('scoring')
      const scores = await scoreWines(wines)
      setResult(rank(wines, scores))
      setSkipped({ others: others.length, unreadable: unreadable.length })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setStage('idle')
    }
  }

  async function onSearch(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q || busy) return

    clear()
    try {
      setStage('finding')
      await place(await searchWine(q))
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setStage('idle')
    }
  }

  return (
    <div className="wrap">
      <h1>Sip</h1>
      <p className="sub">
        Photograph a wine list or a bottle, or type a name. Ranked against your palate.
      </p>

      <Scale />

      <div className="modes" role="tablist" aria-label="what to look up">
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

      {mode === 'search' ? (
        <form className="lookup" onSubmit={onSearch}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tornatore Etna Rosso 2022…"
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
          {busy ? STAGES[stage] : SHOOT[mode]}
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} />

      {busy && mode === 'search' && <p className="meta">{STAGES[stage]}</p>}
      {error && <div className="err">{error}</div>}
      {thumb && <img className="thumb" src={thumb} alt="what you photographed" />}

      {result && <Results result={result} skipped={skipped} keep={keep} saved={saved} />}
      {bottle && (
        <Bottle {...bottle} keep={keep(bottle.found, bottle.axes, mode === 'bottle' ? 'label' : 'lookup')} saved={saved.has(bottle.found.raw)} />
      )}

      <h2>Your wines</h2>
      <p className="meta">Shared with the household. Beer and spirits are not.</p>
      {list.error && <div className="err">{list.error}</div>}
      <DrinkList
        rows={list.rows}
        loading={list.loading}
        onRate={list.rate}
        onUnrate={list.unrate}
        onDelete={list.remove}
      />

      <p className="note">
        The score is a palate match, never a predicted rating: 0 to 100 against the
        spread of the 23 bottles you have rated. {MODEL_VERSION} orders bottles well
        and predicts exact ratings badly, so the number is built out of the ordering.
        All 23 are red, so whites, rosé and sparkling are guesses. Beer and whiskey
        are read but not yet ranked.
      </p>
    </div>
  )
}

/**
 * Save it. Rating it puts it straight in Tried; the plain save puts it in To
 * try. Both are the same row one field apart, so nothing can end up in neither
 * list or in both.
 */
function Keep({ keep, saved }) {
  if (saved) return <div className="meta kept">Already on your list.</div>
  return (
    <div className="keepbox">
      <div className="rateline">
        <span className="ratelbl">Had it</span>
        <Stars value={0} size={15} onChange={(n) => keep(n)} />
      </div>
      <button className="tryline" onClick={() => keep(null)}>or save it to try</button>
    </div>
  )
}

/* ---- one bottle ----------------------------------------------------------- */

const COLOR_CAVEAT = {
  white: 'white',
  rose: 'rosé',
  sparkling: 'sparkling',
  fortified: 'fortified',
}

function Bottle({ found, axes, confidence, place, keep, saved }) {
  const meta = [found.producer, found.appellation || found.region, found.country,
    found.varietal, found.vintage].filter(Boolean).join(' · ')

  // Below the floor the placement would be built on a guessed bottle, a guessed
  // style, or both. Name it and stop, rather than colouring a circle anyway.
  if (confidence < CONFIDENCE_FLOOR) {
    return (
      <div className="pick">
        <div className="lbl">Too little to go on</div>
        <div className="body">
          <div>
            <div className="name selectable">{found.raw}</div>
            {meta && <div className="meta selectable">{meta}</div>}
            <div className="meta">
              Not confident enough about which bottle this is to place it. Add the
              producer, or photograph the front label straight on.
            </div>
          </div>
        </div>
      </div>
    )
  }

  const caveat = COLOR_CAVEAT[found.color]

  return (
    <>
      <div className="pick">
        <div className="lbl">This bottle</div>
        <div className="body">
          <div className={'dot bigdot ' + step(place.rel)} />
          <div>
            <div className="name selectable">{found.raw}</div>
            <div className="why selectable">{axes.basis}</div>
            {meta && <div className="meta selectable">{meta}</div>}
            <div className="badge">{standing(place)}</div>
            <Score axes={axes} />
          </div>
        </div>
        <Keep keep={keep} saved={saved} />
      </div>

      {caveat && (
        <p className="note">
          This is a {caveat} wine and palate-v1 was fitted on 23 reds, so its placement
          is an extrapolation rather than a reading.
        </p>
      )}

      {/* The three axes the ranking actually runs on, shown because on a single
          bottle there is room and because it is the only way to see WHY it
          placed where it did. Style, never quality: a 9 is not a good score. */}
      <h2>Style, 1 to 10</h2>
      <div className="axes">
        <div><span>Tannin</span><b>{axes.tannin}</b></div>
        <div><span>Savoury</span><b>{axes.savory}</b></div>
        <div><span>Aromatic lift</span><b>{axes.aromaticLift}</b></div>
        {axes.dryness != null && (
          <div><span>Dryness</span><b>{axes.dryness}</b></div>
        )}
      </div>
      {axes.dryness != null && (
        <p className="note">
          Dryness is perceived dryness, not residual sugar: ripe fruit and new oak read
          as sweetness in a wine that has none. It is described here, not ranked on. The
          three axes above it are the ones palate-v1 was fitted on; dryness is the only
          one with no anchor among your own 23 bottles.
        </p>
      )}

      {/* Names only, no ratings: the nearest bottle's real score printed beside a
          new bottle would read as a prediction for the new bottle. */}
      <h2>Closest in your cellar</h2>
      <div className="held selectable">
        {place.near.map((n) => <span key={n}>{n}</span>)}
      </div>
    </>
  )
}

/* ---- a whole list --------------------------------------------------------- */

function Results({ result, skipped, keep, saved }) {
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
            <Score axes={top.axes} />
          </div>
        </div>
        <Keep keep={keep(top.entry, top.axes, 'menu')} saved={saved.has(top.entry.raw)} />
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
            {/* The dot already says where this sits on THIS list. The number says
                where it sits against the cellar, which is the same on every list
                and therefore the one worth carrying between them. */}
            <div className="why2">
              <b className="rowscore">{palateMatch(r.axes).score}</b>
              {r.axes.basis}
            </div>
          </div>
          {priceOf(r.entry) != null && <div className="price">${priceOf(r.entry)}</div>}
          <button
            className="keep"
            disabled={saved.has(r.entry.raw)}
            onClick={() => keep(r.entry, r.axes, 'menu')(null)}
            aria-label={`save ${r.entry.raw} to try`}
          >
            {saved.has(r.entry.raw) ? 'saved' : '+'}
          </button>
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
