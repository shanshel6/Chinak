import fs from 'fs';
const path = 'e:\\mynewproject2\\server\\.env';

let content = fs.readFileSync(path, 'utf8');

// Replace DATABASE_URL - match internal Railway host specifically
content = content.replace(
  /DATABASE_URL="postgresql:\/\/postgres:[^@]+@postgres-aprm\.railway\.internal:\d+\/railway"/g,
  'DATABASE_URL="postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway"'
);

// Replace DIRECT_URL - match internal Railway host specifically
content = content.replace(
  /DIRECT_URL="postgresql:\/\/postgres:[^@]+@postgres-aprm\.railway\.internal:\d+\/railway"/g,
  'DIRECT_URL="postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway"'
);

fs.writeFileSync(path, content);
console.log('Updated .env file with public Railway host');
