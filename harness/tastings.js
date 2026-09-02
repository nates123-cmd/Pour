/**
 * In-memory stand-in for src/lib/tastings.js, aliased in only when
 * VITE_HARNESS=1 (see vite.config.js). Never bundled by a real build.
 *
 * It exists because everything in Sip sits behind an email one-time code, so
 * the saved lists cannot be looked at during development without a code from a
 * live inbox -- and the To try / Tried split is a screen you have to SEE to
 * judge. Same exported surface as the real module, seeded with enough rows to
 * show both lists non-empty and the ranking actually ordering something.
 */
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))

let seq = 0
const id = () => `dev-${++seq}`
const at = (n) => new Date(Date.now() - n * 3600e3).toISOString()

const store = {
  wine: [
    { id: id(), name: 'Produttori del Barbaresco 2019', producer: 'Produttori del Barbaresco', style: 'Nebbiolo', origin: 'Barbaresco, Piedmont, Italy', rating: 4.5, created_at: at(50) },
    { id: id(), name: 'Sassarello 2016', producer: 'Poggio Argentiera', style: 'Sangiovese', origin: 'Maremma, Tuscany, Italy', rating: 5, created_at: at(70) },
    { id: id(), name: 'Chianti Classico 2021', producer: 'Fontodi', style: 'Sangiovese', origin: 'Chianti Classico, Italy', rating: 2.5, created_at: at(90) },
    { id: id(), name: 'Bernard Baudry Chinon "Les Granges" 2022', producer: 'Bernard Baudry', style: 'Cabernet Franc', origin: 'Chinon, Loire, France', rating: null, created_at: at(4) },
    { id: id(), name: 'Tornatore Etna Rosso 2022', producer: 'Tornatore', style: 'Nerello Mascalese', origin: 'Etna, Sicily, Italy', rating: null, created_at: at(2) },
  ],
  beer: [
    { id: id(), name: 'Guinness Draught', producer: 'St. James’s Gate', style: 'Irish dry stout', origin: 'Dublin, Ireland', abv: 4.2, rating: 4, created_at: at(30) },
    { id: id(), name: 'Pliny the Elder', producer: 'Russian River', style: 'Double IPA', origin: 'Santa Rosa, CA', abv: 8, rating: null, created_at: at(3) },
  ],
  spirit: [
    { id: id(), name: 'Lagavulin 16', producer: 'Lagavulin', style: 'Islay single malt', origin: 'Islay, Scotland', abv: 43, rating: 5, created_at: at(120) },
  ],
}

const fill = (r) => ({
  producer: null, style: null, origin: null, abv: null, notes: null,
  axes: null, axes_confidence: null, lookup_basis: null, source: 'lookup',
  tasted_on: r.rating == null ? null : '2026-09-02', user_id: 'dev',
  ...r,
})

Object.keys(store).forEach((k) => { store[k] = store[k].map(fill) })

const find = (rowId) => {
  for (const cat of Object.keys(store)) {
    const hit = store[cat].find((r) => r.id === rowId)
    if (hit) return { cat, hit }
  }
  throw new Error('no such row')
}

export async function listTastings(category) {
  await wait()
  return store[category].slice()
}

export const sourceTag = (viaLabel, confirmed) =>
  `${viaLabel ? 'label' : 'lookup'}${confirmed ? '+obdb' : ''}`

export async function addTasting({ category, rating = null, lookup, query, notes, source }) {
  await wait()
  const row = fill({
    id: id(),
    category,
    name: lookup?.name || query,
    producer: lookup?.producer ?? null,
    style: lookup?.style ?? null,
    origin: lookup?.origin ?? null,
    abv: lookup?.abv ?? null,
    rating,
    notes: notes || null,
    source: source || 'lookup',
    created_at: new Date().toISOString(),
  })
  store[category] = [row, ...store[category]]
  return row
}

export async function rateTasting(rowId, rating) {
  await wait()
  const { hit } = find(rowId)
  hit.rating = rating
  hit.tasted_on = '2026-09-02'
  return { ...hit }
}

export async function unrateTasting(rowId) {
  await wait()
  const { hit } = find(rowId)
  hit.rating = null
  hit.tasted_on = null
  return { ...hit }
}

export async function deleteTasting(rowId) {
  await wait()
  const { cat } = find(rowId)
  store[cat] = store[cat].filter((r) => r.id !== rowId)
}
