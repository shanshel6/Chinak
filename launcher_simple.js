
console.log('Hello from launcher');
const fs = require('fs');
try {
  fs.writeFileSync('launcher_test.txt', 'working');
  console.log('File written');
} catch (e) {
  console.error('File write failed:', e);
}
