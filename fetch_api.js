
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logFile = path.join(__dirname, 'api_response.json');

const url = 'http://localhost:5002/api/products?page=1&limit=10&search=';

console.log('START FETCH');

http.get(url, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    console.log('Response Body:', data);
    try {
      fs.writeFileSync(logFile, data);
      console.log('Wrote response to:', logFile);
    } catch (err) {
      console.error('Failed to write file:', err);
    }
    console.log('END FETCH');
  });

}).on('error', (err) => {
  console.error('Error fetching API:', err.message);
});
