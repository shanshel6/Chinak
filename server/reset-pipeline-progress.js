import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEARCH_TERMS_PATH = path.join(__dirname, 'goofish-search-terms.json');
const BATCH_LINKS_QUEUE_PATH = path.join(__dirname, 'goofish-batch-links-queue.json');

console.log('Resetting pipeline progress tracking...\n');

// Reset search term history
try {
  if (fs.existsSync(SEARCH_TERMS_PATH)) {
    fs.unlinkSync(SEARCH_TERMS_PATH);
    console.log('✓ Deleted goofish-search-terms.json');
  } else {
    console.log('✓ goofish-search-terms.json does not exist (already reset)');
  }
} catch (error) {
  console.error('✗ Failed to delete goofish-search-terms.json:', error.message);
}

// Reset batch links queue
try {
  if (fs.existsSync(BATCH_LINKS_QUEUE_PATH)) {
    fs.unlinkSync(BATCH_LINKS_QUEUE_PATH);
    console.log('✓ Deleted goofish-batch-links-queue.json');
  } else {
    console.log('✓ goofish-batch-links-queue.json does not exist (already reset)');
  }
} catch (error) {
  console.error('✗ Failed to delete goofish-batch-links-queue.json:', error.message);
}

console.log('\nPipeline progress tracking has been reset.');
console.log('The pipeline will now start from the first term in custom-search-terms.json.');
process.exit(0);
