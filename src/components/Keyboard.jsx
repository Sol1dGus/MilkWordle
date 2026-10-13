import { useEffect, useState } from 'react';

const LAYOUTS = {
  ru: {
    rows: [
      ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
      ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
      ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю'],
    ],
  },
  en: {
    rows: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
    ],
  },
};

export default function Keyboard({
  lang = 'ru',
  marks,
  knownPos = {},
  resetKey = null,
  onKey,
  onEnter,
  onBack,
  disabled,
  enterLabel = 'Ввод',
}) {
  const [notes, setNotes] = useState({});

  useEffect(() => {
    setNotes({});
  }, [lang, resetKey]);

  const toggleNote = (e, ch) => {
    e.preventDefault();
    setNotes((prev) => {
      const cur = prev[ch];
      const next = !cur ? 'maybe' : cur === 'maybe' ? 'out' : null;
      const copy = { ...prev };
      if (next) copy[ch] = next;
      else delete copy[ch];
      return copy;
    });
  };

  const layout = LAYOUTS[lang] || LAYOUTS.ru;
  const key = (ch) => {
    const note = notes[ch];
    return (
      <button
        key={ch}
        className={`key ${marks[ch] ? `s-${marks[ch]}` : ''} ${knownPos[ch] !== undefined ? 'kp' : ''} ${note ? `note-${note}` : ''}`}
        onClick={() => onKey(ch)}
        onContextMenu={(e) => toggleNote(e, ch)}
        disabled={disabled}
        title="ПКМ — своя пометка (? / ×)"
      >
        {ch.toUpperCase()}
        {note && <span className="key-note-badge">{note === 'maybe' ? '?' : '×'}</span>}
      </button>
    );
  };

  const [r1, r2, r3] = layout.rows;
  return (
    <div className={`keyboard ${disabled ? 'disabled' : ''}`}>
      <div className="krow">{r1.map(key)}</div>
      <div className="krow">{r2.map(key)}</div>
      <div className="krow">
        <button className="key wide" onClick={onEnter} disabled={disabled}>
          {enterLabel}
        </button>
        {r3.map(key)}
        <button className="key wide" onClick={onBack} disabled={disabled} aria-label="Стереть">
          ⌫
        </button>
      </div>
    </div>
  );
}
