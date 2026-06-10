import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cookiesPath = path.join(__dirname, '..', 'goofish-cookies.json');
if (!fs.existsSync(cookiesPath)) {
  console.log('No cookies file found');
  process.exit(0);
}

const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
console.log(`Total cookies: ${cookies.length}`);
console.log('\nCookie names:');
cookies.forEach(c => {
  const expires = c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session';
  console.log(`  ${c.name} = ${c.value.substring(0, 30)}... (expires: ${expires}) (domain: ${c.domain})`);
});
