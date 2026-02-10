// Automated draft transfer system - watches for new scraped JSON files
// and generates browser transfer code automatically

const fs = require('fs');
const path = require('path');

class AutoDraftTransfer {
  constructor() {
    this.scriptsDir = __dirname;
    this.lastProcessed = null;
  }

  // Find the latest scraped JSON file
  findLatestScrapedFile() {
    const files = fs.readdirSync(this.scriptsDir)
      .filter(file => file.startsWith('1688-') && file.endsWith('.json'))
      .map(file => ({
        name: file,
        path: path.join(this.scriptsDir, file),
        time: fs.statSync(path.join(this.scriptsDir, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    return files.length > 0 ? files[0] : null;
  }

  // Convert scraped product to admin draft format
  convertToAdminDraft(scrapedProduct) {
    return {
      name: scrapedProduct.title_en || scrapedProduct.product_name || 'Untitled Product',
      chineseName: scrapedProduct.title_cn || '',
      description: scrapedProduct.description_ar || scrapedProduct.description || '',
      price: scrapedProduct.converted_price_iqd || 0,
      basePriceRMB: scrapedProduct.price_rmb || 0,
      image: scrapedProduct.main_image || '',
      images: scrapedProduct.images || [],
      status: 'DRAFT',
      isActive: false,
      isFeatured: false,
      purchaseUrl: scrapedProduct.product_url || '',
      specs: {
        moq: scrapedProduct.moq || 1,
        company: scrapedProduct.company_name || '',
        location: scrapedProduct.company_location || '',
        weight_kg: scrapedProduct.weight_kg || 0.5,
        original_price_rmb: scrapedProduct.price_rmb || 0,
        converted_price_iqd: scrapedProduct.converted_price_iqd || 0
      },
      storeEvaluation: {
        responseRate: scrapedProduct.response_rate || '',
        transactionRate: scrapedProduct.transaction_rate || ''
      },
      weight: scrapedProduct.weight_kg || 0.5,
      length: 20,
      width: 15,
      height: 10,
      domesticShippingFee: 0,
      id: `local-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isLocal: true
    };
  }

  // Generate browser transfer code
  generateBrowserTransferCode(scrapedData) {
    const drafts = Array.isArray(scrapedData) 
      ? scrapedData.map(product => this.convertToAdminDraft(product))
      : [this.convertToAdminDraft(scrapedData)];

    const jsonString = JSON.stringify(drafts)
      .replace(/'/g, "\\'")
      .replace(/\n/g, ' ');

    return `
// AUTO-GENERATED DRAFT TRANSFER CODE
// Paste this in browser console at http://localhost:5173/admin/products

localStorage.setItem('admin_local_drafts', '${jsonString}');
console.log('✅ ${drafts.length} draft product(s) loaded into localStorage');
console.log('🔄 Refresh the admin products page to see your drafts');

// Products transferred:
${drafts.map((draft, index) => `// ${index + 1}. ${draft.name}`).join('\n')}
`;
  }

  // Process the latest file
  processLatestFile() {
    const latestFile = this.findLatestScrapedFile();
    
    if (!latestFile) {
      console.log('❌ No scraped JSON files found in:', this.scriptsDir);
      console.log('💡 Run the scraper first to generate product data');
      return;
    }

    if (this.lastProcessed === latestFile.name) {
      console.log('📋 Latest file already processed:', latestFile.name);
      console.log('💡 Run the scraper again to get new products');
      return;
    }

    try {
      const scrapedData = JSON.parse(fs.readFileSync(latestFile.path, 'utf8'));
      
      console.log('🎯 Found scraped file:', latestFile.name);
      console.log('📊 Products found:', Array.isArray(scrapedData) ? scrapedData.length : 1);
      console.log('\n' + '='.repeat(60));
      
      const transferCode = this.generateBrowserTransferCode(scrapedData);
      console.log(transferCode);
      
      console.log('='.repeat(60));
      console.log('📋 INSTRUCTIONS:');
      console.log('1. Open http://localhost:5173/admin/products in your browser');
      console.log('2. Press F12 → Console tab');
      console.log('3. Paste the code above and press Enter');
      console.log('4. Refresh the page to see drafts');
      
      this.lastProcessed = latestFile.name;
      
      // Also save to file for easy access
      const transferFile = path.join(this.scriptsDir, 'browser-transfer-code.js');
      fs.writeFileSync(transferFile, transferCode);
      console.log('\n💾 Transfer code also saved to: browser-transfer-code.js');
      
    } catch (error) {
      console.error('❌ Error processing file:', error.message);
    }
  }

  // Watch for new files (optional)
  startWatching() {
    console.log('👀 Watching for new scraped files... (Ctrl+C to stop)');
    
    fs.watch(this.scriptsDir, (eventType, filename) => {
      if (filename && filename.startsWith('1688-') && filename.endsWith('.json')) {
        console.log('\n🔄 New scraped file detected:', filename);
        this.processLatestFile();
      }
    });
  }
}

// Run the processor
const processor = new AutoDraftTransfer();
processor.processLatestFile();

// Uncomment next line to enable automatic watching:
// processor.startWatching();