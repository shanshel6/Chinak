
import http from 'http';

function request(method, path) {
  return new Promise((resolve) => {
    const options = {
      hostname: '127.0.0.1',
      port: 7700,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer masterKey123'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function main() {
  console.log('Deleting index to force re-indexing...');
  const result = await request('DELETE', '/indexes/products');
  console.log('Delete result:', result);
}

main();
