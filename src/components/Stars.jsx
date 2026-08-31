/**
 * SVG stars rather than the U+2605 / U+2606 character pair. Those two glyphs are
 * drawn by different fonts on different platforms and the hollow one reads
 * noticeably lighter than the filled one, so a half-set rating looked uneven.
 * One path, filled or stroked, keeps both states the same shape and weight.
 */
const PATH =
  'M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.1-6.46-4.69-4.58 6.49-.95z'

function Glyph({ on, size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={PATH}
        fill={on ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={on ? 0 : 1.5}
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Stars({ value, onChange, size = 24 }) {
  return (
    <div className="stars" role="radiogroup" aria-label="rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = Number(value) >= n
        return (
          <button
            key={n}
            className={'star' + (on ? ' on' : '')}
            aria-label={`${n} out of 5`}
            aria-checked={Number(value) === n}
            role="radio"
            onClick={() => onChange?.(n)}
          >
            <Glyph on={on} size={size} />
          </button>
        )
      })}
    </div>
  )
}
