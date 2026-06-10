import { io, Socket } from 'socket.io-client';

const DEFAULT_SOCKET_URL = 'https://chinak-production.up.railway.app';

export let socket = io(localStorage.getItem('api_url') || DEFAULT_SOCKET_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ['websocket', 'polling'],
});

export const updateSocketUrl = (newUrl: string) => {
  if (socket) {
    socket.disconnect();
  }
  socket = io(newUrl, {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['websocket', 'polling'],
  });
  return socket;
};

export const joinAdminRoom = () => {
  if (socket && socket.connected) {
    console.log('[SOCKET] Emitting join_admin_room');
    socket.emit('join_admin_room');
  }
};
