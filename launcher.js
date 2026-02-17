
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const logFile = 'E:\\mynewproject2\\launcher_status.txt';

try {
  // Clear log file
  fs.writeFileSync(logFile, '');

  const log = (msg) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] ${msg}\n`;
    try {
      console.log(msg);
      fs.appendFileSync(logFile, message);
    } catch (e) {
      // Ignore logging errors
    }
  };

  log('Starting launcher...');

  // Start Backend
  log('Spawning Backend...');
  const backend = spawn('node', ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '5002' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    shell: false
  });
  log(`Backend started with PID: ${backend.pid}`);

  backend.stdout.on('data', (data) => {
    log(`[Backend] ${data.toString().trim()}`);
  });

  backend.stderr.on('data', (data) => {
    log(`[Backend Error] ${data.toString().trim()}`);
  });

  backend.on('error', (err) => log(`Backend failed to start: ${err.message}`));
  backend.on('close', (code) => log(`Backend process exited with code: ${code}`));

  // Start Frontend
  log('Spawning Frontend...');
  const frontend = spawn('node', ['node_modules/vite/bin/vite.js'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    shell: false
  });
  log(`Frontend started with PID: ${frontend.pid}`);

  frontend.stdout.on('data', (data) => {
    log(`[Frontend] ${data.toString().trim()}`);
  });

  frontend.stderr.on('data', (data) => {
    log(`[Frontend Error] ${data.toString().trim()}`);
  });

  frontend.on('error', (err) => log(`Frontend failed to start: ${err.message}`));
  frontend.on('close', (code) => log(`Frontend process exited with code: ${code}`));

  const checkPort = (port) => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true); // Port is in use
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close();
        resolve(false); // Port is free
      });
      server.listen(port);
    });
  };

  const checkPorts = async () => {
    try {
      const backendRunning = await checkPort(5002);
      const frontendRunning = await checkPort(5173);
      
      log(`Port 5002 (Backend) status: ${backendRunning ? 'In Use' : 'Free'}`);
      log(`Port 5173 (Frontend) status: ${frontendRunning ? 'In Use' : 'Free'}`);
    } catch (err) {
      log(`CheckPorts Error: ${err.message}`);
    }
  };

  // Start checking ports
  checkPorts();
  setInterval(checkPorts, 5000);

  // Keep alive
  setInterval(() => {}, 60000);

} catch (err) {
  fs.appendFileSync(logFile, `CRITICAL ERROR: ${err.message}\n${err.stack}\n`);
}
