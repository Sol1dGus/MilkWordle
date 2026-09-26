import { DiscordSDK } from '@discord/embedded-app-sdk';

export const query = new URLSearchParams(window.location.search);
// Активность внутри Discord всегда открывается с frame_id в адресе
export const isDiscord = query.has('frame_id');
// Отладочный режим комнаты в обычном браузере: http://localhost:5173/?party=1
export const debugParty = query.get('party') === '1';

export function shouldParty() {
  return isDiscord || debugParty;
}

// Возвращает объект игрока {id, name, avatar} или null (соло-режим в браузере)
export async function initPlayer() {
  if (isDiscord) {
    const sdk = new DiscordSDK(import.meta.env.VITE_CLIENT_ID);
    await sdk.ready();

    const { code } = await sdk.commands.authorize({
      client_id: sdk.clientId,
      response_type: 'code',
      state: '',
      prompt: 'none',
      scope: ['identify'],
    });

    const res = await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error('Не удалось обменять код авторизации');
    const { access_token } = await res.json();

    const auth = await sdk.commands.authenticate({ access_token });
    const u = auth.user;
    return {
      id: `d${u.id}`,
      name: u.global_name || u.username || 'Дояр',
      avatar: u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
        : null,
    };
  }

  if (debugParty) {
    // Мок-игрок для теста комнаты в браузере. sessionStorage — чтобы
    // в соседней вкладке был другой игрок.
    let id = sessionStorage.getItem('moloko-mock-id');
    if (!id) {
      id = `mock-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('moloko-mock-id', id);
    }
    const names = ['Зорькин Фанат', 'Дояр Сосед', 'Бычок', 'Молочный Магнат', 'Сливкин', 'Пеструха'];
    const name = names[Math.floor(Math.random() * names.length)];
    return { id, name, avatar: null };
  }

  return null;
}
