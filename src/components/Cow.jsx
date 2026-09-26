// Зорька — флиртующая корова-маскот. SVG целиком свой, никаких картинок.
export default function Cow({ text, mood = 'idle' }) {
  const wink = mood === 'wink';
  const happy = mood === 'happy';
  const sad = mood === 'sad';
  return (
    <div className="cow">
      <div className="cow-bubble">
        <span>{text}</span>
      </div>
      <svg className={`cow-face mood-${mood}`} viewBox="0 0 140 110" width="110" height="88">
        <defs>
          <clipPath id="headClip">
            <ellipse cx="70" cy="62" rx="38" ry="35" />
          </clipPath>
        </defs>

        {/* уши */}
        <g transform="rotate(-22 30 44)">
          <ellipse cx="30" cy="44" rx="17" ry="11" fill="#fffdf8" stroke="#191410" strokeWidth="4" />
          <ellipse cx="30" cy="44" rx="9" ry="5.5" fill="#c68b59" />
        </g>
        <g transform="rotate(22 110 44)">
          <ellipse cx="110" cy="44" rx="17" ry="11" fill="#fffdf8" stroke="#191410" strokeWidth="4" />
          <ellipse cx="110" cy="44" rx="9" ry="5.5" fill="#c68b59" />
        </g>

        {/* рожки */}
        <path d="M52 26 Q50 12 60 10 Q57 20 60 26 Z" fill="#7a4a2b" stroke="#191410" strokeWidth="2.5" />
        <path d="M88 26 Q90 12 80 10 Q83 20 80 26 Z" fill="#7a4a2b" stroke="#191410" strokeWidth="2.5" />

        {/* голова с пятнами */}
        <ellipse cx="70" cy="62" rx="38" ry="35" fill="#fffdf8" stroke="#191410" strokeWidth="4" />
        <g clipPath="url(#headClip)">
          <path d="M28 40 Q40 28 52 38 Q58 46 46 52 Q32 54 28 40Z" fill="#191410" />
          <path d="M92 78 Q108 74 110 88 Q104 100 90 94 Q84 86 92 78Z" fill="#191410" />
          <circle cx="102" cy="34" r="9" fill="#191410" />
        </g>

        {/* бантик */}
        <g transform="translate(97 20) rotate(14)">
          <path d="M0 0 L-11 -6 Q-14 0 -11 6 Z" fill="#7a4a2b" stroke="#191410" strokeWidth="2.5" />
          <path d="M0 0 L11 -6 Q14 0 11 6 Z" fill="#7a4a2b" stroke="#191410" strokeWidth="2.5" />
          <circle cx="0" cy="0" r="3.4" fill="#5a351e" stroke="#191410" strokeWidth="2" />
        </g>

        {/* глаза */}
        {happy ? (
          <>
            <path d="M48 52 Q54 44 60 52" fill="none" stroke="#191410" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M80 52 Q86 44 92 52" fill="none" stroke="#191410" strokeWidth="4.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="54" cy="51" r="6.5" fill="#191410" />
            <circle cx="56.4" cy="48.8" r="2" fill="#fffdf8" />
            <path d="M46 44 L42 41 M47 47 L43 45.5" stroke="#191410" strokeWidth="2.5" strokeLinecap="round" />
            {wink ? (
              <path d="M80 51 Q86 45 92 51" fill="none" stroke="#191410" strokeWidth="4.5" strokeLinecap="round" />
            ) : (
              <>
                <circle cx="86" cy="51" r="6.5" fill="#191410" />
                <circle cx="88.4" cy="48.8" r="2" fill="#fffdf8" />
                <path d="M94 44 L98 41 M93 47 L97 45.5" stroke="#191410" strokeWidth="2.5" strokeLinecap="round" />
              </>
            )}
          </>
        )}

        {/* румянец */}
        <ellipse cx="44" cy="63" rx="7" ry="4" fill="#d99a7a" opacity="0.55" />
        <ellipse cx="96" cy="63" rx="7" ry="4" fill="#d99a7a" opacity="0.55" />

        {/* мордочка */}
        <ellipse cx="70" cy="79" rx="23" ry="14" fill="#e8c9a8" stroke="#191410" strokeWidth="3.5" />
        <ellipse cx="62" cy="77" rx="2.6" ry="3.6" fill="#191410" />
        <ellipse cx="78" cy="77" rx="2.6" ry="3.6" fill="#191410" />
        {sad ? (
          <path d="M63 86 Q70 81 77 86" fill="none" stroke="#191410" strokeWidth="3" strokeLinecap="round" />
        ) : (
          <path d="M63 83 Q70 89 77 83" fill="none" stroke="#191410" strokeWidth="3" strokeLinecap="round" />
        )}
        <circle cx="82" cy="86" r="1.4" fill="#191410" />
      </svg>
    </div>
  );
}
