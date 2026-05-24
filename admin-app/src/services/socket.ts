import { io } from 'socket.io-client';

const SOCKET_URL = 'https://chinak-production.up.railway.app';
// const SOCKET_URL = 'http://localhost:5001';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
});

export const joinAdminRoom = () => {
  socket.emit('join_admin_room');
};
