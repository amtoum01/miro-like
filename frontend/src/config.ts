// API URLs
const BACKEND_URL = process.env.NODE_ENV === 'production' 
  ? 'https://miro-like-production.up.railway.app'  // Railway URL
  : 'http://localhost:8000';

// WebSocket URLs
const WS_URL = process.env.NODE_ENV === 'production'
  ? 'wss://miro-like-production.up.railway.app'    // Railway URL with wss://
  : 'ws://localhost:8000';

export { BACKEND_URL, WS_URL }; 