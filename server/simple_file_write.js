
const fs = require('fs');
console.log('Writing file...');
try {
  fs.writeFileSync('e:/mynewproject2/server/simple_write.txt', 'Hello World');
  console.log('File written successfully');
} catch (e) {
  console.error('Error writing file:', e);
}
