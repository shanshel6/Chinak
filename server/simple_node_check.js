
const fs = require('fs');
try {
    fs.writeFileSync('simple_node_check.txt', 'Node is working and can write files.');
    console.log('File written successfully.');
} catch (e) {
    console.error('File write failed:', e);
}
