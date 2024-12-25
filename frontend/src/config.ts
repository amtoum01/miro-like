const isDevelopment = process.env.NODE_ENV === 'development';
console.log('Environment:', process.env.NODE_ENV);
console.log('Is Development:', isDevelopment);

export const BACKEND_URL = isDevelopment
  ? 'http://localhost:8000'
  : 'https://miro-like-production.up.railway.app';

export const WS_URL = isDevelopment
  ? 'ws://localhost:8000/ws'
  : 'wss://miro-like-production.up.railway.app/ws';

console.log('Using WebSocket URL:', WS_URL); 