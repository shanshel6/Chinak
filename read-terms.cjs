const readline = require('readline');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const outputFile = args[0] || 'custom-search-terms.json';

// Determine pipeline number and progress file based on terms file name
const isPipeline2 = outputFile.includes('-2');
const pipelineNum = isPipeline2 ? 2 : 1;
const progressFile = isPipeline2 ? 'pipeline-2-progress.json' : 'pipeline-1-progress.json';
const searchTermsHistory = isPipeline2 ? 'server/scripts/goofish-search-terms-2.json' : 'server/scripts/goofish-search-terms.json';

console.log('========================================');
console.log('  Pipeline ' + pipelineNum + ' - Custom Search Terms');
console.log('========================================');
console.log('');

// Show last run info if available
try {
  const progressPath = path.join(__dirname, progressFile);
  if (fs.existsSync(progressPath)) {
    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    if (progress.lastRun && progress.totalTerms > 0) {
      console.log('Last run: ' + progress.lastRun);
      console.log('Terms: ' + progress.totalTerms + ' total, ' + progress.completedTerms.length + ' completed, ' + progress.failedTerms.length + ' failed');
      if (progress.lastTerm) {
        console.log('Last term processed: [' + progress.lastTermIndex + '/' + progress.totalTerms + '] "' + progress.lastTerm + '"');
      }
      console.log('Status: ' + progress.status);
      console.log('');
    }
  }
} catch (e) {
  // ignore read errors
}

console.log('Paste your JSON search terms below.');
console.log('Example: ["term1","term2","term3"]');
console.log('');
console.log('Paste terms and press Enter (empty line = use existing):');
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
    rl.close();
    return;
  }
  if (trimmed === '' && lines.length === 0) {
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
    const terms = JSON.parse(input);
    if (!Array.isArray(terms)) {
      console.error('ERROR: Input must be a JSON array like ["term1","term2"]');
      process.exit(1);
    }
    if (terms.length === 0) {
      console.error('ERROR: Array is empty. Provide at least one term.');
      process.exit(1);
    }

    // Save terms to file
    const outputPath = path.join(__dirname, outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(terms, null, 2), 'utf8');

    // Clear old search term history so pipeline starts fresh
    const historyPath = path.join(__dirname, searchTermsHistory);
    try {
      if (fs.existsSync(historyPath)) {
        fs.unlinkSync(historyPath);
        console.log('Cleared old search term history.');
      }
    } catch (e) {
      // ignore
    }

    // Write progress file for this run
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const progress = {
      lastRun: now,
      totalTerms: terms.length,
      completedTerms: [],
      failedTerms: [],
      lastTermIndex: 0,
      lastTerm: null,
      status: "starting",
      termsList: terms
    };
    const progressPath = path.join(__dirname, progressFile);
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');

    console.log('\nOK: Saved ' + terms.length + ' terms to ' + outputFile);
    console.log('Pipeline ' + pipelineNum + ' will start fresh with these terms.');
    process.exit(0);
  } catch (e) {
    console.error('ERROR: Invalid JSON input.');
    console.error(e.message);
    process.exit(1);
  }
});
