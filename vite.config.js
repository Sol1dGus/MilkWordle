import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Авторизация Discord и WebSocket живут на игровом сервере (порт 3001).
// Проксируем их через vite, чтобы в ngrok всё уходило одним доменом.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // слушаем на всех интерфейсах: нужно и для IPv4-localhost, и для ngrok
    allowedHosts: true, // туннели (trycloudflare/ngrok) меняют адреса — разрешаем любой
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
