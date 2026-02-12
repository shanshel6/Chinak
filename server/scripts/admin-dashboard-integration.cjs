const axios = require('axios');

// Admin Dashboard API Configuration
const ADMIN_API_BASE = 'http://localhost:5001/api';
const ADMIN_AUTH_TOKEN = process.env.ADMIN_AUTH_TOKEN || 'your-admin-token-here';

// Direct database posting (bypass localStorage for immediate publishing)
const DIRECT_DB_POSTING = true; // Set to true to post directly to database

// Robust numeric extractor for strings like "300 جرام" or "15.5 cm"
const extractNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  
  const str = String(val);
  const match = str.match(/(\d+\.?\d*)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    const isGramUnit = (str.includes('جرام') || str.toLowerCase().includes('gram')) && !str.toLowerCase().includes('kg');
    const isLikelyGrams = !str.toLowerCase().includes('kg') && parsed > 10;
    if (isGramUnit || isLikelyGrams) {
      return parsed / 1000;
    }
    return isNaN(parsed) ? null : parsed;
  }
  return null;
};

// Calculate price logic matching server/import_real_products.js
const calculateBulkImportPrice = (rawPrice, domesticFee, weight, length, width, height, explicitMethod) => {
  const weightInKg = extractNumber(weight) || 0.5;
  let method = explicitMethod?.toLowerCase();
  if (!method) {
    method = (weightInKg > 0 && weightInKg < 1) ? 'air' : 'sea';
  }
  const domestic = domesticFee || 0;

  if (method === 'air') {
    // Air Pricing logic: (Base Price + Domestic Fee + (Weight * Air Rate)) * 1.20
    const airRate = 15400;
    const shippingCost = weightInKg * airRate;
    
    // Treat rawPrice as IQD (no heuristic conversion)
    const basePrice = rawPrice;
    
    return Math.ceil(((basePrice + domestic + shippingCost) * 1.20) / 250) * 250;
  } else {
    // Sea: (Base Price + Domestic Fee + Sea Shipping) * 1.20
    const seaRate = 182000;
    const l = extractNumber(length) || 0;
    const w = extractNumber(width) || 0;
    const h = extractNumber(height) || 0;

    const paddedL = l > 0 ? l + 5 : 0;
    const paddedW = w > 0 ? w + 5 : 0;
    const paddedH = h > 0 ? h + 5 : 0;

    const volumeCbm = (paddedL * paddedW * paddedH) / 1000000;
    const seaShippingCost = Math.max(volumeCbm * seaRate, 500);

    // Treat rawPrice as IQD (no heuristic conversion)
    const basePrice = rawPrice;

    return Math.ceil(((basePrice + domestic + seaShippingCost) * 1.20) / 250) * 250;
  }
};

/**
 * Convert 1688 scraped product to admin dashboard format
 */
function convertToAdminProduct(scrapedProduct) {
  // Parse dimensions
  let length = 20, width = 15, height = 10;
  if (scrapedProduct.dimensions) {
      const parts = scrapedProduct.dimensions.split('*').map(p => parseFloat(p));
      if (parts.length === 3) {
          [length, width, height] = parts;
      }
  }

  const formatSpecs = (details) => {
    if (!details) return "";
    if (typeof details === 'string') return details;
    if (typeof details === 'object') {
      try {
        return JSON.stringify(details);
      } catch (e) {
        return "";
      }
    }
    return String(details);
  };

  const cleanMetadata = (metadata) => {
    if (!metadata || typeof metadata !== 'object') return null;
    const cleaned = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (Array.isArray(value)) {
        const filtered = value.filter(Boolean);
        if (filtered.length > 0) cleaned[key] = filtered;
      } else if (value) {
        cleaned[key] = value;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  };

  const specsStr = formatSpecs(scrapedProduct.product_details);
  const rawPrice = extractNumber(scrapedProduct.general_price) || 0;
  const weight = extractNumber(scrapedProduct.weight) || 0.5;
  const domesticFee = extractNumber(scrapedProduct.domestic_shipping_fee) || 0;
  const basePriceRMB = rawPrice + domesticFee;
  const aiMetadata = cleanMetadata(scrapedProduct.marketing_metadata) || scrapedProduct.aimetatags || scrapedProduct.aiMetadata;
  
  // Calculate final price using the bulk import logic
  const finalPrice = calculateBulkImportPrice(rawPrice, domesticFee, weight, length, width, height);

  // Helper to find specific price for a variant combination
  const findVariantPrice = (color, size) => {
    if (!scrapedProduct.generated_options) return finalPrice;
    
    // Look for matching option
    const match = scrapedProduct.generated_options.find(opt => {
        // Match color (if exists)
        const colorMatch = !color || 
                          opt.color === color || 
                          (opt.attributes && opt.attributes.some(a => a.name === 'اللون' && a.value === color));
        
        // Match size (if exists)
        const sizeMatch = !size || 
                         (opt.sizes && opt.sizes.includes(size)) || 
                         opt.size === size || 
                         (opt.attributes && opt.attributes.some(a => a.name === 'المقاس' && a.value === size));
        
        return colorMatch && sizeMatch;
    });

    if (match && match.price) {
        // Calculate price for this specific variant
        const variantRawPrice = extractNumber(match.price);
        // Use the same bulk import logic for the variant
        return calculateBulkImportPrice(variantRawPrice, domesticFee, weight, length, width, height);
    }
    return finalPrice;
  };

  const variantColors = Array.isArray(scrapedProduct?.variants?.colors) ? scrapedProduct.variants.colors.filter(Boolean) : [];
  const variantSizes = Array.isArray(scrapedProduct?.variants?.sizes) ? scrapedProduct.variants.sizes.filter(Boolean) : [];

  const options = [];
  if (variantColors.length > 0) options.push({ name: 'اللون', values: variantColors });
  if (variantSizes.length > 0) options.push({ name: 'المقاس', values: variantSizes });

  const variants = [];
  if (variantColors.length > 0 && variantSizes.length > 0) {
    for (const color of variantColors) {
      for (const size of variantSizes) {
        variants.push({
          options: { اللون: color, المقاس: size },
          price: findVariantPrice(color, size),
          isPriceCombined: true
        });
      }
    }
  } else if (variantColors.length > 0) {
    for (const color of variantColors) {
      variants.push({
        options: { اللون: color },
        price: findVariantPrice(color, null),
        isPriceCombined: true
      });
    }
  } else if (variantSizes.length > 0) {
    for (const size of variantSizes) {
      variants.push({
        options: { المقاس: size },
        price: findVariantPrice(null, size),
        isPriceCombined: true
      });
    }
  }

  return {
    name: scrapedProduct.product_name || 'Untitled Product',
    chineseName: scrapedProduct.product_name || '', // Use same name if no Chinese specific field
    description: specsStr || scrapedProduct.product_name, // Use specs as description if no description
    price: finalPrice,
    basePriceRMB: basePriceRMB,
    image: scrapedProduct.main_images?.[0] || '',
    images: scrapedProduct.main_images || [], // Pass all images, though API might only take one in 'image' field, we can try to pass 'images' too
    status: 'PUBLISHED', // Direct publish as per user request (or at least consistent with import_real_products)
    isActive: true,
    isFeatured: true,
    purchaseUrl: scrapedProduct.url || '',
    specs: specsStr,
    weight: parseFloat(weight),
    length: parseFloat(length),
    width: parseFloat(width),
    height: parseFloat(height),
    domesticShippingFee: parseFloat(domesticFee),
    isPriceCombined: true,
    aiMetadata: aiMetadata,
    deliveryTime: scrapedProduct.delivery_time || null
  };
}

/**
 * Post a single product directly to database (PUBLISHED status)
 * Bypasses localStorage drafts and posts directly as active product
 */
async function postProductToAdmin(productData) {
  try {
    const adminProduct = convertToAdminProduct(productData);
    
    // Change status to PUBLISHED to post directly to database
    const publishedProduct = {
      ...adminProduct,
      status: 'PUBLISHED', // This will trigger direct database posting
      isActive: true,      // Make product active immediately
      isLocal: false       // This is a real database product, not local draft
    };
    
    console.log(`🚀 Posting directly to database: ${publishedProduct.name}`);
    
    // Use your app's API to create the product
    // This will call the real createProduct function which handles database insertion
    const response = await axios.post(
      `${ADMIN_API_BASE}/products`,
      publishedProduct,
      {
        headers: {
          'Authorization': `Bearer ${ADMIN_AUTH_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5 second timeout
      }
    );
    
    console.log(`✅ Product posted to database successfully!`);
    console.log(`📊 Database ID: ${response.data.id}`);
    console.log(`🔗 Status: ${response.data.status}`);
    
    return {
      success: true,
      id: response.data.id, // Real database ID
      message: 'Product posted directly to database',
      data: response.data
    };
    
  } catch (error) {
    // STRICT MODE: Always throw error instead of saving API calls
    console.error('❌ FAILED TO POST TO DATABASE - BACKEND SERVER NOT RUNNING');
    console.error('💥 Error:', error.message);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
      console.error('🚨 Backend server at http://localhost:5001 is not running!');
      console.error('💡 Start your backend server with: npm run dev:backend');
    } else if (error.response && error.response.status === 401) {
      console.error('🔐 Authentication failed - check your ADMIN_AUTH_TOKEN');
    }
    
    if (error.response) {
      console.error('📋 Response data:', error.response.data);
      console.error('🔢 Status code:', error.response.status);
    }
    
    throw new Error(`Database posting failed: ${error.message}`);
  }
}

/**
 * Post multiple products to admin dashboard
 */
async function postProductsToAdmin(products, authToken = ADMIN_AUTH_TOKEN) {
  const results = {
    success: [],
    failed: []
  };

  for (const product of products) {
    try {
      const result = await postProductToAdmin(product, authToken);
      results.success.push({
        product: product.title_en || product.title,
        result: result
      });
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      results.failed.push({
        product: product.title_en || product.title,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Load products from JSON file and post to admin
 */
async function importProductsFromFile(filePath, authToken = ADMIN_AUTH_TOKEN) {
  try {
    const fs = require('fs');
    const products = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    console.log(`📦 Loading ${products.length} products from ${filePath}`);
    
    const results = await postProductsToAdmin(products, authToken);
    
    console.log(`\n📊 Import Results:`);
    console.log(`✅ Success: ${results.success.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log('\nFailed products:');
      results.failed.forEach((item, index) => {
        console.log(`${index + 1}. ${item.product}: ${item.error}`);
      });
    }
    
    return results;
  } catch (error) {
    console.error('❌ Failed to import products from file:', error.message);
    throw error;
  }
}

// Export functions for use in other scripts
module.exports = {
  convertToAdminProduct,
  postProductToAdmin,
  postProductsToAdmin,
  importProductsFromFile,
  ADMIN_API_BASE,
  ADMIN_AUTH_TOKEN
};

// CLI usage: node admin-dashboard-integration.cjs import path/to/products.json
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === 'import' && args[1]) {
    const filePath = args[1];
    importProductsFromFile(filePath)
      .then(() => console.log('🎉 Import completed!'))
      .catch(error => console.error('💥 Import failed:', error));
  } else {
    console.log('Usage: node admin-dashboard-integration.cjs import path/to/products.json');
    console.log('Set ADMIN_AUTH_TOKEN environment variable for authentication');
  }
}
