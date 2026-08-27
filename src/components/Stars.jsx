export function Stars({ value, onChange, size = 26 }) {
  return (
    <div className="stars" role="radiogroup" aria-label="rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = Number(value) >= n
        return (
          <button
            key={n}
            className={'star' + (on ? ' on' : '')}
            style={{ fontSize: size }}
            aria-label={`${n} out of 5`}
            aria-checked={Number(value) === n}
            role="radio"
            onClick={() => onChange?.(n)}
          >
            {on ? '★' : '☆'}
          </button>
        )
      })}
    </div>
  )
}
