// Плитка: ch — буква, state — 'correct' | 'present' | 'absent' | null,
// reveal — анимация переворота с задержкой по позиции (--i)
export function Tile({ ch, state, i = 0, active = false, cursor = false }) {
  const cls = [
    'tile',
    state ? `s-${state}` : '',
    ch ? 'filled' : '',
    cursor ? 'cursor' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={{ '--i': i }}>
      {ch || ''}
    </div>
  );
}

// Готовый ряд из словаря — при появлении на экране переворачивается
export function GuessRow({ row, shake = false }) {
  const letters = [...row.w];
  return (
    <div className={`row ${shake ? 'shake' : ''}`}>
      {letters.map((ch, i) => (
        <div
          key={i}
          className={`tile reveal s-${row.marks[i]}`}
          style={{ '--i': i }}
        >
          {ch}
        </div>
      ))}
    </div>
  );
}

// Соло-доска: угаданные ряды + активный ввод + пустые ряды до 6
export default function Board({ rows, cur, status, shake, maxRows }) {
  const active = status === 'playing';
  const filledRows = rows.length;
  const emptyRows = Math.max(0, maxRows - filledRows - (active ? 1 : 0));

  return (
    <div className="board">
      {rows.map((row, ri) => (
        <GuessRow key={ri} row={row} />
      ))}

      {active && (
        <div key={`${rows.length}:${shake}`} className={`row ${shake > 0 ? 'shake' : ''}`}>
          {[...Array(5)].map((_, i) => (
            <Tile
              key={i}
              i={i}
              ch={cur[i]}
              active={Boolean(cur[i])}
              cursor={i === cur.length}
            />
          ))}
        </div>
      )}

      {[...Array(emptyRows)].map((_, ri) => (
        <div className="row" key={`e${ri}`}>
          {[...Array(5)].map((_, i) => (
            <Tile key={i} i={i} />
          ))}
        </div>
      ))}
    </div>
  );
}
