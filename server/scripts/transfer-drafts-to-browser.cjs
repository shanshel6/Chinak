// Simple script to help transfer drafts from server to browser localStorage
// Run this after scraping, then copy the output to your browser console

const fs = require('fs');
const path = require('path');

function getLatestDrafts() {
  const localStorageDir = path.join(__dirname, 'local-storage-sim');
  const localStorageFile = path.join(localStorageDir, 'admin_local_drafts.json');
  
  if (!fs.existsSync(localStorageFile)) {
    console.log('❌ No drafts found. Run the scraper first.');
    return;
  }
  
  try {
    const drafts = JSON.parse(fs.readFileSync(localStorageFile, 'utf8'));
    
    console.log('📋 COPY THE FOLLOWING CODE AND PASTE IT IN YOUR BROWSER CONSOLE:');
    console.log('================================================================');
    
    const jsCode = `
// Paste this code in your browser console at http://localhost:5173/admin/products
localStorage.setItem('admin_local_drafts', '${JSON.stringify(drafts).replace(/'/g, "\\'")}');
console.log('✅ ${drafts.length} draft products loaded into localStorage');
console.log('🔄 Refresh the admin products page to see your drafts');
`;
    
    console.log(jsCode);
    console.log('================================================================');
    console.log('📝 Instructions:');
    console.log('1. Open your browser at http://localhost:5173/admin/products');
    console.log('2. Press F12 to open Developer Tools');
    console.log('3. Go to the Console tab');
    console.log('4. Paste the code above and press Enter');
    console.log('5. Refresh the admin products page');
    
  } catch (error) {
    console.error('❌ Error reading drafts:', error.message);
  }
}

// Run the function
getLatestDrafts();