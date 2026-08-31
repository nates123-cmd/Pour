/**
 * Circles, not stars. Two reasons, in order: the reference design scores
 * everything with rows of filled circles (see DESIGN.md), and the star
 * characters this replaces were drawn by whichever font the platform picked,
 * so the hollow glyph rendered visibly lighter than the filled one and a
 * three-of-five rating looked lopsided.
 */
export function Stars({ value, onChange, size = 17 }) {
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
            <i style={{ width: size, height: size }} />
          </button>
        )
      })}
    </div>
  )
}
