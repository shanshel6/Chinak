
import fs from 'fs';
import path from 'path';

console.log('Running simple_test.js');
const file = path.resolve(process.cwd(), 'test_output.txt');
console.log('Writing to:', file);
fs.writeFileSync(file, 'Hello World from simple_test.js');
console.log('Done');
