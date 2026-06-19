const http = require('http');
const fs = require('fs');
const path = require('path');

const sessionId = 'clip-model-loading-failure';
const logFile = path.join(__dirname, 'trae-debug-log-' + sessionId + '.ndjson');
const envFile = path.join(__dirname, '.dbg', sessionId + '.env');

// Create .dbg directory if it doesn't exist
const dbgDir = path.join(__dirname, '.dbg');
if (!fs.existsSync(dbgDir)) {
  fs.mkdirSync(dbgDir, { recursive: true });
}

// Write environment file
fs.writeFileSync(envFile, `TRAE_DEBUG_SESSION_ID=${sessionId}
TRAE_DEBUG_SERVER_URL=http://localhost:3000
`);

console.log('Debug Server starting for session:', sessionId);
console.log('Environment file:', envFile);
console.log('Log file:', logFile);

const logs = [];

const server = http.createServer((req, res) => {
  const { method, url } = req;
  
  if (method === 'POST' && url === '/log') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const logEntry = JSON.parse(body);
        logEntry.timestamp = new Date().toISOString();
        logs.push(logEntry);
        
        // Append to file
        fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else if (method === 'GET' && url === '/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(logs));
  } else if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessionId }));
  } else if (method === 'DELETE' && url === '/logs') {
    logs.length = 0;
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Try ports 3000-3010
function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Debug Server running at http://localhost:${port}`);
    console.log(`Use TRAE_DEBUG_SERVER_URL=http://localhost:${port} for instrumentation`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(3000);