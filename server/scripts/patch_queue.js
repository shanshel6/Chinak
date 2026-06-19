// Patch for process-product-queue.js - skip ProductImage updates
// Save this as patch_queue.js and run: node patch_queue.js

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'scripts', 'process-product-queue.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the section that updates ProductImage
const startMarker = '// Match by productId + order (index) instead of URL to avoid URL mismatch issues';
const endMarker = '// Update product\'s main image embedding';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
  // Replace the problematic ProductImage update block with a simple log
  const replacement = `      // SKIPPED: ProductImage.imageEmbedding update (column doesn't exist, not needed for search)
      console.log(\`[Queue] Skipping ProductImage update for order \${imageOrder} - not needed\`);`;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx);
  
  const newContent = before + replacement + '\n\n      ' + after;
  
  fs.writeFileSync(filePath, newContent);
  console.log('✅ Patched process-product-queue.js - removed ProductImage updates');
  console.log('Restart the queue processor.');
} else {
  console.error('Could not locate the update block in the file.');
}