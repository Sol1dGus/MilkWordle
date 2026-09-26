import Cow from './Cow.jsx';

export function Splash({ onAccept, onDecline }) {
  return (
    <div className="splash">
      <div className="splash-card">
        <div className="splash-18">18+</div>
        <h1 className="logo big">МОЛОКО</h1>
        <p className="splash-sub">wordly по-коровьи</p>
        <Cow text="Заходи, ковбой… у меня как раз налито!" mood="wink" />
        <p className="splash-note">
          Флирт, пошлые намеки и молоко. Никакой откровенщины — только Зорька
          со своим характером.
        </p>
        <div className="splash-btns">
          <button className="btn primary" onClick={onAccept}>
            Мне 18+, наливай
          </button>
          <button className="btn ghost" onClick={onDecline}>
            Я еще пацан / пацанка
          </button>
        </div>
      </div>
    </div>
  );
}

export function Denied() {
  return (
    <div className="splash">
      <div className="splash-card">
        <Cow text="Приходи, когда вырастешь. Молоко подождет." mood="sad" />
        <h2 className="splash-sub">Молоко выдается с 18 лет</h2>
      </div>
    </div>
  );
}
