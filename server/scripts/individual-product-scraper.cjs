const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const vm = require('vm'); // Added for robust JS object parsing
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') }); // Load environment variables from correct .env file
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Also load server .env for API keys

// Admin Dashboard Integration
const { postProductToAdmin } = require('./admin-dashboard-integration.cjs');

// Database Integration - Use HTTP API instead of direct Prisma
const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001';

// Mobile API endpoints
const MOBILE_API_BASE = 'https://h5api.m.1688.com';

// Stealth headers
function getStealthHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://m.1688.com/',
    'Origin': 'https://m.1688.com'
  };
}

// Random delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const DESKTOP_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

const DESKTOP_REFERRERS = [
  'https://www.1688.com/',
  'https://s.1688.com/',
  'https://search.1688.com/',
  'https://detail.1688.com/'
];

function getRandomDesktopHeaders() {
  const ua = DESKTOP_USER_AGENTS[Math.floor(Math.random() * DESKTOP_USER_AGENTS.length)];
  const referer = DESKTOP_REFERRERS[Math.floor(Math.random() * DESKTOP_REFERRERS.length)];
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ar;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Referer': referer,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
  };
}

function isLikelyBlockedHtml(html) {
  if (!html) return true;
  if (typeof html === 'object') {
    // If it's an object, it might be valid JSON data
    // Check for common error properties if known, otherwise assume valid
    return false; 
  }
  if (typeof html !== 'string') return true;
  const lower = html.toLowerCase();
  if (lower.includes('captcha') || lower.includes('verify') || lower.includes('security')) return true;
  if (html.includes('访问被拒绝') || html.includes('验证码') || html.includes('滑动验证')) return true;
  return false;
}

async function fetchHtmlWithRetries(url, maxAttempts) {
  const attempts = Math.max(1, Number(maxAttempts || 1));
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      console.log(`[Attempt ${i+1}/${attempts}] Fetching URL: ${url}`);
      
      const isMobile = url.includes('m.1688.com');
      const headers = isMobile ? getStealthHeaders() : getRandomDesktopHeaders();
      
      const response = await axios.get(url, {
        headers: headers,
        timeout: 15000
      });
      console.log(`[Attempt ${i+1}/${attempts}] Response status: ${response.status}`);
      if (isLikelyBlockedHtml(response.data)) {
        console.warn(`[Attempt ${i+1}/${attempts}] Blocked or unexpected HTML detected.`);
        console.warn(`HTML Preview: ${typeof response.data === 'string' ? response.data.substring(0, 500).replace(/\n/g, ' ') : 'Not a string'}`);
        throw new Error('Blocked or unexpected HTML response');
      }
      return response.data;
    } catch (err) {
      console.error(`[Attempt ${i+1}/${attempts}] Error: ${err.message}`);
      lastError = err;
      if (i < attempts - 1) {
        const wait = 2000 + Math.random() * 3000;
        console.log(`Waiting ${Math.round(wait)}ms before retry...`);
        await delay(wait);
      }
    }
  }
  throw lastError || new Error('Failed to fetch HTML');
}

// Extract offer ID from product URL
function extractOfferId(productUrl) {
  const match = productUrl.match(/offer[idI][dD]?=([0-9]+)/) || 
                productUrl.match(/\/([0-9]{8,})\.html/) ||
                productUrl.match(/offer\/([0-9]+)/);
  
  return match ? match[1] : null;
}

function normalize1688ProductUrl(productUrl) {
  const offerId = extractOfferId(productUrl);
  if (!offerId) return productUrl;
  const isMobile = /(^|\/\/)(detail\.m\.1688\.com|m\.1688\.com)\b/i.test(productUrl);
  if (!isMobile) return productUrl;
  return `https://detail.1688.com/offer/${offerId}.html`;
}

// Extract global data object from HTML/Scripts
function extractGlobalData($, html) {
  let data = null;
  
  const extractBalancedFromIndex = (input, startIndex) => {
    let i = startIndex;
    while (i < input.length && input[i] !== '{') i++;
    if (i >= input.length) return null;
    const begin = i;
    let depth = 0;
    let inString = false;
    let stringQuote = null;
    let escaped = false;
    for (; i < input.length; i++) {
      const ch = input[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === stringQuote) {
          inString = false;
          stringQuote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringQuote = ch;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (depth === 0) {
        return input.slice(begin, i + 1);
      }
    }
    return null;
  };

  const evaluateJsObject = (objectLiteral) => {
    if (!objectLiteral || typeof objectLiteral !== 'string') return null;
    const sandbox = { result: null };
    try {
      vm.runInNewContext(`result = (${objectLiteral});`, sandbox, { timeout: 1000 });
      const parsed = sandbox.result;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) {}
    return null;
  };

  const tryExtractByMarker = (markerRegex) => {
    const match = html.match(markerRegex);
    if (!match || typeof match.index !== 'number') return null;
    const objectLiteral = extractBalancedFromIndex(html, match.index);
    return evaluateJsObject(objectLiteral);
  };

  // 1. Try to find window.__INIT_DATA
  data = tryExtractByMarker(/window\.__INIT_DATA\s*=\s*/);
  if (data) return data;

  // 1b. Try common variants
  data = tryExtractByMarker(/window\.__INIT_DATA__\s*=\s*/);
  if (data) return data;

  // 2. Try iDetailData
  data = tryExtractByMarker(/var\s+iDetailData\s*=\s*/);
  if (data) return data;

  // 3. Try window.context (New 1688 structure) - Using VM for robust parsing
   if (!data) {
     try {
       console.log('Attempting to extract window.context...');
       // Find the script tag containing window.context
       let scriptContent = null;
       $('script').each((i, el) => {
         const content = $(el).html();
         if (content && content.includes('window.context') && /window\.context\s*=/.test(content)) {
           if (!scriptContent || content.length > scriptContent.length) {
             scriptContent = content;
           }
         }
       });

       if (scriptContent) {
         const sandbox = { 
           window: { 
             contextPath: "/default",
             context: null 
           },
           document: { 
             createElement: () => ({}),
             getElementsByTagName: () => [],
             querySelector: () => null
           },
           location: { href: '' },
           navigator: { userAgent: '' },
           self: {},
           globalThis: {},
           console: { log: () => {}, warn: () => {}, error: () => {} },
           setTimeout: () => 0,
           clearTimeout: () => {},
           atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
           btoa: (s) => Buffer.from(String(s), 'binary').toString('base64')
         };
         
         try {
           console.log('Running VM...');
           vm.runInNewContext(scriptContent, sandbox);
           const contextData = sandbox.window.context;
           
           console.log('VM Context extracted. Data exists:', !!contextData);
           if (contextData) {
             console.log('VM context keys:', Object.keys(contextData));
             if (contextData.result) console.log('Result keys:', Object.keys(contextData.result));
           }

           // Normalize to match __INIT_DATA structure
             if (contextData && contextData.result && contextData.result.data) {
               data = { data: contextData.result.data };
               console.log('Successfully extracted global data from window.context!');
               
               const ctxData = contextData.result.data;
               console.log('Context Data Keys:', Object.keys(ctxData));
               if (ctxData.mainPrice) console.log('mainPrice fields:', Object.keys(ctxData.mainPrice.fields || {}));
                if (ctxData.productPackInfo) {
                    console.log('productPackInfo fields:', Object.keys(ctxData.productPackInfo.fields || {}));
                    if (ctxData.productPackInfo.fields && ctxData.productPackInfo.fields.pieceWeightScale) {
                         console.log('pieceWeightScale keys:', Object.keys(ctxData.productPackInfo.fields.pieceWeightScale));
                    }
                }
                if (ctxData.skuSelection) console.log('skuSelection fields:', Object.keys(ctxData.skuSelection.fields || {}));
                if (ctxData.skuPreview) console.log('skuPreview fields:', Object.keys(ctxData.skuPreview.fields || {}));
               
               // Map Title
               if (!data.data.subject && ctxData.productTitle && ctxData.productTitle.fields) {
                  data.data.subject = ctxData.productTitle.fields.subject;
               }
               
               // Map Images
               if (ctxData.gallery && ctxData.gallery.fields && ctxData.gallery.fields.mainImage) {
                  data.data.imageList = ctxData.gallery.fields.mainImage;
               }
               
               // Map Price and Variants from mainPrice
               if (ctxData.mainPrice && ctxData.mainPrice.fields) {
                   // Price
                   if (ctxData.mainPrice.fields.priceModel) {
                       const prices = ctxData.mainPrice.fields.priceModel.currentPrices;
                       if (prices && prices.length > 0) {
                           data.data.price = prices[0].price; 
                       }
                   }
                   
                   // Variants from skuInfos
                   if (ctxData.mainPrice.fields.skuInfos) {
                       const skuInfos = ctxData.mainPrice.fields.skuInfos;
                       if (!data.data.skuModel) data.data.skuModel = {};
                       
                       // Try to reconstruct skuProps
                       const variants = { index0: new Set(), index1: new Set() };
                       
                       skuInfos.forEach(sku => {
                           if (sku.specAttrs) {
                               // specAttrs might use > or &gt;
                               const separator = sku.specAttrs.includes('&gt;') ? '&gt;' : '>';
                               const parts = sku.specAttrs.split(separator).map(s => s.trim());
                               
                               if (parts.length > 0) variants.index0.add(parts[0]);
                               if (parts.length > 1) variants.index1.add(parts[1]);
                           }
                       });
                       
                       const skuProps = [];
                       // Heuristic to guess which is color and which is size
                       // Usually colors are fewer than sizes, or contain color keywords
                       // But often Index 0 is Color, Index 1 is Size in 1688
                       
                       if (variants.index0.size > 0) {
                           skuProps.push({
                               propName: '颜色', // Assume first is color (often true)
                               values: Array.from(variants.index0).map(v => ({ name: v }))
                           });
                       }
                       if (variants.index1.size > 0) {
                           skuProps.push({
                               propName: '尺寸', // Assume second is size
                               values: Array.from(variants.index1).map(v => ({ name: v }))
                           });
                       }
                       
                       data.data.skuModel.skuProps = skuProps;
                   }
               }

               if (!data.data.skuModel || !Array.isArray(data.data.skuModel.skuProps) || data.data.skuModel.skuProps.length === 0) {
                 const findSkuPropsInContext = () => {
                   const stack = [ctxData];
                   const seen = new Set();
                   let steps = 0;
                   while (stack.length > 0 && steps < 12000) {
                     const current = stack.pop();
                     steps += 1;
                     if (!current || typeof current !== 'object') continue;
                     if (seen.has(current)) continue;
                     seen.add(current);

                     const directSkuProps = current.skuProps;
                     if (Array.isArray(directSkuProps) && directSkuProps.length > 0) return directSkuProps;

                     const fieldsSkuProps = current.fields && current.fields.skuProps;
                     if (Array.isArray(fieldsSkuProps) && fieldsSkuProps.length > 0) return fieldsSkuProps;

                     const skuModelSkuProps = current.skuModel && current.skuModel.skuProps;
                     if (Array.isArray(skuModelSkuProps) && skuModelSkuProps.length > 0) return skuModelSkuProps;

                     const fieldsSkuModelSkuProps = current.fields && current.fields.skuModel && current.fields.skuModel.skuProps;
                     if (Array.isArray(fieldsSkuModelSkuProps) && fieldsSkuModelSkuProps.length > 0) return fieldsSkuModelSkuProps;

                     for (const val of Object.values(current)) {
                       if (val && typeof val === 'object') stack.push(val);
                     }
                   }
                   return null;
                 };

                 const foundSkuProps = findSkuPropsInContext();
                 if (foundSkuProps) {
                   if (!data.data.skuModel) data.data.skuModel = {};
                   data.data.skuModel.skuProps = foundSkuProps;
                 }
               }
               
               // Fallback mappings
               // context.result.data.gallery -> data.imageList
               if (!data.data.imageList && data.data.gallery) {
                  // Try to construct imageList
                  if (data.data.gallery.fields && data.data.gallery.fields.offerImgList) {
                     data.data.offerImgList = data.data.gallery.fields.offerImgList;
                  }
               }
               
               // Extract title from other places if not in standard location
               if (!data.data.subject && data.data.productPackInfo && data.data.productPackInfo.fields && data.data.productPackInfo.fields.subject) {
                  data.data.subject = data.data.productPackInfo.fields.subject;
               }
             } else {
               console.log('VM context data missing expected structure');
             }
         } catch (vmError) {
           console.log('VM execution failed:', vmError.message);
         }
       } else {
         console.log('Script tag with window.context not found');
       }
     } catch (e) {
       console.log('Error parsing window.context with VM:', e.message);
     }
   }
   
   return data;
}

// Get product details from desktop HTML scraping
async function getProductDetails(productUrl) {
  try {
    const offerId = extractOfferId(productUrl);
    if (!offerId) {
      console.log("❌ Could not extract offer ID from:", productUrl);
      return null;
    }
    
    const fetchUrl = normalize1688ProductUrl(productUrl);
    const candidateUrls = [];
    if (fetchUrl) candidateUrls.push(fetchUrl);
    if (productUrl && productUrl !== fetchUrl) candidateUrls.push(productUrl);

    if (fetchUrl !== productUrl) {
      console.log(`🔁 Normalized mobile URL to desktop offer page for ${offerId}`);
    }

    console.log(`📦 Fetching product ${offerId}...`);

    let bestFormatted = null;
    let bestScore = -1;

    for (const urlToFetch of candidateUrls) {
      try {
        console.log("📄 Fetch URL:", urlToFetch);

        const html = await fetchHtmlWithRetries(urlToFetch, 4); // Increased retries from 2 to 4
        await delay(3000 + Math.random() * 4000); // Increased delay to 3-7s

        let $;
      let globalData;

      if (typeof html === 'object') {
         console.log('📦 Received JSON/Object response');
         if (html.data) {
             globalData = html;
         } else {
             globalData = { data: html };
         }
         $ = cheerio.load('');
      } else {
         $ = cheerio.load(html);
         globalData = extractGlobalData($, html);
      }

      if (globalData) console.log('✅ Found global data object!');

      const subject = await extractTitle($, html, globalData);
        const realProductData = {
          subject: subject,
          price: extractPrice($, html, globalData),
          images: extractImages($, globalData),
          material: extractMaterial($, html, globalData, subject),
          design: extractDesign($, html, globalData),
          fit: extractFit($, html, globalData),
          collar: extractCollar($, html, globalData),
          sleeves: extractSleeves($, html, globalData),
          features: extractFeatures($, html, globalData),
          season: extractSeason($, html, globalData),
          length: extractLength($, html, globalData),
          variants: extractVariants(globalData),
          weight: extractWeight(globalData),
          dimensions: extractDimensions(globalData)
        };

        // If dimensions are missing, use AI to estimate them
        if (!realProductData.dimensions) {
          console.log("📏 Dimensions missing, estimating with AI...");
          realProductData.dimensions = await estimateDimensionsWithAI(realProductData.subject);
          console.log(`🤖 AI Estimated Dimensions: ${realProductData.dimensions}`);
        }

        console.log('📊 Extracted data:', JSON.stringify(realProductData, null, 2));

        const formatted = formatProductData(realProductData, productUrl);

        const hasPlaceholderName =
          !formatted.product_name ||
          formatted.product_name === "Untitled Product" ||
          formatted.product_name === "منتج بدون عنوان";
        const colorsCount = Array.isArray(formatted.variants?.colors) ? formatted.variants.colors.length : 0;
        const sizesCount = Array.isArray(formatted.variants?.sizes) ? formatted.variants.sizes.length : 0;
        const hasNoVariants = colorsCount === 0 && sizesCount === 0;
        const imagesCount = Array.isArray(formatted.main_images) ? formatted.main_images.length : 0;

        let score = 0;
        if (!hasPlaceholderName) score += 1000;
        if (!hasNoVariants) score += 1500;
        score += Math.min(imagesCount, 20) * 10;
        score += Math.min(colorsCount, 50) * 5;
        score += Math.min(sizesCount, 50) * 5;

        if (score > bestScore) {
          bestScore = score;
          bestFormatted = formatted;
        }

        if (!hasPlaceholderName && !hasNoVariants && imagesCount > 0) {
          return formatted;
        }
      } catch (innerError) {
        console.warn(`⚠️ Failed to fetch/process candidate URL ${urlToFetch}: ${innerError.message}`);
        // Continue to next candidate
      }
    }

    return bestFormatted; // Removed fallback to getSampleProductData to avoid inserting fake data
    
  } catch (error) {
    console.error(`❌ Error fetching product: ${error.message}`);
    return null; // Return null instead of sample data
  }
}

// Format product data to match your exact template
function formatProductData(productData, productUrl) {
  const offerId = extractOfferId(productUrl);
  
  // Use REAL extracted data instead of hardcoded values
  return {
    id: parseInt(offerId) || Date.now(), // Use actual offer ID or timestamp as fallback
    product_name: productData.subject || "منتج بدون عنوان",
    category: "ملابس نسائية", // Generic category, should be refined if possible
    main_images: productData.images || [],
    url: productUrl,
    product_details: {
      "النمط": productData.design || "",
      "الياقة": productData.collar || "",
      "الأكمام": productData.sleeves || "",
      "الخامة": productData.material || "",
      "الموسم": productData.season || "",
      "النمط التصميمي": productData.design || "",
      "الملاءمة": productData.fit || "",
      "طول الملابس": productData.length || "",
      "الميزات": productData.features || ""
    },
    weight: productData.weight || "0.5", // Use extracted weight or default
    dimensions: productData.dimensions || "", // Use extracted dimensions
    reviews: [],
    domestic_shipping_fee: 0,
    general_price: parseFloat(productData.price) || 0,
    variants: {
      sizes: productData.variants?.sizes || [],
      colors: productData.variants?.colors || []
    },
    
    // Add marketing metadata
    marketing_metadata: {
      extracted_tags: [
        productData.category, productData.season, productData.collar, productData.sleeves
      ].filter(Boolean),
      synonyms: [],
      category_suggestion: "ملابس نسائية"
    }
  };
}

// Generate marketing metadata from product data
function generateMarketingMetadata(productData) {
  const name = productData.product_name || '';
  const category = productData.category || '';
  const details = productData.product_details || {};
  
  // Extract tags from product name and details
  const extractedTags = [];
  const synonyms = [];
  
  // Common Arabic fashion terms to look for
  const fashionTerms = [
    'مخطط', 'ياقة', 'ضيق', 'مخصر', 'فضفاض', 'مبطن', 'صوف', 'قطن', 'سباندكس',
    'طويل', 'قصير', 'ثلاثي', 'أبعاد', 'نمط', 'سحب', 'بلوفر', 'شتاء', 'ربيع',
    'صيف', 'خريف', '2025', '2024', 'أنيق', 'كشخة', 'مودرن', 'كلاسيك', 'عصري'
  ];
  
  // Extract tags from product name
  fashionTerms.forEach(term => {
    if (name.includes(term)) {
      extractedTags.push(term);
    }
  });
  
  // Extract from product details
  Object.values(details).forEach(detail => {
    fashionTerms.forEach(term => {
      if (detail.includes && detail.includes(term)) {
        extractedTags.push(term);
      }
    });
  });
  
  // Generate synonyms based on product type
  if (name.includes('قميص') || name.includes('تيشيرت')) {
    synonyms.push('تيشيرت نسائي', 'بلوزة نسائية', 'قميص بنات', 'ملابس داخلية');
  }
  if (name.includes('بدي') || name.includes('بلوفر')) {
    synonyms.push('سويتر نسائي', 'بلوفر بنات', 'كنزة نسائية', 'سترة صوف');
  }
  if (name.includes('شتاء') || name.includes('صوف')) {
    synonyms.push('ملابس شتوية', 'ملابس دافئة', 'ملابس موسم بارد');
  }
  if (name.includes('صيف')) {
    synonyms.push('ملابس صيفية', 'ملابس خفيفة', 'ملابس موسم حار');
  }
  
  // Generate category suggestions
  let categorySuggestion = category;
  if (name.includes('بدي') || name.includes('بلوفر')) {
    categorySuggestion = 'ملابس نسائية - بلوفرات وسويترات';
  } else if (name.includes('قميص') || name.includes('تيشيرت')) {
    categorySuggestion = 'ملابس نسائية - تيشيرتات وقمصان';
  }
  
  // Add some popular marketing tags
  if (extractedTags.length < 3) {
    extractedTags.push('مودرن 2025', 'أنيق وعصري', 'جودة عالية');
  }
  
  // Remove duplicates
  const uniqueTags = [...new Set(extractedTags)];
  const uniqueSynonyms = [...new Set(synonyms)];
  
  return {
    extracted_tags: uniqueTags.slice(0, 8), // Limit to 8 tags
    synonyms: uniqueSynonyms.slice(0, 5),   // Limit to 5 synonyms
    category_suggestion: categorySuggestion
  };
}

// Check if product already exists in database
async function checkProductExists(purchaseUrl) {
  try {
    console.log(`🔍 Checking if product already exists: ${purchaseUrl}`);
    console.log(`🔑 Using Admin Token: ${process.env.ADMIN_AUTH_TOKEN ? process.env.ADMIN_AUTH_TOKEN.substring(0, 10) + '...' : 'MISSING'}`);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('API operation timeout')), 10000)
    );
    
    // Extract offer ID for more reliable matching
    const offerId = extractOfferId(purchaseUrl);
    
    console.log(`📡 Sending request to: ${API_BASE_URL}/api/admin/products/check-existence`);

    // Use the admin check-existence endpoint which returns all products with purchase URLs
    const response = await Promise.race([
      axios.get(`${API_BASE_URL}/api/admin/products/check-existence`, {
        headers: {
          'Authorization': `Bearer ${process.env.ADMIN_AUTH_TOKEN}`
        }
      }),
      timeoutPromise
    ]);
    
    // Check if any product has matching purchase URL
    const existingProducts = response.data || [];
    
    // Debug: log what we received
    console.log(`📊 Received ${existingProducts.length} products for duplicate check`);
    if (existingProducts.length > 0) {
      console.log(`📋 Sample product: ${JSON.stringify(existingProducts[0])}`);
    }
    
    // More robust duplicate detection
    const existingProduct = existingProducts.find(p => {
      if (!p.purchaseUrl) return false;
      
      // Check if URLs match exactly or contain the same offer ID
      const existingOfferId = extractOfferId(p.purchaseUrl);
      const isMatch = p.purchaseUrl === purchaseUrl || 
             (offerId && existingOfferId === offerId) ||
             p.purchaseUrl.includes(offerId) ||
             purchaseUrl.includes(existingOfferId);
      
      if (isMatch) {
        console.log(`🔍 Found match: ${p.purchaseUrl} === ${purchaseUrl}`);
        console.log(`   Offer IDs: ${existingOfferId} === ${offerId}`);
      }
      
      return isMatch;
    });
    
    if (existingProduct) {
      console.log(`⚠️  Product already exists in database`);
      console.log(`   Existing URL: ${existingProduct.purchaseUrl}`);
      console.log(`   New URL: ${purchaseUrl}`);
      return existingProduct;
    }
    
    console.log('✅ No existing product found - safe to insert');
    return null;
    
  } catch (error) {
    console.error(`❌ Product existence check failed: ${error.message}`);
    return null;
  }
}

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
    return Math.ceil(((rawPrice + domestic + shippingCost) * 1.20) / 250) * 250;
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

    return Math.ceil(((rawPrice + domestic + seaShippingCost) * 1.20) / 250) * 250;
  }
};

// Insert product into database via HTTP API
async function insertProductToDatabase(productData) {
  try {
    console.log(`💾 Inserting product into database: ${productData.product_name}`);
    
    // First check if product already exists
    // const existingProduct = await checkProductExists(productData.url);
    // if (existingProduct) {
    //   console.log(`⏭️  Skipping insertion - product already exists with ID: ${existingProduct.id}`);
    //   return existingProduct;
    // }
    console.log("⚠️ Skipping pre-check for existence (optimization). Duplicates will be handled by unique constraints if any.");
    const existingProduct = null;
    
    let length = null;
    let width = null;
    let height = null;
    if (productData.dimensions && typeof productData.dimensions === 'string') {
      const parts = productData.dimensions.split('*').map(p => parseFloat(String(p).trim()));
      if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
        [length, width, height] = parts;
      }
    }

    const domesticFee = parseFloat(productData.domestic_shipping_fee) || 0;
    const rawRmbPrice = parseFloat(productData.general_price) || 0;
    // Convert RMB to IQD for base price storage and calculation (User Rule: RMB * 200)
    // UPDATE: User says base price is already IQD, so no conversion
    const basePriceIQD = rawRmbPrice;
    
    const weight = parseFloat(productData.weight) || 0.5;
    
    // Calculate final IQD price using bulk import logic
    // Pass basePriceIQD as the rawPrice, so the formula (Price + Shipping) works in consistent IQD units
    const finalPrice = calculateBulkImportPrice(basePriceIQD, domesticFee, weight, length, width, height, null);

    const variantColors = Array.isArray(productData?.variants?.colors) ? productData.variants.colors.filter(Boolean) : [];
    const variantSizes = Array.isArray(productData?.variants?.sizes) ? productData.variants.sizes.filter(Boolean) : [];

    const options = [];
    if (variantColors.length > 0) options.push({ name: 'اللون', values: variantColors });
    if (variantSizes.length > 0) options.push({ name: 'المقاس', values: variantSizes });

    // Helper to find specific price for a variant combination
    const findVariantPrice = (color, size) => {
        if (!productData.generated_options) return finalPrice;
        
        // Look for matching option
        const match = productData.generated_options.find(opt => {
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
            return calculateBulkImportPrice(variantRawPrice, domesticFee, weight, length, width, height, null);
        }
        return finalPrice;
    };

    const variants = [];
    
    if (variantColors.length > 0 && variantSizes.length > 0) {
      for (const color of variantColors) {
        for (const size of variantSizes) {
          variants.push({ options: { اللون: color, المقاس: size }, price: findVariantPrice(color, size), isPriceCombined: true });
        }
      }
    } else if (variantColors.length > 0) {
      for (const color of variantColors) {
        variants.push({ options: { اللون: color }, price: findVariantPrice(color, null), isPriceCombined: true });
      }
    } else if (variantSizes.length > 0) {
      for (const size of variantSizes) {
        variants.push({ options: { المقاس: size }, price: findVariantPrice(null, size), isPriceCombined: true });
      }
    }

    // Prepare the product data for API submission - match exact server expectations
    const apiProductData = {
      name: productData.product_name,
      chineseName: productData.product_name,
      description: JSON.stringify(productData.product_details),
      price: finalPrice,          // Calculated IQD price
      basePriceRMB: basePriceIQD, // Raw IQD base price
      image: productData.main_images[0] || '',
      purchaseUrl: productData.url,
      weight: weight,
      length: Number(length) || 0,
      width: Number(width) || 0,
      height: Number(height) || 0,
      domesticShippingFee: domesticFee,
      specs: JSON.stringify({
        category: productData.category,
        variants: productData.variants,
        marketing: productData.marketing_metadata
      }),
      images: productData.main_images.map((url, index) => ({
        url,
        order: index,
        type: 'GALLERY'
      })),
      isPriceCombined: true,
      options,
      variants,
      aiMetadata: productData.marketing_metadata,
      deliveryTime: productData.delivery_time || null
    };
    
    // Add timeout for API operations
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('API operation timeout')), 15000)
    );
    
    console.log(`📡 Sending POST request to: ${API_BASE_URL}/api/products`);
    const response = await Promise.race([
      axios.post(`${API_BASE_URL}/api/products`, apiProductData, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ADMIN_AUTH_TOKEN}`
        }
      }),
      timeoutPromise
    ]);
    
    const newProduct = response.data;
    console.log(`✅ Product inserted successfully with ID: ${newProduct.id}`);

    // --- Trigger AI Embedding ---
    try {
      console.log(`🤖 Triggering AI processing for product ${newProduct.id}...`);
      await axios.post(`${API_BASE_URL}/api/admin/products/${newProduct.id}/process-ai`, {}, {
        headers: {
          'Authorization': `Bearer ${process.env.ADMIN_AUTH_TOKEN}`
        },
        timeout: 2000 // Don't wait long, it's background
      });
      console.log(`✨ AI processing triggered successfully`);
    } catch (aiError) {
      console.warn(`⚠️ Failed to trigger AI processing: ${aiError.message}`);
    }

    return newProduct;
    
  } catch (error) {
    console.error(`❌ Database insertion error: ${error.message}`);
    if (error.response?.status === 409) {
      console.log('⚠️  Product already exists in database');
    } else if (error.response) {
      console.log(`📊 API Error: ${error.response.status} - ${error.response.data?.message || 'Unknown error'}`);
    }
    return null;
  }
}

// Sample product data fallback
function getSampleProductData(productUrl) {
  const offerId = extractOfferId(productUrl) || '857391907810';
  
  const sampleProduct = {
    product_name: "[SAMPLE DATA - SCRAPING FAILED] قميص نسائي بياقة U وأكمام طويلة، مبطن بالصوف",
    category: "ملابس نسائية - تيشرتات وبديات",
    main_images: [
      "https://cbu01.alicdn.com/img/ibank/O1CN01eodaik1OJJzMqULs5_!!2218903091684-0-cib.jpg_.webp",
      "https://cbu01.alicdn.com/img/ibank/O1CN01k8i7Xn1OJJzL4ocYs_!!2218903091684-0-cib.jpg_.webp",
      "https://cbu01.alicdn.com/img/ibank/O1CN01i8U9P41OJJzOdoFpT_!!2218903091684-0-cib.jpg_.webp",
      "https://cbu01.alicdn.com/img/ibank/O1CN01UKgk6f1OJJzMY2IqO_!!2218903091684-0-cib.jpg_.webp"
    ],
    url: productUrl,
    product_details: {
      "المادة": "92% قطن، 8% سباندكس",
      "التصميم": "نمط بلوفر سحب",
      "القصة": "ضيق (Slim Fit)",
      "نوع الياقة": "ياقة على شكل U",
      "الأكمام": "أكمام طويلة",
      "العناصر الشعبية": "تأثير ثلاثي الأبعاد 3D",
      "الموسم": "ربيع/شتاء 2025",
      "الطول": "قصير (40سم < طول ≤ 50سم)"
    },
    weight: "1.0",
    dimensions: "35*25*5",
    reviews: [],
    domestic_shipping_fee: 0,
    general_price: 20, // Low fallback price to avoid huge calculations (was 4200)
    variants: {
      sizes: ["S", "M", "L", "XL", "2XL"],
      colors: [
        "أبيض",
        "أسود", 
        "مشمشي",
        "أزرق فاتح",
        "رمادي",
        "أبيض (مبطن)",
        "أسود (مبطن)",
        "رمادي (mبطن)",
        "مشمشي (مبطن)",
        "أزرق (مبطن)"
      ]
    },
    generated_options: [
      {
        color: "أبيض",
        sizes: ["S", "M", "L", "XL", "2XL"],
        price: 20
      },
      {
        color: "أسود",
        sizes: ["S", "M", "L", "XL", "2XL"],
        price: 20
      },
      {
        color: "رمادي",
        sizes: ["S", "M", "L", "XL", "2XL"],
        price: 20
      },
      {
        color: "أبيض (مبطن)",
        sizes: ["S", "M", "L", "XL", "2XL"],
        price: 20
      }
    ],
    
    // Add marketing metadata
    marketing_metadata: generateMarketingMetadata({
      product_name: "قميص نسائي بياقة U وأكمام طويلة، مبطن بالصوف، سترة تحتية ضيقة لخريف وشتاء 2025",
      category: "ملابس نسائية - تيشرتات وبديات",
      product_details: {
        "المادة": "92% قطن، 8% سباندكس",
        "التصميم": "نمط بلوفر سحب",
        "القصة": "ضيق (Slim Fit)",
        "نوع الياقة": "ياقة على شكل U",
        "الأكمام": "أكمام طويلة",
        "العناصر الشعبية": "تأثير ثلاثي الأبعاد 3D",
        "الموسم": "ربيع/شتاء 2025",
        "الطول": "قصير (40سم < طول ≤ 50سم)"
      }
    })
  };
  
  return sampleProduct;
}

// ==================== REAL DATA EXTRACTION FUNCTIONS ====================

async function extractTitle($, html, globalData) {
  let title = "منتج بدون عنوان";

  // 1. Try global data first (most reliable)
  if (globalData) {
    if (globalData.data && globalData.data.subject) title = globalData.data.subject;
    else if (globalData.data && globalData.data.offerTitle) title = globalData.data.offerTitle;
    else if (globalData.data && globalData.data.tempModel && globalData.data.tempModel.offerTitle) title = globalData.data.tempModel.offerTitle;
    else if (globalData.data && globalData.data.tempModel && globalData.data.tempModel.subject) title = globalData.data.tempModel.subject;
    else if (globalData.data && globalData.data.productTitle && globalData.data.productTitle.fields && globalData.data.productTitle.fields.subject) title = globalData.data.productTitle.fields.subject;
    else if (globalData.offerTitle) title = globalData.offerTitle;
  }

  // 2. Try to extract title from HTML if global data failed
  if (title === "منتج بدون عنوان" || !title) {
    const titleSelectors = [
      'h1',
      '.title',
      '.product-title',
      '.offer-title',
      '[data-spm="dtitle"]',
      '.detail-title',
      '.mod-detail-title',
      'meta[property="og:title"]'
    ];
    
    for (const selector of titleSelectors) {
      let extracted = "";
      if (selector.startsWith('meta')) {
         extracted = $(selector).attr('content');
      } else {
         extracted = $(selector).first().text().trim();
      }
      
      if (extracted && extracted.length > 5) {
        title = extracted.replace(' - 阿里巴巴', '').replace(' - Alibaba', '').trim();
        break;
      }
    }
  }
  
  // 3. Fallback to page title
  if (title === "منتج بدون عنوان" || !title) {
    title = $('title').text()
      .replace(' - 阿里巴巴', '')
      .replace(' - Alibaba', '')
      .trim() || "منتج بدون عنوان";
  }

  // 4. Translate the title
  return await translateProductTitleToArabicAsync(title);
}

async function estimateDimensionsWithAI(title, category = "clothes") {
  // Use default if no API key
  if (!process.env.SILICONFLOW_API_KEY) return "30*20*5"; 
  
  try {
    const prompt = `Estimate the package dimensions (length*width*height in cm) for this product: "${title}".
    
    Rules:
    1. Output format MUST be strictly: L*W*H (e.g. 35*25*3).
    2. If the product is clothing (shirt, dress, pants, etc.), assume it is FOLDED in a polybag. 
       - Height should be small (2-5cm).
       - Typical clothing size: 30*25*3 or 35*28*4.
       - DO NOT estimate a box size for clothes.
    3. If the product is a hard good (shoes, electronics, toys), estimate a BOX size.
    4. Return ONLY the dimension string, nothing else.`;

    const response = await axios.post(
      'https://api.siliconflow.cn/v1/chat/completions',
      {
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 20
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.SILICONFLOW_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    const dimensions = response.data?.choices?.[0]?.message?.content?.trim();
    
    // Validate format
    if (dimensions && /^\d+(\.\d+)?\*\d+(\.\d+)?\*\d+(\.\d+)?$/.test(dimensions)) {
      return dimensions;
    }
    
    // Attempt to extract if there's extra text
    const match = dimensions?.match(/(\d+(\.\d+)?\*\d+(\.\d+)?\*\d+(\.\d+)?)/);
    if (match) return match[1];
    
  } catch (error) {
    console.error("AI Dimension estimation failed:", error.message);
  }
  
  // Fallback defaults based on simple keyword matching
  if (title.includes("coat") || title.includes("jacket") || title.includes("معطف") || title.includes("جاكيت")) {
      return "40*30*10";
  }
  return "30*20*5"; // Standard folded shirt size
}

function extractPrice($, html, globalData) {
  // 1. Try global data
  if (globalData && globalData.data) {
    // Check explicit price field from our mapping
    if (globalData.data.price) {
      return parseFloat(globalData.data.price);
    }
    // Check for price ranges in priceModel (standard 1688 structure)
    // We want the price for 1-2 items (the highest price usually)
    if (globalData.data.priceModel && globalData.data.priceModel.currentPrices) {
        const prices = globalData.data.priceModel.currentPrices;
        if (Array.isArray(prices) && prices.length > 0) {
            // Sort by price descending to get the single item price
            const sorted = prices.map(p => parseFloat(p.price)).filter(p => !isNaN(p) && p > 0).sort((a, b) => b - a);
            if (sorted.length > 0) return sorted[0];
        }
    }
    
    // Check for price ranges
    if (globalData.data.priceRange && globalData.data.priceRange.price) {
      return parseFloat(globalData.data.priceRange.price);
    }
    // Check sku infos
    if (globalData.data.sku && globalData.data.sku.skuMap) {
        const skuMap = globalData.data.sku.skuMap;
        const prices = Object.values(skuMap)
          .map(s => parseFloat(s.price || s.discountPrice || 0))
          .filter(p => p > 0);
        
        if (prices.length > 0) {
            // Return the MAX price to be safe, or at least avoid the cheap accessory price
            return Math.max(...prices);
        }
    }
  }

  // 2. Try specific meta tags or JSON-LD
  const metaPrice = $('meta[property="og:price:amount"]').attr('content');
  if (metaPrice) return parseFloat(metaPrice);

  // 3. Try selectors
  const priceSelectors = [
    '.price-text',
    '.offer-price',
    '.discount-price',
    '.price-original-sku',
    '.obj-price',
    '[itemprop="price"]'
  ];

  for (const selector of priceSelectors) {
    const priceText = $(selector).first().text().trim();
    const match = priceText.match(/([0-9]+(\.[0-9]+)?)/);
    if (match) {
      return parseFloat(match[1]);
    }
  }
  
  return 0; // Return 0 instead of 3160 to indicate failure
}

// Helper to extract specific detail from global data attributes
function extractDetailFromGlobal(globalData, keys) {
    if (!globalData || !globalData.data || !globalData.data.offerParams || !globalData.data.offerParams.offerParamsProps) return null;
    
    const props = globalData.data.offerParams.offerParamsProps; // Array of {name: "Material", value: "Cotton"}
    if (!Array.isArray(props)) return null;

    for (const key of keys) {
        const prop = props.find(p => p.name && (p.name.includes(key) || p.name === key));
        if (prop) return prop.value;
    }
    return null;
}



function translateValue(chineseValue) {
    // Basic translation map for common attribute values
    const map = {
        // Materials
        '棉': 'قطن',
        '涤纶': 'بوليستر',
        '氨纶': 'سباندكس',
        '锦纶': 'نايلون',
        '粘纤': 'فيسكوز',
        '麻': 'كتان',
        '真丝': 'حرير طبيعي',
        '羊毛': 'صوف',
        
        // Colors
        '白色': 'أبيض',
        '黑色': 'أسود',
        '红色': 'أحمر',
        '蓝色': 'أزرق',
        '绿色': 'أخضر',
        '黄色': 'أصفر',
        '粉色': 'وردي',
        '紫色': 'أرجواني',
        '灰色': 'رمادي',
        '棕色': 'بني',
        '卡其色': 'كاكي',
        '杏色': 'مشمشي',
        '米色': 'بيج',
        '酒红色': 'أحمر نبيذي',
        '藏青色': 'كحلي',
        '墨绿色': 'أخضر غامق',
        '军绿色': 'زيتي',
        '天蓝色': 'سماوي',
        '浅紫色': 'أرجواني فاتح',
        '茄紫色': 'باذنجاني',
        '咖啡色': 'بني غامق',
        '花色': 'منقوش',
        '深灰': 'رمادي غامق',
        '浅灰': 'رمادي فاتح',
        '碳灰色': 'رمادي فحمي',
        '暗粉色': 'وردي غامق',
        
        // Sizes/Specs
        '均码': 'مقاس موحد',
        '加大码': 'مقاس كبير',
        
        // Styles/Attributes
        '宽松': 'فضفاض',
        '修身': 'ضيق (Slim)',
        '常规': 'عادي',
        '直筒': 'مستقيم',
        '圆领': 'ياقة دائرية',
        'V领': 'ياقة V',
        '方领': 'ياقة مربعة',
        '立领': 'ياقة واقفة',
        'POLO领': 'ياقة بولو',
        '短袖': 'أكمام قصيرة',
        '长袖': 'أكمام طويلة',
        '五分袖': 'نصف كم',
        '七分袖': 'كم 3/4',
        '无袖': 'بدون أكمام',
        '夏季': 'الصيف',
        '秋季': 'الخريف',
        '冬季': 'الشتاء',
        '春季': 'الربيع',
        '四季': 'كل المواسم'
    };
    
    let result = chineseValue;
    for (const [key, val] of Object.entries(map)) {
        if (result === key) return val; // Exact match priority
        if (result.includes(key)) {
            result = result.replace(key, val);
        }
    }
    return result;
}

function translateProductTitleToArabic(title) {
  return title; // Temporary bypass to allow async function replacement
}

async function translateProductTitleToArabicAsync(title) {
  if (!title || title === "Untitled Product") {
    return "منتج بدون عنوان";
  }

  // 1. If it looks like it's already mostly Arabic, just clean it up
  const arabicCharCount = (title.match(/[\u0600-\u06FF]/g) || []).length;
  const chineseCharCount = (title.match(/[\u4e00-\u9fa5]/g) || []).length;
  
  if (arabicCharCount > 10 && chineseCharCount < 2) {
    return title.replace(/[^\u0600-\u06FF\s0-9a-zA-Z\-!%]/g, '').trim();
  }

  // 2. Try SiliconFlow API (DeepSeek/Qwen)
  if (process.env.SILICONFLOW_API_KEY) {
    try {
      const response = await axios.post(
        'https://api.siliconflow.cn/v1/chat/completions',
        {
          model: "Qwen/Qwen2.5-7B-Instruct", // Fast and good for translation
          messages: [
            {
              role: "system",
              content: "You are a professional translator for an e-commerce store in Iraq. Translate the following product title from Chinese/English to professional Arabic. Remove any internal codes. Ensure NO Chinese characters remain. Use commercially attractive terms (e.g. 'فستان' instead of 'ثوب'). Output ONLY the translated title."
            },
            {
              role: "user",
              content: title
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.SILICONFLOW_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const translated = response.data?.choices?.[0]?.message?.content?.trim();
      if (translated && translated.length > 5) {
        return translated.replace(/[^\u0600-\u06FF\s0-9a-zA-Z\-!%]/g, '').trim();
      }
    } catch (error) {
      console.error("SiliconFlow translation failed, falling back to dictionary:", error.message);
    }
  }

  // 3. Fallback: Dictionary-based translation
  // Common Chinese to Arabic translations for fashion products
  const translations = {
    "清仓不退": "تخفيضات نهائية - لا استرجاع",
    "波点": "منقط ",
    "围巾": "وشاح ",
    "小狗": "كلب صغير ",
    "印花": "مطبوع ",
    "T恤": "تي شيرت ",
    "t恤": "تي شيرت ",
    "女": "نسائي ",
    "十三行": "شانغهاي ",
    "女装": "ملابس نسائية ",
    "秋季": "خريفي ",
    "短袖": "أكمام قصيرة ",
    "上衣": "بلوزة ",
    "连衣裙": "فساتين ",
    "外套": "معاطف ",
    "毛衣": "سترات صوفية ",
    "裤子": "بنطلون ",
    "裙子": "تنانير ",
    "衬衫": "قمصان ",
    "卫衣": "هوديس ",
    "牛仔裤": "جينز ",
    "打底衫": "ملابس داخلية ",
    "套装": "طقم ",
    "大衣": "معطف طويل ",
    "羽绒服": "سترة واقية ",
    "皮衣": "سترة جلدية ",
    "风衣": "معطف رياح ",
    "西装": "بدلة ",
    "马甲": "صديري ",
    "背心": "توب ",
    "吊带": "حمالات ",
    "蕾丝": "دانتيل ",
    "雪纺": "شيفون ",
    "棉": "قطن ",
    "涤纶": "بوليستر ",
    "羊毛": "صوف ",
    "丝绸": "حرير ",
    "麻": "كتان ",
    "春季": "ربيعي ",
    "夏季": "صيفي ",
    "冬季": "شتوي ",
    "新款": "موديل جديد ",
    "时尚": "عصري ",
    "潮流": "موضة ",
    "百搭": "متعدد الاستخدامات ",
    "修身": "مخصر ",
    "宽松": "فضفاض ",
    "显瘦": "يظهر النحافة ",
    "气质": "أنيق ",
    "优雅": "راقي ",
    "性感": "مثير ",
    "可爱": "لطيف ",
    "简约": "بسيط ",
    "复古": "ريترو ",
    "韩版": "نمط كوري ",
    "欧美": "نمط أوروبي ",
    "日系": "نمط ياباني ",
    "中国风": "نمط صيني ",
    "徳绒": "فيلور الألماني ",
    "大码": "مقاس كبير ",
    "纯欲风": "نمط بريء ومثير ",
    "v领": "ياقة على شكل V ",
    "内搭": "ملابس داخلية ",
    "正肩": "كتف مستقيم ",
    "秋冬": "خريفي وشتوي ",
    "长袖": "أكمام طويلة ",
    "上衣": "بلوزة ",
    "内搭": "طبقة داخلية ",
    "正肩": "تلبيسة كتف ",
    "打底": "قاعدة ",
    "衫": "قميص ",
    "风": "نمط ",
    "纯": "نقي ",
    "欲": "رغبة ",
    "码": "مقاس ",
    "大": "كبير ",
    "纯欲": "براءة وإثارة ",
    "领": "ياقة ",
    "肩": "كتف ",
    "正": "مستقيم ",
    "袖": "كم ",
    "长": "طويل ",
    "短": "قصير ",
    "秋冬": "خريف وشتاء ",
    "春夏": "ربيع وصيف "
  };
  
  // Translate Chinese terms to Arabic
  let arabicTitle = title;
  for (const [chinese, arabic] of Object.entries(translations)) {
    if (arabicTitle.includes(chinese)) {
      arabicTitle = arabicTitle.replace(chinese, arabic);
    }
  }
  
  // Clean up any remaining special characters
  arabicTitle = arabicTitle
    .replace(/【/g, ' (')
    .replace(/】/g, ') ')
    .replace(/[【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Clean up multiple spaces and ensure proper Arabic formatting
  arabicTitle = arabicTitle
    .replace(/\s+/g, ' ')
    .trim();
  
  return arabicTitle;
}



function extractImages($, globalData) {
  const images = [];
  
  // 1. Try to extract from globalData (Most reliable)
  if (globalData && globalData.data) {
    const offerImgList = globalData.data.offerImgList || 
                        (globalData.data.tempModel && globalData.data.tempModel.offerImgList) ||
                        (globalData.data.offerParams && globalData.data.offerParams.offerImgList);
                        
    if (Array.isArray(offerImgList)) {
      offerImgList.forEach(img => {
        if (img && typeof img === 'string') {
          // Clean up URL
          let src = img;
          if (src.startsWith('//')) src = 'https:' + src;
          
          // Ensure it's a high-quality image
          if (!src.includes('.summ.') && !src.includes('60x60')) {
             images.push(src);
          }
        }
      });
    }
  }
  
  if (images.length > 0) {
    return images.slice(0, 15);
  }

  // 2. Fallback to HTML scraping if globalData fails
  // More specific selectors for actual product images
  const imageSelectors = [
    // Main product image containers
    '.image-view img',
    '.product-image img',
    '.detail-img img',
    '.main-img',
    '.thumb-img',
    '.swiper-slide img',
    '.image-item img',
    '.offer-image img',
    '.sku-image img',
    
    // High-resolution product images (look for specific patterns)
    'img[src*=".jpg"]',
    'img[src*=".jpeg"]',
    'img[src*=".png"]',
    'img[src*=".webp"]',
    'img[src*="alicdn.com/imgextra"]',
    'img[src*="alicdn.com/img"]',
    'img[src*="cbu01.alicdn.com"]',
    'img[src*="offerimg"]',
    'img[src*="productimg"]',
    
    // Data attributes that might contain real image URLs
    'img[data-src*=".jpg"]',
    'img[data-src*=".jpeg"]',
    'img[data-src*=".png"]',
    'img[data-src*=".webp"]',
    'img[data-src*="alicdn"]'
  ];
  
  // Also look for image URLs in JavaScript data
  const html = $.html();
  const imagePatterns = [
    /https:\/\/[^"']*\.(jpg|jpeg|png|webp)(?:\?[^"']*)?/gi,
    /"imageUrl"\s*:\s*"([^"]+)"/gi,
    /"picUrl"\s*:\s*"([^"]+)"/gi,
    /"img"\s*:\s*"([^"]+)"/gi,
    /"url"\s*:\s*"([^"]+)"/gi
  ];
  
  // Extract from CSS selectors
  imageSelectors.forEach(selector => {
    $(selector).each((i, elem) => {
      let src = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('data-ks-lazyload');
      if (src) {
        // Clean up the URL
        if (src.startsWith('//')) {
          src = 'https:' + src;
        } else if (src.startsWith('/')) {
          src = 'https://detail.1688.com' + src;
        }
        
        // Only include high-quality product images (filter out icons, logos, placeholders)
        if (src.includes('http') && 
            !src.includes('logo') && 
            !src.includes('icon') && 
            !src.includes('placeholder') &&
            !src.includes('loading') &&
            (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp')) &&
            !images.includes(src)) {
          images.push(src);
        }
      }
    });
  });
  
  // Extract from JavaScript patterns
  imagePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let src = match[0] || match[1];
      if (src) {
        if (src.startsWith('//')) {
          src = 'https:' + src;
        }
        
        // Filter for product images only
        if (src.includes('alicdn') && 
            (src.includes('.jpg') || src.includes('.jpeg') || src.includes('.png') || src.includes('.webp')) &&
            !src.includes('logo') && 
            !src.includes('icon') &&
            !images.includes(src)) {
          images.push(src);
        }
      }
    }
  });
  
  // Remove duplicates and return only high-quality product images
  const uniqueImages = [...new Set(images)];
  
  // STRICT filtering to only include actual high-resolution product images
  const productImages = uniqueImages.filter(img => {
    // EXCLUDE all small icons, logos, placeholders, and decorative images
    if (
      // Exclude all small tps icons (16x16, 24x24, 32x32, 48x48, 58x58, 64x64)
      img.includes('-tps-') ||
      
      // Exclude any image with small dimensions in the URL
      /-\d+-\d+\.(jpg|jpeg|png|webp)/i.test(img) ||
      
      // Exclude logos and icons
      img.includes('logo') ||
      img.includes('icon') ||
      img.includes('placeholder') ||
      img.includes('loading') ||
      img.includes('spinner') ||
      img.includes('arrow') ||
      img.includes('close') ||
      img.includes('menu') ||
      img.includes('cart') ||
      img.includes('search') ||
      img.includes('user') ||
      img.includes('home') ||
      img.includes('share') ||
      
      // Exclude very short URLs (likely icons)
      img.length < 80 ||
      
      // Exclude images with specific patterns that indicate icons
      /O1CN[0-9A-Za-z]+[0-9A-Za-z_!@#$%^&*()]+-2-tps-/.test(img) ||
      
      // Exclude small resolution thumbnails (220x220, 310x310, summ)
      /\.(220x220|310x310|summ)\.(jpg|jpeg|png|webp)/i.test(img) ||
      
      // Exclude malformed URLs with imageUrl wrapper
      /"imageUrl":"[^"]*"/.test(img) ||
      img.includes('"imageUrl":')
    ) {
      return false;
    }
    
    // ONLY INCLUDE images that are definitely product photos
    return (
      // High-quality product images from alicdn (main product photos)
      (img.includes('cbu01.alicdn.com/img/ibank') && img.includes('-cib.')) ||
      
      // Large product images from imgextra (not icons)
      (img.includes('alicdn.com/imgextra') && 
       !img.includes('-tps-') &&
       img.length > 120 &&
       !/O1CN[0-9A-Za-z]+[0-9A-Za-z_!@#$%^&*()]+-2-tps-/.test(img)) ||
      
      // Product detail images (usually larger files)
      (img.includes('offerimg') || img.includes('productimg')) ||
      
      // High-resolution images with proper file extensions and reasonable length
      ((img.includes('.jpg') || img.includes('.jpeg') || img.includes('.webp')) && 
       img.length > 100 &&
       !img.includes('-tps-') &&
       !/O1CN[0-9A-Za-z]+[0-9A-Za-z_!@#$%^&*()]+-2-tps-/.test(img)) ||
      
      // PNG images that are actual product photos (not icons)
      (img.includes('.png') && 
       img.length > 120 && 
       !img.includes('-tps-') &&
       !/O1CN[0-9A-Za-z]+[0-9A-Za-z_!@#$%^&*()]+-2-tps-/.test(img))
    );
  });
  
  return productImages.slice(0, 15); // Return max 15 high-quality product images
}

function extractMaterial($, html, globalData, title) {
  // 1. Try global data first
  const fromGlobal = extractDetailFromGlobal(globalData, ['面料', '材质', 'Fabric', 'Material']);
  if (fromGlobal) return translateMaterialToArabic(fromGlobal);

  // 2. First try to find material in specific HTML elements
  const materialSelectors = [
    '.material-detail',
    '.material-info',
    '.fabric-info',
    '[data-spm="material"]',
    '.offer-material',
    '.detail-material',
    '.mod-detail-material'
  ];
  
  for (const selector of materialSelectors) {
    const materialText = $(selector).first().text().trim();
    if (materialText && materialText.length > 2 && !materialText.includes('{') && !materialText.includes('[')) {
      // Clean and translate the material
      return translateMaterialToArabic(materialText);
    }
  }
  
  // If not found in HTML elements, try very specific regex patterns
  const specificMaterialPatterns = [
    /材质[:：]\s*([^\n<\[\{]{1,50}?)(?=[\n<\[\{]|$)/,
    /面料[:：]\s*([^\n<\[\{]{1,50}?)(?=[\n<\[\{]|$)/,
    /material[:]\s*([^\n<\[\{]{1,50}?)(?=[\n<\[\{]|$)/i
  ];
  
  for (const pattern of specificMaterialPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const material = match[1].trim();
      if (material && material.length > 1 && !material.includes('{') && !material.includes('[')) {
        return translateMaterialToArabic(material);
      }
    }
  }

  // 4. Try to infer from Title (Fallback)
  if (title) {
      if (title.includes('قطن') || title.toLowerCase().includes('cotton')) return "قطن";
      if (title.includes('صوف') || title.toLowerCase().includes('wool')) return "صوف";
      if (title.includes('بوليستر') || title.toLowerCase().includes('polyester')) return "بوليستر";
      if (title.includes('حرير') || title.toLowerCase().includes('silk')) return "حرير";
      if (title.includes('كتان') || title.toLowerCase().includes('linen')) return "كتان";
      if (title.includes('جينز') || title.toLowerCase().includes('denim')) return "جينز";
  }
  
  return "نسيج محبوك ناعم"; // Arabic default
}

function translateMaterialToArabic(material) {
  // Common material translations
  const materialTranslations = {
    "棉": "قطن",
    "涤纶": "بوليستر", 
    "尼龙": "نايلون",
    "羊毛": "صوف",
    "丝绸": "حرير",
    "麻": "كتان",
    "氨纶": "سباندكس",
    "锦纶": "نايلون",
    "聚酯纤维": "ألياف البوليستر",
    "纯棉": "قطن نقي",
    "涤棉": "بوليستر وقطن",
    "全棉": "قطن كامل",
    "针织": "محبوك",
    "梭织": "منسوج",
    "雪纺": "شيفون",
    "牛仔": "دنيم",
    "蕾丝": "دانتيل",
    "网眼": "شبكي"
  };
  
  // Translate common materials to Arabic
  let translatedMaterial = material;
  for (const [chinese, arabic] of Object.entries(materialTranslations)) {
    if (material.includes(chinese)) {
      translatedMaterial = material.replace(chinese, arabic);
      break;
    }
  }
  
  return translatedMaterial;
}

function extractDesign($, html, globalData) {
  const design = extractDetailFromGlobal(globalData, ['图案', '图案文化', '款式']);
  if (design) return translateValue(design);
  return "لون سادة بسيط"; // Fallback
}

function extractFit($, html, globalData) {
  const fit = extractDetailFromGlobal(globalData, ['版型']);
  if (fit) return translateValue(fit);
  return "قصة ضيقة مخصرة"; // Fallback
}

function extractCollar($, html, globalData) {
  const collar = extractDetailFromGlobal(globalData, ['领型']);
  if (collar) return translateValue(collar);
  return "ياقة دائرية"; // Fallback
}

function extractSleeves($, html, globalData) {
  const sleeves = extractDetailFromGlobal(globalData, ['袖长', '袖型']);
  if (sleeves) return translateValue(sleeves);
  return "أكمام قصيرة"; // Fallback
}

function extractFeatures($, html, globalData) {
  const style = extractDetailFromGlobal(globalData, ['风格']);
  const elements = extractDetailFromGlobal(globalData, ['流行元素']);
  const features = [];
  if (style) features.push(translateValue(style));
  if (elements) features.push(translateValue(elements));
  
  if (features.length > 0) return features.join(" - ");
  return "تصميم عصري"; // Fallback
}

function extractSeason($, html, globalData) {
  const season = extractDetailFromGlobal(globalData, ['季节', '适用季节', '上市年份/季节']);
  if (season) return translateValue(season);
  return "صيف 2025"; // Fallback
}

function extractLength($, html, globalData) {
  const length = extractDetailFromGlobal(globalData, ['衣长']);
  if (length) return translateValue(length);
  return "طول عادي"; // Fallback
}

function extractWeight(globalData) {
  if (globalData && globalData.data && globalData.data.productPackInfo) {
      // Check for pieceWeightScale directly or inside fields
      const packInfo = globalData.data.productPackInfo;
      const weightScale = packInfo.pieceWeightScale || (packInfo.fields && packInfo.fields.pieceWeightScale);
      
      if (weightScale && weightScale.pieceWeightScaleInfo) {
          const info = weightScale.pieceWeightScaleInfo;
          if (Array.isArray(info) && info.length > 0) {
              // Calculate average weight
              const totalWeight = info.reduce((sum, item) => sum + (parseFloat(item.weight) || 0), 0);
              const avgWeightGrams = totalWeight / info.length;
              // Convert to kg and string
              return (avgWeightGrams / 1000).toFixed(2);
          }
      }
  }
  return "0.5";
}

function extractDimensions(globalData) {
  if (globalData && globalData.data && globalData.data.productPackInfo) {
      const packInfo = globalData.data.productPackInfo;
      const weightScale = packInfo.pieceWeightScale || (packInfo.fields && packInfo.fields.pieceWeightScale);

      if (weightScale && weightScale.pieceWeightScaleInfo) {
          const info = weightScale.pieceWeightScaleInfo;
          if (Array.isArray(info) && info.length > 0) {
              // Take dimensions from the first item (usually same for all)
              const item = info[0];
              if (item.length && item.width && item.height) {
                  return `${item.length}*${item.width}*${item.height}`;
              }
          }
      }
  }
  return "";
}

function extractVariants(globalData) {
  const variants = {
    sizes: [],
    colors: []
  };
  
  // 1. Try skuModel (standard 1688 structure)
  if (globalData && globalData.data && globalData.data.skuModel && globalData.data.skuModel.skuProps) {
    const skuProps = globalData.data.skuModel.skuProps;
    
    skuProps.forEach(prop => {
      const propName = prop.propName || prop.name || prop.prop;
      const values = prop.value || prop.values;
      
      if (!values || !Array.isArray(values)) return;
      
      const extractedValues = values.map(v => v.name).filter(Boolean);
      
      // Check if it's size or color
      if (propName && (propName.includes('规格') || propName.includes('尺寸') || propName.toLowerCase().includes('size') || propName.includes('尺码'))) {
         variants.sizes = extractedValues.map(s => translateValue(s));
      } else if (propName && (propName.includes('颜色') || propName.toLowerCase().includes('color'))) {
         variants.colors = extractedValues.map(c => translateValue(c));
      }
    });
  }
  
  // 2. Try productPackInfo (pieceWeightScale structure - common in 2025)
  if ((variants.sizes.length === 0 || variants.colors.length === 0) && 
      globalData && globalData.data && globalData.data.productPackInfo) {
      
      const packInfo = globalData.data.productPackInfo;
      const weightScale = packInfo.pieceWeightScale || (packInfo.fields && packInfo.fields.pieceWeightScale);

      if (weightScale && weightScale.pieceWeightScaleInfo) {
          const info = weightScale.pieceWeightScaleInfo;
          const uniqueColors = new Set();
          const uniqueSizes = new Set();
          
          info.forEach(item => {
              // Extract Color from sku1
              if (item.sku1) {
                  const match = item.sku1.match(/【(.*?)】/);
                  if (match) uniqueColors.add(match[1]);
                  else uniqueColors.add(item.sku1);
              }
              
              // Extract Size from sku2
              if (item.sku2) {
                  const match = item.sku2.match(/^(.*?)【/);
                  if (match) uniqueSizes.add(match[1]);
                  else uniqueSizes.add(item.sku2);
              }
          });
          
          if (variants.colors.length === 0 && uniqueColors.size > 0) {
              variants.colors = Array.from(uniqueColors).map(c => translateValue(c));
          }
          
          if (variants.sizes.length === 0 && uniqueSizes.size > 0) {
              variants.sizes = Array.from(uniqueSizes).map(s => translateValue(s));
          }
      }
  }
  
  // 3. Try productPackInfo (older structure)
  if ((variants.sizes.length === 0 || variants.colors.length === 0) && 
      globalData && globalData.data && globalData.data.productPackInfo) {
      
      const info = globalData.data.productPackInfo;
      if (info.skuList && info.columnList) {
          // Identify columns
          let colorKey = null;
          let sizeKey = null;
          
          info.columnList.forEach(col => {
              if (col.label.includes('颜色')) colorKey = col.name;
              if (col.label.includes('尺码') || col.label.includes('规格')) sizeKey = col.name;
          });
          
          const uniqueColors = new Set();
          const uniqueSizes = new Set();
          
          info.skuList.forEach(sku => {
              if (colorKey && sku[colorKey]) {
                  let val = sku[colorKey];
                  const match = val.match(/【(.*?)】/);
                  uniqueColors.add(match ? match[1] : val);
              }
              if (sizeKey && sku[sizeKey]) {
                  let val = sku[sizeKey];
                  const match = val.match(/^(.*?)【/);
                  uniqueSizes.add(match ? match[1] : val);
              }
          });
          
          if (variants.colors.length === 0 && uniqueColors.size > 0) {
              variants.colors = Array.from(uniqueColors).map(c => translateValue(c));
          }
          
          if (variants.sizes.length === 0 && uniqueSizes.size > 0) {
              variants.sizes = Array.from(uniqueSizes).map(s => translateValue(s));
          }
      }
  }

  // 4. Try product.skuProps (if skuModel is missing but product exists)
  if ((variants.sizes.length === 0 || variants.colors.length === 0) && 
      globalData && globalData.data && globalData.data.product && globalData.data.product.skuProps) {
    const skuProps = globalData.data.product.skuProps;
    skuProps.forEach(prop => {
      const propName = prop.propName || prop.name;
      const values = prop.value || prop.values;
      
      if (!values || !Array.isArray(values)) return;
      
      const extractedValues = values.map(v => v.name).filter(Boolean);
      
      if (propName && (propName.includes('规格') || propName.includes('尺寸') || propName.toLowerCase().includes('size'))) {
         variants.sizes = extractedValues.map(s => translateValue(s));
      } else if (propName && (propName.includes('颜色') || propName.toLowerCase().includes('color'))) {
         variants.colors = extractedValues.map(c => translateValue(c));
      }
    });
  }

  // Debug logging if variants are still empty
  if (variants.sizes.length === 0 && variants.colors.length === 0) {
    // console.log("⚠️ Variants not found. Inspecting available data keys:");
  }
  
  return variants;
}


// Main scraping function
async function scrapeIndividualProducts(productUrls) {
  console.log("🚀 Starting Individual Product Scraper...");
  console.log("📦 Products to scrape:", productUrls.length);
  console.log("================================================================================");
  
  const products = [];
  const adminResults = [];
  
  for (let i = 0; i < productUrls.length; i++) {
    const productUrl = productUrls[i];
    console.log(`\n🔄 Processing product ${i + 1}/${productUrls.length}...`);
    console.log("📄 URL:", productUrl);
    
    let productData = await getProductDetails(productUrl);
    let attempt = 1;
    while (
      attempt < 3 &&
      productData &&
      (!productData.product_name ||
        productData.product_name === "Untitled Product" ||
        productData.product_name === "منتج بدون عنوان" ||
        ((!productData.variants?.colors || productData.variants.colors.length === 0) &&
          (!productData.variants?.sizes || productData.variants.sizes.length === 0)))
    ) {
      const waitTime = 2500 + Math.random() * 2500;
      console.log(`🔁 Incomplete data detected (attempt ${attempt}/3). Retrying after ${Math.round(waitTime / 1000)}s...`);
      await delay(waitTime);
      attempt += 1;
      productData = await getProductDetails(productUrl);
    }
    
    if (productData) {
      products.push(productData);
      console.log(`✅ Product scraped successfully`);

      const hasPlaceholderName =
        !productData.product_name ||
        productData.product_name === "Untitled Product" ||
        productData.product_name === "منتج بدون عنوان";
      const hasNoVariants =
        (!productData.variants?.colors || productData.variants.colors.length === 0) &&
        (!productData.variants?.sizes || productData.variants.sizes.length === 0);
      
      try {
        if (hasPlaceholderName || hasNoVariants) {
          throw new Error('Incomplete product data after retries');
        }
        console.log("📤 Posting to admin dashboard as draft...");
        const adminResult = await postProductToAdmin(productData);
        adminResults.push({
          product: productData.title_en || productData.product_name,
          success: true,
          result: adminResult
        });
        console.log("✅ Successfully posted to admin dashboard");
      } catch (adminError) {
        console.error("❌ Failed to post to admin dashboard:", adminError.message);
        adminResults.push({
          product: productData.title_en || productData.product_name,
          success: false,
          error: adminError.message
        });
      }
    }
    
    // Add delay between products
    if (i < productUrls.length - 1) {
      const waitTime = 5000 + Math.random() * 5000; // Increased delay to 5-10s
      console.log(`⏳ Waiting ${Math.round(waitTime/1000)}s before next product...`);
      await delay(waitTime);
    }
  }
  
  // Save results
  const result = { products, adminResults };
  const timestamp = Date.now();
  const filename = `1688-individual-products-${timestamp}.json`;
  
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  
  console.log("\n✅ INDIVIDUAL PRODUCT SCRAPING COMPLETED!");
  console.log("📊 Total products scraped:", products.length);
  console.log("💾 Results saved to:", filename);
  console.log("📁 File path:", `${process.cwd()}\\${filename}`);
  
  // Show admin dashboard posting results
  console.log("\n📊 ADMIN DASHBOARD POSTING RESULTS:");
  const successfulPosts = adminResults.filter(r => r.success).length;
  const failedPosts = adminResults.filter(r => !r.success).length;
  console.log(`✅ Successfully posted: ${successfulPosts}`);
  console.log(`❌ Failed to post: ${failedPosts}`);
  
  if (failedPosts > 0) {
    console.log("\n❌ Failed products:");
    adminResults.filter(r => !r.success).forEach((item, index) => {
      console.log(`${index + 1}. ${item.product}: ${item.error}`);
    });
  }
  
  return result;
}

// Parse command line arguments for URLs
function parseCommandLineUrls(args) {
  // Strategy: Process arguments individually (respecting shell splitting)
  let urls = [];
  
  for (const arg of args) {
    // Clean up the argument - remove quotes, backticks, and surrounding whitespace
    const cleanArg = arg
      .replace(/[`"']/g, '') // Remove quotes and backticks
      .trim();
      
    if (!cleanArg) continue;

    // Check if it contains multiple URLs (e.g. pasted as one string)
    // This handles cases where user pastes a list "url1 url2" as a single argument
    if (cleanArg.match(/https?:\/\//g)?.length > 1) {
       // Split by common separators if multiple http found
       const parts = cleanArg.split(/[\s,;]+/);
       parts.forEach(p => {
         const cleanPart = p.replace(/[`"']/g, '').trim();
         const match = cleanPart.match(/(https?:\/\/[^\s`"']+)/);
         if (match) {
           urls.push(match[1]);
         }
       });
    } else {
       // Single URL candidate
       // Extract just the URL part if there's surrounding junk
       const match = cleanArg.match(/(https?:\/\/[^\s`"']+)/);
       if (match) {
         urls.push(match[1]);
       }
    }
  }

  // Deduplicate
  return [...new Set(urls)];
}

// Get and parse product URLs from command line arguments
const productUrls = parseCommandLineUrls(process.argv.slice(2));

if (productUrls.length === 0) {
  console.log("\n📝 USAGE:");
  console.log("node individual-product-scraper.cjs \"https://detail.1688.com/offer/123456789.html\"");
  console.log("node individual-product-scraper.cjs \"link1\"\"link2\"\"link3\"");
  console.log("node individual-product-scraper.cjs link1 link2 link3");
  console.log("\n💡 You can paste multiple URLs in these formats:");
  console.log("• Single URL: \"https://detail.1688.com/offer/123456789.html\"");
  console.log("• Multiple in quotes: \"link1\"\"link2\"\"link3\"");
  console.log("• Space separated: link1 link2 link3");
  
  process.exit(1);
}

// Main execution - scrape and insert to database
async function main() {
  console.log("🚀 Starting product scraping with automatic database insertion...\n");
  
  const allProducts = [];

  const isIncompleteProduct = (p) => {
    if (!p) return true;
    const name = String(p.product_name || '').trim();
    const hasPlaceholderName = !name || name === 'Untitled Product' || name === 'منتج بدون عنوان';
    const colorsCount = Array.isArray(p.variants?.colors) ? p.variants.colors.length : 0;
    const sizesCount = Array.isArray(p.variants?.sizes) ? p.variants.sizes.length : 0;
    const hasNoVariants = colorsCount === 0 && sizesCount === 0;
    const imagesCount = Array.isArray(p.main_images) ? p.main_images.length : 0;
    const hasNoImages = imagesCount === 0;
    return hasPlaceholderName || hasNoVariants || hasNoImages;
  };
  
  for (const url of productUrls) {
    try {
      console.log(`🔗 Processing: ${url}`);
      
      // 1. Scrape the product
      let productData = await getProductDetails(url);
      let attempt = 1;
      while (
        attempt < 3 &&
        productData &&
        isIncompleteProduct(productData)
      ) {
        const waitTime = 2500 + Math.random() * 2500;
        console.log(`🔁 Incomplete data detected (attempt ${attempt}/3). Retrying after ${Math.round(waitTime / 1000)}s...`);
        await delay(waitTime);
        attempt += 1;
        productData = await getProductDetails(url);
      }
      
      if (productData) {
        if (isIncompleteProduct(productData)) {
          console.log("⚠️  Skipped database insertion due to incomplete scraped data\n");
          allProducts.push({
            scraped: productData,
            database: null,
            incomplete: true
          });
          await delay(3000 + Math.random() * 2000);
          continue;
        }
        console.log(`✅ Successfully scraped: ${productData.product_name}`);
        
        // 2. Insert into database
        const insertedProduct = await insertProductToDatabase(productData);
        
        if (insertedProduct && insertedProduct.id) {
          console.log(`📊 Database insertion successful for product ID: ${insertedProduct.id}\n`);
          allProducts.push({
            scraped: productData,
            database: insertedProduct
          });
        } else if (insertedProduct) {
          // This is a duplicate product that already exists
          console.log(`⏭️  Skipped duplicate product that already exists in database\n`);
          allProducts.push({
            scraped: productData,
            database: insertedProduct,
            duplicate: true
          });
        } else {
          console.log("⚠️  Database insertion failed, but product was scraped successfully\n");
          allProducts.push({
            scraped: productData,
            database: null
          });
        }
        
        // Add delay between requests
        await delay(3000 + Math.random() * 2000);
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${url}: ${error.message}\n`);
    }
  }
  
  console.log("🎯 All products processed!");
  console.log(`📋 Total products: ${allProducts.length}`);
  console.log(`✅ Successful database insertions: ${allProducts.filter(p => p.database).length}`);
  
  return allProducts;
}

// Execute main function
main()
  .then(() => {
    console.log("✨ Scraping and database insertion completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fatal error:", error.message);
    process.exit(1);
  });
