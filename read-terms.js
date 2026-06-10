const readline = require('readline');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const outputFile = args[0] || 'custom-search-terms.json';

console.log('========================================');
console.log('  Paste your JSON search terms below');
console.log('========================================');
console.log('');
console.log('Example: ["美妆闲置","护肤闲置","口红"]');
console.log('');
console.log('Paste your terms and press Enter:');
console.log('');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  prompt: 'Terms> '
});

rl.prompt();

let lines = [];

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '' && lines.length > 0) {
    // Empty line after content — done
    rl.close();
    return;
  }
  if (trimmed === '' && lines.length === 0) {
    // Empty line with no content — use existing file
    console.log('\nNo terms entered. Using existing terms file.');
    process.exit(0);
  }
  lines.push(line);
});

rl.on('close', () => {
  const input = lines.join('\n').trim();
  if (!input) {
    console.log('No terms entered. Using existing terms file.');
    process.exit(0);
  }

  try {
    // Validate JSON
    const terms = JSON.parse(input);
    if (!Array.isArray(terms)) {
      console.error('ERROR: Input must be a JSON array like ["term1","term2"]');
      process.exit(1);
    }
    if (terms.length === 0) {
      console.error('ERROR: Array is empty. Provide at least one term.');
      process.exit(1);
    }

    // Write to file
    const outputPath = path.join(__dirname, outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(terms, null, 2), 'utf8');
    console.log(`\nOK: Saved ${terms.length} terms to ${outputFile}`);
    process.exit(0);
  } catch (e) {
    console.error('ERROR: Invalid JSON input.');
    console.error(e.message);
    process.exit(1);
  }
});
