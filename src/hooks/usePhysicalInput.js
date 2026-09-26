import { useEffect } from 'react';

// Раскладка ЙЦУКЕН по кодам клавиш: работает даже если пользователь
// забыл переключить раскладку на русскую
const CODE_MAP = {
  KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н',
  KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з', BracketLeft: 'х', BracketRight: 'ъ',
  KeyA: 'ф', KeyS: 'ы', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р',
  KeyJ: 'о', KeyK: 'л', KeyL: 'д', Semicolon: 'ж', Quote: 'э',
  KeyZ: 'я', KeyX: 'ч', KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т',
  KeyM: 'ь', Comma: 'б', Period: 'ю',
};

export function usePhysicalInput(onLetter, onEnter, onBack) {
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        onEnter();
        return;
      }
      if (e.key === 'Backspace') {
        onBack();
        return;
      }
      if (/^([а-яё])$/i.test(e.key)) {
        onLetter(e.key.toLowerCase().replace('ё', 'е'));
        return;
      }
      if (CODE_MAP[e.code]) onLetter(CODE_MAP[e.code]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onLetter, onEnter, onBack]);
}
