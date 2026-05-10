import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_TERMS_PATH = path.join(__dirname, 'goofish-search-terms-history.json');
const UPDATE_PROGRESS_PATH = path.join(__dirname, 'goofish-update-existing-progress.json');

try {
  // Clear search term history
  if (fs.existsSync(SEARCH_TERMS_PATH)) {
    fs.unlinkSync(SEARCH_TERMS_PATH);
    console.log('✅ Cleared search term history');
  } else {
    console.log('ℹ️  Search term history file does not exist');
  }
  
  // Clear update progress
  if (fs.existsSync(UPDATE_PROGRESS_PATH)) {
    fs.unlinkSync(UPDATE_PROGRESS_PATH);
    console.log('✅ Cleared update progress');
  } else {
    console.log('ℹ️  Update progress file does not exist');
  }
  
  console.log('✅ Successfully reset all history. Pipeline will start from the beginning.');
} catch (error) {
  console.error('❌ Error resetting history:', error);
}
