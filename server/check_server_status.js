
import http from 'http';
import fs from 'fs';

function check(url, name) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(`${name}: UP (${res.statusCode})`);
    });
    req.on('error', (e) => {
      resolve(`${name}: DOWN (${e.message})`);
    });
    req.end();
  });
}

async function run() {
  const frontend = await check('http://localhost:5173', 'Frontend');
  const backend = await check('http://localhost:5001/api/products', 'Backend');
  
  const result = `${frontend}\n${backend}`;
  console.log(result);
  fs.writeFileSync('server/server_check_status.txt', result);
}

run();
