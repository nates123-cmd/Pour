/**
 * Wine sits in the middle because it is the main tab and the middle is where the
 * thumb lands. Follows the suite's bottom-nav shape: fixed, safe-area padded,
 * blurred. No page wrapper creates a stacking context above it, which is the trap
 * that buried Cue's overlays under its own nav.
 */
const TABS = [
  { id: 'beer', label: 'Beer' },
  { id: 'wine', label: 'Wine' },
  { id: 'spirit', label: 'Spirits' },
]

const Glyph = ({ id }) => {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (id === 'beer') {
    return (<svg {...p}><path d="M6 8h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M15 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
      <path d="M6 8c0-2 1.5-3 3-3s1.5-1.5 3-1.5S15 6 15 8" /></svg>)
  }
  if (id === 'wine') {
    return (<svg {...p}><path d="M8 3h8l-.6 6a3.4 3.4 0 0 1-3.4 3 3.4 3.4 0 0 1-3.4-3z" />
      <path d="M12 12v6" /><path d="M9 21h6" /></svg>)
  }
  return (<svg {...p}><path d="M5 3h14l-6 8v7" /><path d="M9 21h6" /><path d="M7.5 7h9" /></svg>)
}

export function BottomNav({ tab, onChange }) {
  return (
    <nav className="bottomnav">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={'navbtn' + (tab === t.id ? ' active' : '')}
          onClick={() => onChange(t.id)}
          aria-current={tab === t.id ? 'page' : undefined}
        >
          <Glyph id={t.id} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
