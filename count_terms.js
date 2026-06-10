const fs = require('fs');
const data = fs.readFileSync('e:\\mynewproject2\\custom-search-terms-2.json', 'utf8');
const arr = JSON.parse(data);
console.log('Total terms:', arr.length);
console.log('Unique terms:', [...new Set(arr)].length);
console.log('First 5:', arr.slice(0, 5).join(', '));
console.log('Last 5:', arr.slice(-5).join(', '));
