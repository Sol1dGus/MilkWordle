import Cow from './Cow.jsx';

export function Splash({ onAccept }) {
  return (
    <div className="splash">
      <div className="splash-card">
        <h1 className="logo big">MilkWordle</h1>
        <p className="splash-sub">словесная ферма</p>
        <Cow text="Добро пожаловать на ферму! Свежие слова и парное молоко уже ждут." mood="wink" />
        <p className="splash-note">
          Отгадывай слова в одиночку или соревнуйся с друзьями в одном хлеву.
        </p>
        <div className="splash-btns">
          <button className="btn primary" onClick={onAccept}>
            Начать игру
          </button>
        </div>
      </div>
    </div>
  );
}
