const R1 = ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'];
const R2 = ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'];
const R3 = ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю'];

export default function Keyboard({ marks, onKey, onEnter, onBack, disabled }) {
  const key = (ch) => (
    <button
      key={ch}
      className={`key ${marks[ch] ? `s-${marks[ch]}` : ''}`}
      onClick={() => onKey(ch)}
      disabled={disabled}
    >
      {ch.toUpperCase()}
    </button>
  );

  return (
    <div className={`keyboard ${disabled ? 'disabled' : ''}`}>
      <div className="krow">{R1.map(key)}</div>
      <div className="krow">{R2.map(key)}</div>
      <div className="krow">
        <button className="key wide" onClick={onEnter} disabled={disabled}>
          Ввод
        </button>
        {R3.map(key)}
        <button className="key wide" onClick={onBack} disabled={disabled} aria-label="Стереть">
          ⌫
        </button>
      </div>
    </div>
  );
}
