
import net from 'net';

const port = 5001;
const host = '127.0.0.1';

const socket = new net.Socket();
socket.setTimeout(2000);

socket.on('connect', () => {
  console.log(`Port ${port} is open!`);
  socket.destroy();
});

socket.on('timeout', () => {
  console.log(`Port ${port} timeout.`);
  socket.destroy();
});

socket.on('error', (err) => {
  console.log(`Port ${port} error: ${err.message}`);
});

socket.connect(port, host);
