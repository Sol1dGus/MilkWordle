// Плитка: ch — буква, state — 'correct' | 'present' | 'absent' | null,
// reveal — анимация переворота с задержкой по позиции (--i)
export function Tile({ ch, state, i = 0, active = false, cursor = false, onClick = null }) {
  const cls = [
    'tile',
    state ? `s-${state}` : '',
    ch ? 'filled' : '',
    cursor ? 'cursor' : '',
    onClick ? 'clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} style={{ '--i': i }} onClick={onClick}>
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
// cols — длина слова (5/6/7)
export default function Board({ rows, cur, cells, cursorPos, onSelectCell, status, shake, maxRows, cols = 5 }) {
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
          {[...Array(cols)].map((_, i) => {
            const ch = cells ? cells[i] : cur?.[i];
            const isCursor = cursorPos !== undefined ? i === cursorPos : i === (cur?.length ?? 0);
            return (
              <Tile
                key={i}
                i={i}
                ch={ch}
                active={Boolean(ch)}
                cursor={isCursor}
                onClick={onSelectCell ? () => onSelectCell(i) : null}
              />
            );
          })}
        </div>
      )}

      {[...Array(emptyRows)].map((_, ri) => (
        <div className="row" key={`e${ri}`}>
          {[...Array(cols)].map((_, i) => (
            <Tile key={i} i={i} />
          ))}
        </div>
      ))}
    </div>
  );
}
