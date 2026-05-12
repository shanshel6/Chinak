import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import axios from 'axios';
import http from 'http';
import https from 'https';
import { ensureProductImageEmbeddings } from '../services/productImageVectorService.js';
import { embedImage } from '../services/clipService.js';
import { sanitizeProductImageUrl } from '../services/productImageVectorService.js';

const QUEUE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../product-queue');
const USE_QUEUE_MODE = String(process.env.GOOFISH_USE_QUEUE || '').toLowerCase() === 'true';

// Initialize queue directory
async function initQueueDir() {
  try {
    await fsPromises.mkdir(QUEUE_DIR, { recursive: true });
    console.log('[Queue] Queue directory initialized');
  } catch (err) {
    console.error('[Queue] Failed to initialize queue directory:', err);
  }
}

// Save product data to queue file
async function saveToQueue(accumulatedData) {
  try {
    const itemId = accumulatedData.url.match(/id=(\d+)/)?.[1] || Date.now().toString();
    const filePath = join(QUEUE_DIR, `${itemId}.json`);
    
    const productData = {
      itemId,
      url: accumulatedData.url,
      name: accumulatedData.name,
      originalTitle: accumulatedData.originalName || null,
      priceCny: accumulatedData.priceCny,
      newOrOld: accumulatedData.newOrOld,
      description: accumulatedData.description,
      specs: accumulatedData.specs,
      images: accumulatedData.images,
      imageEmbeddings: accumulatedData.imageEmbeddings || [],
      categoryId: accumulatedData.categoryId,
      soldCount: accumulatedData.soldCount,
      isActive: accumulatedData.isActive,
      scrapedAt: new Date().toISOString()
    };
    
    await fsPromises.writeFile(filePath, JSON.stringify(productData, null, 2));
    console.log(`[Queue] Saved product ${itemId} to queue`);
    return true;
  } catch (err) {
    console.error(`[Queue] Failed to save product to queue: ${err.message}`);
    return false;
  }
}

// Helper function to convert vector to SQL literal
function vectorToSqlLiteral(vector) {
  return `[${vector.join(',')}]`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath, override: false });

// Category assignment paths
const SEED_PATH = path.join(__dirname, 'canonical-categories.seed.json');
const MAPPINGS_PATH = path.join(__dirname, 'goofish-category-mappings.json');

// Custom search terms path
const CUSTOM_TERMS_PATH = path.join(__dirname, '..', '..', 'custom-search-terms.json');

// Load custom terms if available
function loadCustomTerms() {
  try {
    if (fs.existsSync(CUSTOM_TERMS_PATH)) {
      const terms = JSON.parse(fs.readFileSync(CUSTOM_TERMS_PATH, 'utf8'));
      if (Array.isArray(terms) && terms.length > 0) {
        console.log(`[Custom Terms] Loaded ${terms.length} custom search terms from ${CUSTOM_TERMS_PATH}`);
        return terms;
      }
    }
  } catch (err) {
    console.error(`[Custom Terms] Error loading custom terms: ${err.message}`);
  }
  return null;
}

let customTerms = null;

const CNY_TO_IQD_RATE = 200;

const withDbParams = (url) => {
  if (!url) return '';
  const parsed = new URL(url);
  if (!parsed.searchParams.has('connection_limit')) parsed.searchParams.set('connection_limit', '3');
  if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', '300');
  if (!parsed.searchParams.has('connect_timeout')) parsed.searchParams.set('connect_timeout', '120');
  if (!parsed.searchParams.has('keepalives')) parsed.searchParams.set('keepalives', '1');
  if (!parsed.searchParams.has('keepalives_idle')) parsed.searchParams.set('keepalives_idle', '30');
  if (!parsed.searchParams.has('keepalives_interval')) parsed.searchParams.set('keepalives_interval', '10');
  if (!parsed.searchParams.has('keepalives_count')) parsed.searchParams.set('keepalives_count', '3');
  if (!parsed.searchParams.has('sslmode')) parsed.searchParams.set('sslmode', 'require');
  return parsed.toString();
};

const prismaDbUrl = withDbParams(
  String(process.env.GOOFISH_DATABASE_URL || process.env.DATABASE_URL || '').trim()
);

console.log('[DB] Database URL being used:', prismaDbUrl.replace(/:[^:@]+@/, ':****@'));

// We must override the direct connection parameters specifically for Prisma
if (process.env.GOOFISH_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.GOOFISH_DATABASE_URL;
}

const createPrismaClient = () => (prismaDbUrl
  ? new PrismaClient({ datasources: { db: { url: prismaDbUrl } } })
  : new PrismaClient());
let prisma = createPrismaClient();
export function calculatePriceMultiplier(basePriceIQD) {
  return 1.25;
}

const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || '').trim();
console.log(`[Debug] SILICONFLOW_API_KEY is set: ${SILICONFLOW_API_KEY ? 'YES (length=' + SILICONFLOW_API_KEY.length + ')' : 'NO'}`);

const DISABLE_DB_WRITE = String(process.env.GOOFISH_DISABLE_DB_WRITE || '').toLowerCase() === 'true';
const configuredMaxProducts = parseInt(process.env.GOOFISH_MAX_PRODUCTS || '', 10);

// Category assignment config
const CATEGORY_ASSIGN_ENABLED = String(process.env.GOOFISH_CATEGORY_ASSIGN || 'true').toLowerCase() === 'true';
const CATEGORY_AI_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.CATEGORY_AI_RATE_LIMIT_DELAY_MS || '200', 10) || 200);
const CATEGORY_API_TIMEOUT_MS = parseInt(process.env.CATEGORY_API_TIMEOUT_MS || '120000', 10);
const CATEGORY_MODEL = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507';

// Load category data
let categories = [];
let goofishMappings = {};

function loadCategoryData() {
  try {
    if (fs.existsSync(SEED_PATH)) {
      categories = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
      console.log(`[Category] Loaded ${categories.length} categories`);
    } else {
      console.warn(`[Category] No seed file found at ${SEED_PATH}`);
    }
  } catch (err) {
    console.error(`[Category] Error loading seed file: ${err.message}`);
  }

  try {
    if (fs.existsSync(MAPPINGS_PATH)) {
      goofishMappings = JSON.parse(fs.readFileSync(MAPPINGS_PATH, 'utf8'));
      console.log(`[Category] Loaded ${Object.keys(goofishMappings).length} Goofish mappings`);
    } else {
      console.warn(`[Category] No mappings file found at ${MAPPINGS_PATH}`);
    }
  } catch (err) {
    console.error(`[Category] Error loading mappings file: ${err.message}`);
  }
}

function saveCategoryData() {
  try {
    fs.writeFileSync(SEED_PATH, JSON.stringify(categories, null, 2));
  } catch (err) {
    console.error(`[Category] Error saving seed file: ${err.message}`);
  }

  try {
    fs.writeFileSync(MAPPINGS_PATH, JSON.stringify(goofishMappings, null, 2));
  } catch (err) {
    console.error(`[Category] Error saving mappings file: ${err.message}`);
  }
}

// Extract categoryId from Goofish/Xianyu URLs
export function extractCategoryId(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const categoryId = urlObj.searchParams.get('categoryId');
    return categoryId || null;
  } catch {
    const match = url.match(/[?&]categoryId=([^&]+)/);
    return match ? match[1] : null;
  }
}

// Call SiliconFlow API for category discovery
async function callSiliconFlowForCategory(prompt, maxRetries = 3) {
  if (!SILICONFLOW_API_KEY) {
    throw new Error('SILICONFLOW_API_KEY not set');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATEGORY_API_TIMEOUT_MS);

    try {
      const response = await axios.post(
        'https://api.siliconflow.com/v1/chat/completions',
        {
          model: CATEGORY_MODEL,
          messages: [
            { role: 'system', content: 'You are a helpful assistant that categorizes products. Always respond with valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.3
        },
        {
          headers: {
            'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from API');

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        let result;
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          result = JSON.parse(content);
        }
        if (CATEGORY_AI_RATE_LIMIT_DELAY_MS > 0) {
          await new Promise(r => setTimeout(r, CATEGORY_AI_RATE_LIMIT_DELAY_MS));
        }
        return result;
      } catch {
        if (CATEGORY_AI_RATE_LIMIT_DELAY_MS > 0) {
          await new Promise(r => setTimeout(r, CATEGORY_AI_RATE_LIMIT_DELAY_MS));
        }
        return { rawResponse: content };
      }
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || err.code === 'ECONNABORTED';
      console.log(`[Category AI] Attempt ${attempt} failed: ${isTimeout ? 'timed out' : err.message}`);
      if (attempt === maxRetries) throw err;
      const delay = isTimeout ? 5000 * attempt : 2000 * attempt;
      console.log(`[Category AI] Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    } finally {
      clearTimeout(timer);
    }
  }
}

// Discover category using AI
async function discoverCategory(productTitle, categoryId = null) {
  const context = categoryId
    ? `This product is from a marketplace with category ID "${categoryId}".`
    : '';

  const prompt = `${context}
Based on the following product title, suggest a category.
Product Title: "${productTitle}"

Respond ONLY with a JSON object in this exact format:
{
  "slug": "lowercase_category_name_with_underscores",
  "name_ar": "Arabic category name",
  "name_en": "English category name",
  "confidence": 0.95
}

Rules:
- slug: lowercase, underscores instead of spaces, no special characters
- name_ar: Proper Arabic name that users would search for
- name_en: English translation
- confidence: number between 0 and 1
- IMPORTANT: "睡袍" (robe) should translate to "روب نوم" (sleep robe), NOT "بناطيل نوم" (pajama pants)
- IMPORTANT: "睡衣" (pajamas) should translate to "بيجامة" (pajamas) or "بناطيل نوم" (pajama pants)

Example output for "iPhone 15 Pro Max":
{
  "slug": "smartphones",
  "name_ar": "الهواتف الذكية",
  "name_en": "Smartphones",
  "confidence": 0.98
}

Example output for "睡袍" (robe):
{
  "slug": "sleepwear_robes",
  "name_ar": "روب نوم",
  "name_en": "Sleepwear Robes",
  "confidence": 0.98
}

Example output for "睡衣" (pajamas):
{
  "slug": "sleepwear_pajamas",
  "name_ar": "بيجامة نوم",
  "name_en": "Sleepwear Pajamas",
  "confidence": 0.98
}`;

  console.log(`  → Calling AI for category discovery...`);
  return await callSiliconFlowForCategory(prompt);
}

// Assign category to a product
async function batchInsertDetailsFromJson() {
  const detailDataPath = path.join(process.cwd(), 'goofish-detail-results.json');
  const maxRetries = 3;
  const retryDelayMs = 5000;
  
  try {
    console.log(`[Batch Insert Details] Reading JSON from ${detailDataPath}`);
    
    if (!fs.existsSync(detailDataPath)) {
      console.log(`[Batch Insert Details] JSON file not found: ${detailDataPath}`);
      return;
    }
    
    await ensureDbReady();
    console.log(`[Batch Insert Details] Database ready, starting streaming insert`);
    
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    
    while (fs.existsSync(detailDataPath)) {
      try {
        const rawData = fs.readFileSync(detailDataPath, 'utf8');
        const items = JSON.parse(rawData);
        
        if (!Array.isArray(items) || items.length === 0) {
          console.log(`[Batch Insert Details] No more items to insert`);
          break;
        }
        
        console.log(`[Batch Insert Details] ${items.length} items remaining in JSON`);
        
        // Process first item
        const item = items[0];
        let attempt = 1;
        let updated = false;
        
        while (attempt <= maxRetries && !updated) {
          try {
            const urlDisplay = typeof item.url === 'string' ? item.url.substring(0, 50) : typeof item.url;
            console.log(`[Batch Insert Details] Processing item ${totalProcessed + 1} (URL: ${urlDisplay}...) (attempt ${attempt}/${maxRetries})`);
            
            if (!item.url || typeof item.url !== 'string') {
              console.warn(`[Batch Insert Details] Skipping item with invalid URL (type: ${typeof item.url}), removing from JSON`);
              console.warn(`[Batch Insert Details] Item data:`, JSON.stringify(item).substring(0, 200));
              updated = true;
              totalSkipped++;
              break;
            }
            
            // Find product by URL
            const existing = await findExistingProductByUrl(item.url);
            
            if (!existing) {
              console.warn(`[Batch Insert Details] No product found for URL ${item.url}, skipping (will be created in collection batch insert)`);
              updated = true;
              totalSkipped++;
              // Remove skipped item from JSON to prevent infinite loop
              const remainingItems = items.slice(1);
              if (remainingItems.length > 0) {
                fs.writeFileSync(detailDataPath, JSON.stringify(remainingItems, null, 2));
              } else {
                fs.unlinkSync(detailDataPath);
                console.log(`[Batch Insert Details] All items processed, JSON file deleted`);
              }
              break;
            }
            
            const productId = existing.id;
            
            // Update product with all gathered data
            const metadata = {
              ...item.aiMetadata,
              soldCount: item.soldCount,
              detailUpdatedAt: new Date().toISOString()
            };
            
            // Update name if translated
            if (item.translatedName && hasArabic(item.translatedName)) {
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "name" = ${item.translatedName},
                    "updatedAt" = NOW()
                WHERE id = ${productId}
              `;
            }
            
            // Update description if translated
            if (item.translatedDescription && hasArabic(item.translatedDescription)) {
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
                    "description" = ${item.translatedDescription},
                    "updatedAt" = NOW()
                WHERE id = ${productId}
              `;
            } else {
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
                    "updatedAt" = NOW()
                WHERE id = ${productId}
              `;
            }
            
            // Update specs if available
            if (item.translatedSpecs && Object.keys(item.translatedSpecs).length > 0) {
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "specs" = ${JSON.stringify(item.translatedSpecs)}::jsonb,
                    "updatedAt" = NOW()
                WHERE id = ${productId}
              `;
            }
            
            // Insert images
            if (item.images && item.images.length > 0) {
              for (const imageUrl of item.images) {
                try {
                  await prisma.productImage.createMany({
                    data: [{
                      productId: productId,
                      url: imageUrl,
                      order: item.images.indexOf(imageUrl),
                      type: 'GALLERY'
                    }],
                    skipDuplicates: true
                  });
                } catch (imageErr) {
                  // Ignore duplicate errors
                }
              }
            }
            
            // Assign category if categoryId is available
            if (item.categoryId) {
              try {
                await assignCategoryToProduct(productId, item.translatedName || item.name, item.url);
              } catch (categoryErr) {
                console.warn(`[Batch Insert Details] Failed to assign category for ${productId}: ${toErrorText(categoryErr)}`);
              }
            }
            
            // Update isActive if unavailable
            if (item.isActive === false) {
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "isActive" = false,
                    "updatedAt" = NOW()
                WHERE id = ${productId}
              `;
            }
            
            // Generate image embeddings if not disabled
            if (!GOOFISH_DISABLE_IMAGE_EMBEDDINGS) {
              const imageToEmbed = item.image || (item.images && item.images.length > 0 ? item.images[0] : null);
              if (imageToEmbed) {
                console.log(`[Batch Insert Details] Generating embedding for Product ${productId}...`);
                try {
                  const embeddingResult = await withTimeout(
                    () => ensureProductImageEmbeddings({
                      prisma,
                      productId: productId,
                      productName: GOOFISH_EMBED_USE_PRODUCT_NAME ? (item.translatedName || item.name || null) : null,
                      fallbackImageUrl: imageToEmbed,
                      runDb: (operation, label) => withRetry(
                        operation,
                        label,
                        3,
                        30000,
                        500
                      ),
                      logger: console,
                    }),
                    `embedding step ${productId}`,
                    120000
                  );
                  if (embeddingResult.embeddedCount > 0) {
                    console.log(`[Batch Insert Details] ✓ Generated ${embeddingResult.embeddedCount} embeddings for Product ${productId}`);
                  }
                } catch (embedErr) {
                  console.warn(`⚠️ Failed to generate image embeddings for Product ${productId}: ${toErrorText(embedErr)}`);
                }
              }
            }
            
            console.log(`[Batch Insert Details] ✓ Successfully updated item ${totalProcessed + 1} (ID: ${productId})`);
            updated = true;
            totalUpdated++;
            
            // Remove updated item from JSON
            const remainingItems = items.slice(1);
            if (remainingItems.length > 0) {
              fs.writeFileSync(detailDataPath, JSON.stringify(remainingItems, null, 2));
            } else {
              // All items processed, delete the file
              fs.unlinkSync(detailDataPath);
              console.log(`[Batch Insert Details] All items processed, JSON file deleted`);
            }
            
          } catch (itemErr) {
            console.error(`[Batch Insert Details] Attempt ${attempt}/${maxRetries} failed for item: ${toErrorText(itemErr)}`);
            
            if (attempt < maxRetries) {
              console.log(`[Batch Insert Details] Retrying in ${retryDelayMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryDelayMs));
              attempt++;
            } else {
              console.error(`[Batch Insert Details] All ${maxRetries} attempts failed for this item, skipping`);
              // Remove failed item from JSON to avoid infinite loop
              const remainingItems = items.slice(1);
              if (remainingItems.length > 0) {
                fs.writeFileSync(detailDataPath, JSON.stringify(remainingItems, null, 2));
              } else {
                fs.unlinkSync(detailDataPath);
              }
              totalSkipped++;
            }
          }
        }
        
        totalProcessed++;
        
      } catch (error) {
        console.error(`[Batch Insert Details] Error processing JSON: ${toErrorText(error)}`);
        // Delete corrupted JSON file to prevent infinite loop
        if (fs.existsSync(detailDataPath)) {
          console.warn(`[Batch Insert Details] Deleting corrupted JSON file to prevent infinite loop`);
          fs.unlinkSync(detailDataPath);
        }
        break;
      }
    }
    
    console.log(`[Batch Insert Details] Completed: ${totalProcessed} processed, ${totalUpdated} updated, ${totalSkipped} skipped`);
    
  } catch (error) {
    console.error(`[Batch Insert Details] Fatal error: ${toErrorText(error)}`);
    throw error;
  }
}

async function batchInsertFromJson() {
  const outputPath = path.join(process.cwd(), 'goofish-results.json');
  const detailDataPath = path.join(process.cwd(), 'goofish-detail-results.json');
  const maxRetries = 3;
  const retryDelayMs = 5000;
  
  try {
    console.log(`[Batch Insert] Reading collection JSON from ${outputPath}`);
    
    if (!fs.existsSync(outputPath)) {
      console.log(`[Batch Insert] Collection JSON file not found: ${outputPath}`);
      return;
    }
    
    await ensureDbReady();
    console.log(`[Batch Insert] Database ready, starting streaming insert`);
    
    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    
    while (fs.existsSync(outputPath)) {
      try {
        const rawData = fs.readFileSync(outputPath, 'utf8');
        const items = JSON.parse(rawData);
        
        if (!Array.isArray(items) || items.length === 0) {
          console.log(`[Batch Insert] No more items to insert`);
          break;
        }
        
        console.log(`[Batch Insert] ${items.length} items remaining in JSON`);
        
        // Process first item
        const item = items[0];
        let attempt = 1;
        let inserted = false;
        
        while (attempt <= maxRetries && !inserted) {
          try {
            console.log(`[Batch Insert] Processing item ${totalProcessed + 1}: ${item.titleEn?.substring(0, 30)}... (attempt ${attempt}/${maxRetries})`);
            
            const goofishItemId = extractGoofishItemId(item?.url);
            const existing = await findExistingProductByUrl(item.url);
            
            const metadata = {
              originalTitle: item.title,
              translatedDescription: item.descriptionAr || '',
              isRealBrand: typeof item.realBrand === 'boolean' ? item.realBrand : null,
              goofishItemId: goofishItemId || null,
              source: 'goofish',
              scrapedAt: new Date()
            };
            
            const keywordsList = ensureKeywordList(item.keywords, item.titleEn || item.title);
            const basePriceIQD = Math.max(0, Number(item.priceCny || 0) * CNY_TO_IQD_RATE);
            const multiplier = calculatePriceMultiplier(basePriceIQD);
            const priceIQD = Math.round(basePriceIQD * multiplier);
            
            let productId;
            
            if (existing) {
              // Update existing
              await prisma.product.update({
                where: { id: existing.id },
                data: {
                  name: item.titleEn || item.title,
                  price: priceIQD,
                  basePriceIQD,
                  aiMetadata: metadata,
                  updatedAt: new Date()
                }
              });
              
              // Update keywords using raw SQL
              if (keywordsList && keywordsList.length > 0) {
                const keywordsSql = Prisma.join(keywordsList);
                await prisma.$executeRaw`
                  UPDATE "Product"
                  SET "keywords" = ARRAY[${keywordsSql}]
                  WHERE "id" = ${existing.id}
                `;
              }
              
              productId = existing.id;
            } else {
              // Create new
              const newProduct = await prisma.product.create({
                data: {
                  name: item.titleEn || item.title,
                  price: priceIQD,
                  basePriceIQD,
                  image: item.image,
                  purchaseUrl: item.url,
                  status: 'PUBLISHED',
                  isActive: true,
                  aiMetadata: metadata
                }
              });
              
              // Update keywords using raw SQL
              if (newProduct?.id && keywordsList && keywordsList.length > 0) {
                const keywordsSql = Prisma.join(keywordsList);
                await prisma.$executeRaw`
                  UPDATE "Product"
                  SET "keywords" = ARRAY[${keywordsSql}]
                  WHERE "id" = ${newProduct.id}
                `;
              }
              
              // Add main image
              if (item.image && newProduct?.id) {
                try {
                  await prisma.productImage.createMany({
                    data: [{
                      productId: newProduct.id,
                      url: item.image,
                      order: 0,
                      type: 'GALLERY'
                    }],
                    skipDuplicates: true
                  });
                } catch (imageErr) {
                  console.warn(`[Batch Insert] Failed to insert image for ${newProduct.id}: ${toErrorText(imageErr)}`);
                }
              }
              
              // Assign category
              try {
                await assignCategoryToProduct(newProduct.id, item.titleEn || item.title, item.url);
              } catch (categoryErr) {
                console.warn(`[Batch Insert] Failed to assign category for ${newProduct.id}: ${toErrorText(categoryErr)}`);
              }
              
              // Generate image embeddings if not disabled
              if (!GOOFISH_DISABLE_IMAGE_EMBEDDINGS) {
                const imageToEmbed = item.image;
                if (imageToEmbed) {
                  console.log(`[Batch Insert] Generating embedding for Product ${newProduct.id}...`);
                  try {
                    const embeddingResult = await withTimeout(
                      () => ensureProductImageEmbeddings({
                        prisma,
                        productId: newProduct.id,
                        productName: GOOFISH_EMBED_USE_PRODUCT_NAME ? (item.titleEn || item.title || null) : null,
                        fallbackImageUrl: imageToEmbed,
                        runDb: (operation, label) => withRetry(
                          operation,
                          label,
                          3,
                          30000,
                          500
                        ),
                        logger: console,
                      }),
                      `embedding step ${newProduct.id}`,
                      120000
                    );
                    if (embeddingResult.embeddedCount > 0) {
                      console.log(`[Batch Insert] ✓ Generated ${embeddingResult.embeddedCount} embeddings for Product ${newProduct.id}`);
                    }
                  } catch (embedErr) {
                    console.warn(`⚠️ Failed to generate image embeddings for Product ${newProduct.id}: ${toErrorText(embedErr)}`);
                  }
                }
              }
              
              productId = newProduct.id;
            }
            
            // Check if there's corresponding detail data for this product
            if (fs.existsSync(detailDataPath)) {
              try {
                const detailRawData = fs.readFileSync(detailDataPath, 'utf8');
                const detailItems = JSON.parse(detailRawData);
                const detailItem = detailItems.find(d => d.url === item.url);
                
                if (detailItem) {
                  console.log(`[Batch Insert] Found detail data for ${item.url}, applying updates`);
                  
                  // Update with detail data
                  const detailMetadata = {
                    ...metadata,
                    soldCount: detailItem.soldCount,
                    detailUpdatedAt: new Date().toISOString()
                  };
                  
                  // Update name if translated
                  if (detailItem.translatedName && hasArabic(detailItem.translatedName)) {
                    await prisma.$executeRaw`
                      UPDATE "Product"
                      SET "name" = ${detailItem.translatedName},
                          "updatedAt" = NOW()
                      WHERE id = ${productId}
                    `;
                  }
                  
                  // Update description if translated
                  if (detailItem.translatedDescription && hasArabic(detailItem.translatedDescription)) {
                    await prisma.$executeRaw`
                      UPDATE "Product"
                      SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || ${JSON.stringify(detailMetadata)}::jsonb,
                          "description" = ${detailItem.translatedDescription},
                          "updatedAt" = NOW()
                      WHERE id = ${productId}
                    `;
                  } else {
                    await prisma.$executeRaw`
                      UPDATE "Product"
                      SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || ${JSON.stringify(detailMetadata)}::jsonb,
                          "updatedAt" = NOW()
                      WHERE id = ${productId}
                    `;
                  }
                  
                  // Update specs if available
                  if (detailItem.translatedSpecs && Object.keys(detailItem.translatedSpecs).length > 0) {
                    await prisma.$executeRaw`
                      UPDATE "Product"
                      SET "specs" = ${JSON.stringify(detailItem.translatedSpecs)}::jsonb,
                          "updatedAt" = NOW()
                      WHERE id = ${productId}
                    `;
                  }
                  
                  // Insert additional images
                  if (detailItem.images && detailItem.images.length > 0) {
                    for (const imageUrl of detailItem.images) {
                      try {
                        await prisma.productImage.createMany({
                          data: [{
                            productId: productId,
                            url: imageUrl,
                            order: detailItem.images.indexOf(imageUrl),
                            type: 'GALLERY'
                          }],
                          skipDuplicates: true
                        });
                      } catch (imageErr) {
                        // Ignore duplicate errors
                      }
                    }
                  }
                  
                  // Update isActive if unavailable
                  if (detailItem.isActive === false) {
                    await prisma.$executeRaw`
                      UPDATE "Product"
                      SET "isActive" = false,
                          "updatedAt" = NOW()
                      WHERE id = ${productId}
                    `;
                  }
                  
                  // Remove detail item from detail JSON
                  const remainingDetailItems = detailItems.filter(d => d.url !== item.url);
                  if (remainingDetailItems.length > 0) {
                    fs.writeFileSync(detailDataPath, JSON.stringify(remainingDetailItems, null, 2));
                  } else {
                    fs.unlinkSync(detailDataPath);
                    console.log(`[Batch Insert] Detail JSON file deleted`);
                  }
                }
              } catch (detailErr) {
                console.warn(`[Batch Insert] Failed to process detail data for ${item.url}: ${toErrorText(detailErr)}`);
              }
            }
            
            console.log(`[Batch Insert] ✓ Successfully inserted item ${totalProcessed + 1} (ID: ${productId})`);
            inserted = true;
            totalInserted++;
            
            // Remove inserted item from JSON
            const remainingItems = items.slice(1);
            if (remainingItems.length > 0) {
              fs.writeFileSync(outputPath, JSON.stringify(remainingItems, null, 2));
            } else {
              // All items processed, delete the file
              fs.unlinkSync(outputPath);
              console.log(`[Batch Insert] All items processed, JSON file deleted`);
            }
            
          } catch (itemErr) {
            console.error(`[Batch Insert] Attempt ${attempt}/${maxRetries} failed for item: ${toErrorText(itemErr)}`);
            
            if (attempt < maxRetries) {
              console.log(`[Batch Insert] Retrying in ${retryDelayMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryDelayMs));
              attempt++;
            } else {
              console.error(`[Batch Insert] All ${maxRetries} attempts failed for this item, skipping`);
              // Remove failed item from JSON to avoid infinite loop
              const remainingItems = items.slice(1);
              if (remainingItems.length > 0) {
                fs.writeFileSync(outputPath, JSON.stringify(remainingItems, null, 2));
              } else {
                fs.unlinkSync(outputPath);
              }
              totalSkipped++;
            }
          }
        }
        
        totalProcessed++;
        
      } catch (error) {
        console.error(`[Batch Insert] Error processing JSON: ${toErrorText(error)}`);
        break;
      }
    }
    
    console.log(`[Batch Insert] Completed: ${totalProcessed} processed, ${totalInserted} inserted, ${totalSkipped} skipped`);
    
  } catch (error) {
    console.error(`[Batch Insert] Fatal error: ${toErrorText(error)}`);
    throw error;
  }
}

async function assignCategoryToProduct(productId, productName, purchaseUrl) {
  if (!CATEGORY_ASSIGN_ENABLED) {
    return;
  }

  try {
    console.log(`[Category] Assigning category to product ${productId}: ${productName?.slice(0, 40)}...`);

    const categoryId = extractCategoryId(purchaseUrl);
    let categorySlug = null;
    let categoryNameAr = null;
    let categorySource = 'unknown';

    if (categoryId) {
      console.log(`  → Found categoryId in URL: ${categoryId}`);

      if (goofishMappings[categoryId]) {
        categorySlug = goofishMappings[categoryId];
        const existingCat = categories.find(c => c.slug === categorySlug);
        categoryNameAr = existingCat?.name_ar || categorySlug;
        categorySource = 'goofish_mapped';
        console.log(`  → Using existing mapping: ${categorySlug}`);
      } else {
        console.log(`  → New categoryId discovered, using AI...`);
        const discovered = await discoverCategory(productName, categoryId);

        if (discovered?.slug && discovered?.name_ar) {
          categorySlug = discovered.slug;
          categoryNameAr = discovered.name_ar;

          const existingIndex = categories.findIndex(c => c.slug === categorySlug);
          if (existingIndex === -1) {
            categories.push({
              slug: categorySlug,
              name_ar: discovered.name_ar,
              name_en: discovered.name_en || discovered.slug,
              aliases: [discovered.name_ar, discovered.name_en].filter(Boolean),
              source: 'auto_discovered',
              discovered_from: categoryId,
              created_at: new Date().toISOString()
            });
            console.log(`  → Created new category: ${categorySlug} (${discovered.name_ar})`);
            saveCategoryData();
          } else {
            console.log(`  → Using existing category: ${categorySlug}`);
          }

          goofishMappings[categoryId] = categorySlug;
          categorySource = 'goofish_auto_discovered';
          saveCategoryData();
        }
      }
    }

    if (!categorySlug) {
      console.log(`  → No categoryId, using AI on product title...`);
      const discovered = await discoverCategory(productName);

      if (discovered?.slug && discovered?.name_ar) {
        categorySlug = discovered.slug;
        categoryNameAr = discovered.name_ar;

        const existingIndex = categories.findIndex(c => c.slug === categorySlug);
        if (existingIndex === -1) {
          categories.push({
            slug: categorySlug,
            name_ar: discovered.name_ar,
            name_en: discovered.name_en || discovered.slug,
            aliases: [discovered.name_ar, discovered.name_en].filter(Boolean),
            source: 'ai_generated',
            created_at: new Date().toISOString()
          });
          console.log(`  → Created new category: ${categorySlug} (${discovered.name_ar})`);
          saveCategoryData();
        } else {
          console.log(`  → Using existing category: ${categorySlug}`);
        }

        categorySource = 'ai_title_based';
      }
    }

    if (categorySlug && categoryNameAr) {
      // Check if category exists in database, create if not
      let categoryRecord = await prisma.category.findUnique({
        where: { slug: categorySlug }
      });

      if (!categoryRecord) {
        console.log(`  → Category not found in database, creating: ${categorySlug}`);
        categoryRecord = await prisma.category.create({
          data: {
            slug: categorySlug,
            nameAr: categoryNameAr,
            nameEn: categoryNameAr,
            goofishCategoryId: categoryId || null
          }
        });
        console.log(`  → Created category in database with ID: ${categoryRecord.id}`);
      } else {
        console.log(`  → Found category in database with ID: ${categoryRecord.id}`);
      }

      // Update product with categoryId
      await prisma.product.update({
        where: { id: productId },
        data: { categoryId: categoryRecord.id }
      });
      console.log(`  ✓ Assigned to: ${categorySlug} (${categoryNameAr}) with categoryId: ${categoryRecord.id}`);
    } else {
      console.log(`  ✗ Failed to assign category`);
    }
  } catch (err) {
    console.error(`[Category] Error assigning category to product ${productId}:`, err.message);
  }
}
const MAX_PRODUCTS_TO_PROCESS = Number.isFinite(configuredMaxProducts) && configuredMaxProducts > 0
  ? configuredMaxProducts
  : Number.POSITIVE_INFINITY;
const OUTPUT_JSON = String(process.env.GOOFISH_OUTPUT_JSON || '').toLowerCase() === 'true';
const BATCH_INSERT_FROM_JSON = String(process.env.GOOFISH_BATCH_INSERT_FROM_JSON || '').toLowerCase() === 'true';
const SKIP_COLLECT_ONLY_BATCH_INSERT = String(process.env.GOOFISH_SKIP_COLLECT || '').toLowerCase() === 'true';
const REQUIRE_DB_WRITE = String(process.env.GOOFISH_REQUIRE_DB_WRITE || 'true').toLowerCase() !== 'false';
const AI_ONLY_TERMS = String(process.env.GOOFISH_AI_ONLY_TERMS || '').toLowerCase() === 'true';
const TRANSLATION_CACHE_PATH = path.join(__dirname, 'goofish-translation-cache.json');
const TERM_DETAIL_LINKS_PATH = path.join(__dirname, 'goofish-term-detail-links.json');
const BATCH_LINKS_PATH = path.join(__dirname, 'goofish-batch-links.json');
const ITEMS_PER_SEARCH = Math.max(1, parseInt(process.env.GOOFISH_ITEMS_PER_SEARCH || '150', 10) || 150);
const GOOFISH_LINKS_PER_TERM = Math.max(1, parseInt(process.env.GOOFISH_LINKS_PER_TERM || '150', 10) || 150);
const GOOFISH_TERMS_PER_BATCH = Math.max(1, parseInt(process.env.GOOFISH_TERMS_PER_BATCH || '50', 10) || 50);
const KEYWORDS_PER_PRODUCT = Math.max(8, Math.min(20, parseInt(process.env.GOOFISH_KEYWORDS_PER_PRODUCT || '14', 10) || 14));
const GOOFISH_AI_TITLE_MAX_CHARS = Math.max(40, parseInt(process.env.GOOFISH_AI_TITLE_MAX_CHARS || '140', 10) || 140);
const GOOFISH_AI_SECOND_PASS_DESCRIPTION = String(process.env.GOOFISH_AI_SECOND_PASS_DESCRIPTION || 'false').toLowerCase() === 'true';
const GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY = Math.max(1, parseInt(process.env.GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY || '20', 10) || 20);
const GOOFISH_DB_SAVE_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_DB_SAVE_TIMEOUT_MS || '60000', 10) || 60000);
const GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS || '180000', 10) || 180000);
const GOOFISH_DB_ENGINE_FAILURE_THRESHOLD = Math.max(2, parseInt(process.env.GOOFISH_DB_ENGINE_FAILURE_THRESHOLD || '4', 10) || 4);
const GOOFISH_DB_ENGINE_COOLDOWN_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_ENGINE_COOLDOWN_MS || '90000', 10) || 90000);
const GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS || '60000', 10) || 60000);
const GOOFISH_DB_CONNECT_TIMEOUT_MS = Math.max(8000, parseInt(process.env.GOOFISH_DB_CONNECT_TIMEOUT_MS || '30000', 10) || 30000);
const GOOFISH_DB_CONNECT_RETRIES = Math.max(1, parseInt(process.env.GOOFISH_DB_CONNECT_RETRIES || '8', 10) || 8);
const GOOFISH_DB_CONNECT_RETRY_DELAY_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_CONNECT_RETRY_DELAY_MS || '2000', 10) || 2000);
const GOOFISH_DB_CONNECT_VERIFY_PING = String(process.env.GOOFISH_DB_CONNECT_VERIFY_PING || 'true').toLowerCase() !== 'false';
const GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST = String(process.env.GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST || 'false').toLowerCase() === 'true';
const GOOFISH_DB_SAVE_RETRIES = Math.max(1, parseInt(process.env.GOOFISH_DB_SAVE_RETRIES || '3', 10) || 3);
const GOOFISH_PROGRESS_STALL_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GOOFISH_PROGRESS_STALL_TIMEOUT_MS || '120000', 10) || 120000);
const GOOFISH_PROGRESS_STALL_HARD_EXIT_MS = Math.max(
  GOOFISH_PROGRESS_STALL_TIMEOUT_MS,
  parseInt(
    process.env.GOOFISH_PROGRESS_STALL_HARD_EXIT_MS || String(GOOFISH_PROGRESS_STALL_TIMEOUT_MS * 2),
    10
  ) || (GOOFISH_PROGRESS_STALL_TIMEOUT_MS * 2)
);
const GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS = Math.max(5000, parseInt(process.env.GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS || '10000', 10) || 10000);
const GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS = Math.max(5000, parseInt(process.env.GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS || '30000', 10) || 30000);
const GOOFISH_PROGRESS_STALL_MAX_RECOVERS = Math.max(1, parseInt(process.env.GOOFISH_PROGRESS_STALL_MAX_RECOVERS || '3', 10) || 3);
const parsedRecoverWaitMs = parseInt(process.env.GOOFISH_DB_RECOVER_WAIT_MS || '120000', 10);
const GOOFISH_DB_RECOVER_WAIT_MS = Number.isFinite(parsedRecoverWaitMs) ? Math.max(0, parsedRecoverWaitMs) : 120000;
const GOOFISH_DB_RECOVER_PING_TIMEOUT_MS = Math.max(1000, parseInt(process.env.GOOFISH_DB_RECOVER_PING_TIMEOUT_MS || '12000', 10) || 12000);
const GOOFISH_EMBEDDING_STEP_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_EMBEDDING_STEP_TIMEOUT_MS || '90000', 10) || 90000);
const GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP = Math.max(0, parseInt(process.env.GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP || '1', 10) || 1);
const GOOFISH_PROCESS_LINK_TIMEOUT_MS = Math.max(30000, parseInt(process.env.GOOFISH_PROCESS_LINK_TIMEOUT_MS || '180000', 10) || 180000);
const GOOFISH_AI_CALL_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_AI_CALL_TIMEOUT_MS || '60000', 10) || 60000);
const GOOFISH_AI_RETRY_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.GOOFISH_AI_RETRY_MAX_ATTEMPTS || '3', 10) || 3);

// Reuse HTTP connections to SiliconFlow to avoid TLS handshake overhead
const siliconflowAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  maxFreeSockets: 2,
  timeout: 30000,
  freeSocketTimeout: 30000,
});

// Circuit breaker: skip AI calls after N consecutive failures
let sfConsecutiveFailures = 0;
const SF_FAILURE_THRESHOLD = 10;
const SF_COOLDOWN_MS = 10000;
let sfCircuitOpenUntil = 0;

// Reset circuit breaker on startup
sfConsecutiveFailures = 0;
sfCircuitOpenUntil = 0;

const GOOFISH_TERM_AI_CALL_TIMEOUT_MS = Math.max(5000, parseInt(process.env.GOOFISH_TERM_AI_CALL_TIMEOUT_MS || '60000', 10) || 60000);
const GOOFISH_TERM_AI_MAX_ATTEMPTS = Math.max(1, parseInt(process.env.GOOFISH_TERM_AI_MAX_ATTEMPTS || '3', 10) || 3);
const GOOFISH_AI_MODEL = String(process.env.GOOFISH_AI_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507').trim() || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const GOOFISH_AI_RATE_LIMIT_DELAY_MS = Math.max(0, Number.parseInt(process.env.GOOFISH_AI_RATE_LIMIT_DELAY_MS || '200', 10) || 200);
const GOOFISH_ENABLE_TRANSLATION_RETRY = String(process.env.GOOFISH_ENABLE_TRANSLATION_RETRY || '').toLowerCase() === 'true';
const GOOFISH_SKIP_ON_TRANSLATION_FAILURE = String(process.env.GOOFISH_SKIP_ON_TRANSLATION_FAILURE || 'true').toLowerCase() !== 'false';
const GOOFISH_DB_SAVE_BACKOFF_MS = Math.max(200, parseInt(process.env.GOOFISH_DB_SAVE_BACKOFF_MS || '500', 10) || 500);
const GOOFISH_RESET_TERMS_ON_START = String(process.env.GOOFISH_RESET_TERMS_ON_START || '').toLowerCase() === 'true';
const GOOFISH_EMBED_USE_PRODUCT_NAME = String(process.env.GOOFISH_EMBED_USE_PRODUCT_NAME || 'true').toLowerCase() !== 'false';
const GOOFISH_DISABLE_IMAGE_EMBEDDINGS = String(process.env.GOOFISH_DISABLE_IMAGE_EMBEDDINGS || 'true').toLowerCase() === 'true';
const GOOFISH_ACCUMULATE_PER_PRODUCT = String(process.env.GOOFISH_ACCUMULATE_PER_PRODUCT || '').toLowerCase() === 'true';
console.log(`[Config] GOOFISH_ACCUMULATE_PER_PRODUCT = ${GOOFISH_ACCUMULATE_PER_PRODUCT}`);
const GOOFISH_SKIP_DETAILS_AFTER_TERM = String(process.env.GOOFISH_SKIP_DETAILS_AFTER_TERM || '').toLowerCase() === 'true';
const GOOFISH_DETAILS_ONLY = String(process.env.GOOFISH_DETAILS_ONLY || '').toLowerCase() === 'true';
const GOOFISH_HEADLESS = !['0', 'false', 'no', 'off'].includes(String(process.env.GOOFISH_HEADLESS || '0').trim().toLowerCase());
const GOOFISH_DETAILS_LIMIT = Math.max(1, parseInt(process.env.GOOFISH_DETAILS_LIMIT || '5', 10) || 5);
const GOOFISH_DETAILS_IDS = String(process.env.GOOFISH_DETAILS_IDS || '')
  .split(',')
  .map((v) => Number.parseInt(v.trim(), 10))
  .filter((v) => Number.isFinite(v) && v > 0);
const UPDATE_EXISTING = String(process.env.GOOFISH_UPDATE_EXISTING || '').toLowerCase() === 'true';
const UPDATE_LIMIT = parseInt(process.env.GOOFISH_UPDATE_LIMIT || '', 10);
const UPDATE_START_ID = parseInt(process.env.GOOFISH_UPDATE_START_ID || '0', 10);
const UPDATE_BATCH_SIZE = Math.max(1, parseInt(process.env.GOOFISH_UPDATE_BATCH || '25', 10) || 25);
const parsedUpdateDelayMin = Number.parseInt(process.env.GOOFISH_UPDATE_DELAY_MIN || '800', 10);
const UPDATE_DELAY_MIN = Number.isFinite(parsedUpdateDelayMin) ? Math.max(0, parsedUpdateDelayMin) : 800;
const parsedUpdateDelayMax = Number.parseInt(process.env.GOOFISH_UPDATE_DELAY_MAX || '1600', 10);
const UPDATE_DELAY_MAX = Number.isFinite(parsedUpdateDelayMax) ? Math.max(UPDATE_DELAY_MIN, parsedUpdateDelayMax) : Math.max(UPDATE_DELAY_MIN, 1600);
const UPDATE_PROGRESS_EVERY = Math.max(1, parseInt(process.env.GOOFISH_UPDATE_PROGRESS_EVERY || '10', 10) || 10);
const UPDATE_QUERY_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.GOOFISH_UPDATE_QUERY_TIMEOUT_MS || '90000', 10) || 90000);
const UPDATE_PROGRESS_PATH = path.join(__dirname, 'goofish-update-existing-progress.json');
const UPDATE_RESET_PROGRESS = String(process.env.GOOFISH_UPDATE_RESET_PROGRESS || '').toLowerCase() === 'true';
const UPDATE_FORCE_REGENERATE = String(process.env.GOOFISH_UPDATE_FORCE_REGENERATE || '').toLowerCase() === 'true';
const UPDATE_CLEAR_KEYWORDS_FIRST = String(process.env.GOOFISH_UPDATE_CLEAR_KEYWORDS_FIRST || '').toLowerCase() === 'true';
const UPDATE_PRINT_BATCH_SAMPLE = String(process.env.GOOFISH_UPDATE_PRINT_BATCH_SAMPLE || 'true').toLowerCase() !== 'false';
const DEFAULT_SEARCH_TERMS = [
  '手机壳', '女包', '斜挎包', '连衣裙', '女鞋', '牛仔裤',
  '男士T恤', '运动鞋', '耳机', '蓝牙音箱', '智能手表', '充电宝',
  '化妆刷', '口红', '护肤套装', '床上四件套', '收纳盒', '厨房用品',
  '汽车香水', '儿童玩具', '瑜伽裤', '太阳镜', '首饰', '行李箱'
];
const SEARCH_TERMS_PATH = path.join(__dirname, 'goofish-search-terms.json');
const FOOD_BLACKLIST = [
  '食品', '零食', '水果', '蔬菜', '牛奶', '饮料', '咖啡', '茶',
  '面包', '零嘴', '饼干', '蛋糕', '方便面', '火锅', '调味',
  '大米', '米', '面', '肉', '海鲜', '酒', '啤酒', '葡萄酒'
];

const EXCLUDED_KEYWORDS = [
  '黄金', '足金', '千足金', '万足金', '18K金', '24K金', 'Au999', 'Au750', '真金', '赤金', '纯金', '金条', '金币', '金砖'
];

// Silver and other metals are OKAY now.
// Removed: '白银', '纯银', '足银', 'S925', '925银', 'Ag999', 'Ag925', '真银'

function isExcludedProduct(title) {
  if (!title) return false;
  const t = title.toUpperCase();
  return EXCLUDED_KEYWORDS.some(k => t.includes(k.toUpperCase()));
}

function isChineseTerm(text) {
  if (!text) return false;
  // A rough heuristic to check if the string has Chinese characters
  return /[\u4e00-\u9fa5]/.test(String(text));
}

function detectRealPriceFromTitle(title, currentPrice) {
  // DISABLED: Returning current price as requested
  return currentPrice;
}

// Price extraction functions from goofish-link-checker
function hasExplicitChinesePrice(description) {
  const text = String(description || '');
  return /(?:\d{1,6}(?:\.\d{1,2})?\s*(?:元|块|人民币|￥|¥))|(?:(?:元|块|人民币|￥|¥)\s*\d{1,6}(?:\.\d{1,2})?)/.test(text);
}

function extractPricesLocally(description) {
  const text = String(description || '').replace(/\r/g, '\n');
  const lines = text.split(/\n|<br\s*\/?>/i).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const variants = [];
  const seen = new Set();

  for (const line of lines) {
    const matches = [...line.matchAll(/(?:^|[^\d])(\d{1,6}(?:\.\d{1,2})?)\s*(?:元|块|￥|¥)/g)];
    for (const match of matches) {
      const priceCny = Number(match[1]);
      if (!Number.isFinite(priceCny) || priceCny <= 0) continue;
      const beforePrice = line.slice(0, match.index + match[0].indexOf(match[1])).replace(/^[-–—\s]+/, '').trim();
      const name = beforePrice || line.replace(match[0], '').trim();
      const key = `${name}-${priceCny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({
        nameAr: name,
        priceCny,
      });
    }
  }

  if (!variants.length) return null;
  variants.sort((a, b) => a.priceCny - b.priceCny);
  return {
    lowestPriceCny: variants[0].priceCny,
    highestPriceCny: variants[variants.length - 1].priceCny,
    priceVariants: variants,
    source: 'local_regex',
  };
}

async function extractPricesWithAI(description) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.warn('[AI Price Extraction] No SILICONFLOW_API_KEY found, skipping price extraction');
    return null;
  }

  console.log(`[AI Price Extraction] Sending description to AI (${description.length} chars)`);

  for (let attempt = 1; attempt <= GOOFISH_AI_RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GOOFISH_AI_CALL_TIMEOUT_MS);
    try {
      const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
        model: GOOFISH_AI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a price extraction assistant for an Iraqi e-commerce platform. Extract all real product prices from product descriptions. Prices are usually in Chinese Yuan (元/块/人民币/¥/￥).\n\nCRITICAL RULES:\n1. You MUST translate EVERY option/variant name to Arabic (Iraqi dialect).\n2. NEVER use generic names like "خيار 1" or "option 1" or "Option A".\n3. You MUST translate the actual Chinese text from the description into proper Arabic.\n\nEXAMPLE INPUT:\n0.9米三件套（学生床 被套150*200） 32元包邮\n1.2米三件套（宿舍床 被套150*200） 35元包邮\n1.5米四件套（被套150*200）38元包邮\n\nEXAMPLE OUTPUT:\n{\n  "lowestPriceCny": 32,\n  "highestPriceCny": 38,\n  "priceVariants": [\n    {"nameAr": "طقم 3 قطع 0.9 متر (سرير طالب، غطاء لحاف 150×200)", "priceCny": 32},\n    {"nameAr": "طقم 3 قطع 1.2 متر (سرير سكن، غطاء لحاف 150×200)", "priceCny": 35},\n    {"nameAr": "طقم 4 قطع 1.5 متر (غطاء لحاف 150×200)", "priceCny": 38}\n  ]\n}\n\nReturn JSON ONLY with: lowestPriceCny, highestPriceCny, and priceVariants (array of objects with nameAr and priceCny). Only extract prices clearly stated in the description. If only one price exists, return one variant.'
          },
          {
            role: 'user',
            content: `Extract real prices from this product description and translate option names to Arabic:\n\n${description}`
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      }, {
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const content = response.data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`[AI Price Extraction] No content in AI response`);
        return null;
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`[AI Price Extraction] No JSON found in AI response: ${content.slice(0, 300)}`);
        return null;
      }

      const priceData = JSON.parse(jsonMatch[0]);
      const variantNames = priceData.priceVariants?.map((v, i) => `[${i + 1}] "${v.nameAr}" = ¥${v.priceCny}`).join(', ') || 'none';
      console.log(`[AI Price Extraction] Extracted CNY prices: lowest=¥${priceData.lowestPriceCny}, highest=¥${priceData.highestPriceCny}, variants=${priceData.priceVariants?.length || 0}`);
      console.log(`[AI Price Extraction] Options: ${variantNames}`);
      return priceData;
    } catch (error) {
      const errorMessage = error?.name === 'AbortError' ? `timed out after ${GOOFISH_AI_CALL_TIMEOUT_MS}ms` : error.message;
      console.error(`[AI Price Extraction] Error (attempt ${attempt}/${GOOFISH_AI_RETRY_MAX_ATTEMPTS}): ${errorMessage}`);
      if (attempt < GOOFISH_AI_RETRY_MAX_ATTEMPTS) {
        const backoffMs = 1200 * attempt;
        console.log(`[AI Price Extraction] Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function extractPricesWithFallback(description) {
  if (!hasExplicitChinesePrice(description)) {
    return null;
  }

  const localPriceData = extractPricesLocally(description);
  if (localPriceData && localPriceData.priceVariants.length >= 2) {
    console.log(`[Local Price Extraction] Extracted CNY prices without AI: lowest=¥${localPriceData.lowestPriceCny}, highest=¥${localPriceData.highestPriceCny}, variants=${localPriceData.priceVariants.length}`);
    return localPriceData;
  }

  const aiPriceData = await extractPricesWithAI(description);
  if (aiPriceData) return aiPriceData;

  if (localPriceData) {
    console.log(`[Local Price Extraction] Extracted CNY prices: lowest=¥${localPriceData.lowestPriceCny}, highest=¥${localPriceData.highestPriceCny}, variants=${localPriceData.priceVariants.length}`);
  }
  return localPriceData;
}

function convertCnyToIqdWithProfit(cny) {
  const CNY_TO_IQD_RATE = 200;
  const PRICE_PROFIT_MULTIPLIER = 1.1;
  return Math.ceil((Number(cny) || 0) * CNY_TO_IQD_RATE * PRICE_PROFIT_MULTIPLIER / 250) * 250;
}

const MAX_AI_ATTEMPTS = 3;
let dbReady = false;
let dbChecked = false;
let dbEngineFailureTimestamps = [];
let dbCircuitOpenUntil = 0;
let dbCircuitLastLogAt = 0;
let dbLastForceReconnectAt = 0;
let pipelineLastProgressAt = Date.now();
let pipelineLastProgressLabel = 'startup';
let pipelineWatchdogTimer = null;
let pipelineWatchdogReconnectInFlight = false;
let pipelineWatchdogLastRecoveryAt = 0;
let pipelineWatchdogLastStallLabel = '';
let pipelineWatchdogStallCount = 0;
let pipelineRestartScheduled = false;

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SCRAPER_IN_PROD !== 'true') {
  console.error('CRITICAL: Scraper is BLOCKED in production environment.');
  console.error('To run this script on the server, set ALLOW_SCRAPER_IN_PROD=true');
  process.exit(1);
}

// Simple SiliconFlow client using axios
async function callSiliconFlow(messages, temperature = 0.3, maxTokens = 100, options = {}) {
  const apiKey = SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  
  // Circuit breaker check
  if (Date.now() < sfCircuitOpenUntil) {
    console.warn(`[SiliconFlow] Circuit breaker open — skipping AI call until ${new Date(sfCircuitOpenUntil).toISOString()}`);
    return null;
  }
  
  const timeoutMsRaw = Number.parseInt(String(options?.timeoutMs ?? GOOFISH_AI_CALL_TIMEOUT_MS), 10);
  const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(5000, timeoutMsRaw) : GOOFISH_AI_CALL_TIMEOUT_MS;
  const maxAttemptsRaw = Number.parseInt(String(options?.maxAttempts ?? GOOFISH_AI_RETRY_MAX_ATTEMPTS), 10);
  const maxAttempts = Number.isFinite(maxAttemptsRaw) ? Math.max(1, maxAttemptsRaw) : GOOFISH_AI_RETRY_MAX_ATTEMPTS;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`[SiliconFlow] Request attempt ${attempt}/${maxAttempts} (timeout=${timeoutMs}ms, model=${GOOFISH_AI_MODEL})`);
      const startedAt = Date.now();
      const response = await axios.post('https://api.siliconflow.com/v1/chat/completions', {
        model: GOOFISH_AI_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: timeoutMs,
      });
      const elapsed = Date.now() - startedAt;
      console.log(`[SiliconFlow] Success in ${elapsed}ms`);
      
      // Reset circuit breaker on success
      if (sfConsecutiveFailures > 0) {
        sfConsecutiveFailures = 0;
      }
      
      // Rate limit delay to respect tier limits
      if (GOOFISH_AI_RATE_LIMIT_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, GOOFISH_AI_RATE_LIMIT_DELAY_MS));
      }
      
      return response.data.choices[0].message.content.trim();
    } catch (error) {
      const status = error?.response?.status;
      const errorMessage = String(error?.message || '').toLowerCase();
      const errorData = String(JSON.stringify(error?.response?.data || '')).toLowerCase();
      const isTimeout = errorMessage.includes('timeout');
      sfConsecutiveFailures += 1;

      // Check for AI limit/quota errors and close scraper
      const isRateLimit = status === 429;
      const isQuotaExceeded = errorMessage.includes('quota') || errorMessage.includes('limit') || errorData.includes('quota') || errorData.includes('limit');
      
      if (isRateLimit || isQuotaExceeded) {
        console.error('========================================');
        console.error('AI LIMIT REACHED - CLOSING SCRAPER');
        console.error('========================================');
        console.error(`Error: ${error.message}`);
        if (error.response?.data) {
          console.error('API Response:', JSON.stringify(error.response.data));
        }
        console.error('Scraper will now exit to avoid further AI calls.');
        console.error('========================================');
        process.exit(0);
      }
      
      // Open circuit breaker if too many consecutive failures
      if (sfConsecutiveFailures >= SF_FAILURE_THRESHOLD) {
        sfCircuitOpenUntil = Date.now() + SF_COOLDOWN_MS;
        console.error(`[SiliconFlow] Circuit breaker OPEN — too many failures (${sfConsecutiveFailures}). Cooling down for ${SF_COOLDOWN_MS/1000}s.`);
        return null;
      }
      
      // Retry on 502, 503, 504, 500, and timeout
      if (status === 502 || status === 503 || status === 504 || status === 500 || isTimeout) {
        console.warn(`SiliconFlow API Error (${status || 'timeout'}), retrying (attempt ${attempt}/${maxAttempts})...`);
        const waitMs = Math.min(15000, 2000 * Math.pow(2, attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      console.error('SiliconFlow API Error:', error.message);
      return null;
    }
  }
  return null;
}

function hasArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ''));
}

function cleanAiText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/[`"'']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLowQualityTranslationText(value, minArabicChars = 3) {
  const text = cleanAiText(sanitizeTranslationText(value));
  if (!text) return true;
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars < minArabicChars) return true;
  if (/([\u0600-\u06FFA-Za-z])\1{6,}/u.test(text)) return true;
  const normalizedTokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/[^\u0600-\u06FFA-Za-z0-9]/g, '').toLowerCase())
    .filter(Boolean);
  if (normalizedTokens.length === 0) return true;
  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < normalizedTokens.length; i += 1) {
    if (normalizedTokens[i] === normalizedTokens[i - 1]) {
      run += 1;
      if (run > longestRun) longestRun = run;
    } else {
      run = 1;
    }
  }
  if (longestRun >= 5) return true;
  if (normalizedTokens.length >= 8) {
    const freq = new Map();
    for (const token of normalizedTokens) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    const topCount = Math.max(...Array.from(freq.values()));
    if ((topCount / normalizedTokens.length) >= 0.58) return true;
  }
  return false;
}

function cleanDescriptionText(value) {
  const raw = cleanAiText(sanitizeTranslationText(value));
  if (!raw) return '';
  const priceTokenRegex = /[¥￥]\s*\d+(?:[.,]\d+)?|\b(?:CNY|RMB)\b\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:元|人民币)\b/gi;
  const keywordLineRegex = /(关键词|关键字|keywords?\b|tags?\b|الكلمات\s*المفتاحية|كلمات\s*مفتاحية)/i;
  const priceLineRegex = /(\bprice\b|السعر|السعر:|price_rmb|rmb|cny|¥|￥|元|人民币)/i;
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !keywordLineRegex.test(line))
    .filter((line) => line.startsWith('') || !priceLineRegex.test(line) || !/\d/.test(line))
    .map((line) => line.startsWith('') ? line : line.replace(priceTokenRegex, '').trim())
    .filter((line) => line.startsWith('') || !(priceLineRegex.test(line) && /\d/.test(line)));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function filterArabicEnglishOnly(text) {
  if (!text) return '';
  return String(text).replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFFa-zA-Z0-9\s\.,،؛:!?()\-_]/g, '').trim();
}

async function convertChineseToPinyin(text) {
  if (!text || !SILICONFLOW_API_KEY) return text;
  // Check if text contains Chinese characters
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  
  try {
    const result = await callSiliconFlow([
      {
        role: 'system',
        content: 'You are a Chinese to pinyin converter. Convert Chinese characters to their pinyin romanization. Keep the pinyin in lowercase with spaces between words. Preserve numbers, English letters, and Arabic text exactly as they are. Do not translate - only convert Chinese characters to pinyin.'
      },
      {
        role: 'user',
        content: `Convert the Chinese characters in this text to pinyin. Keep non-Chinese text unchanged:\n${text}`
      }
    ], 0.2, 200, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
    return result || text;
  } catch {
    return text;
  }
}

function normalizeArabicKeyword(value) {
  return cleanAiText(value)
    .replace(/[\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[【】「」『』〔〕（）]/g, ' ')
    .replace(/[\u3400-\u9FFF]+/g, ' ')
    .replace(/[`"'']/g, '')
    .replace(/[.,!?:;()"'[\]{}<>«»/\\|]/g, ' ')
    .replace(/،/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTranslatedTitle(aiText, fallbackTitle) {
  const raw = String(aiText || '').trim();
  if (!raw) return fallbackTitle;
  const parsedPayload = parseAiTranslationPayload(raw);
  const parsedTitle = cleanAiText(sanitizeTranslationText(parsedPayload?.title_ar || ''));
  if (parsedTitle && hasArabic(parsedTitle) && !isLowQualityTranslationText(parsedTitle, 3)) return parsedTitle.slice(0, 140);
  const lines = raw.split('\n').map((line) => cleanAiText(line)).filter(Boolean);
  const arabicLine = lines
    .map((line) => line
      .replace(/^[{\s]*/, '')
      .replace(/["']?(title_ar|titlear|title)["']?\s*[:：-]\s*/i, '')
      .replace(/["']?(description_ar|descriptionar|full_description_ar|fulldescriptionar)["']?\s*[:：-]\s*/i, '')
      .replace(/["'}\s]*$/, '')
      .trim()
    )
    .map((line) => line.split(/,\s*["']?(description_ar|descriptionar|full_description_ar|fulldescriptionar)\b/i)[0].trim())
    .find((line) => hasArabic(line) && !/^option\b/i.test(line) && !isLowQualityTranslationText(line, 3));
  if (arabicLine) return arabicLine.slice(0, 140);
  const cleanedRaw = cleanAiText(raw).slice(0, 140);
  if (cleanedRaw && hasArabic(cleanedRaw) && !isLowQualityTranslationText(cleanedRaw, 3)) return cleanedRaw;
  return fallbackTitle;
}

function normalizeKeywordList(value) {
  const stopwords = new Set([
    'ال', 'في', 'من', 'على', 'مع', 'عن', 'الى', 'إلى', 'او', 'أو', 'و', 'ب', 'ل',
    'هذا', 'هذه', 'ذلك', 'تلك', 'هناك', 'هنا', 'لكن', 'ثم', 'قد', 'لم', 'لن', 'لا',
    'بعض', 'جدا', 'تماما', 'تمامًا', 'اي', 'أي', 'مثل', 'حالة', 'ممتازة',
    'معروضة', 'للبيع', 'البيع', 'عرض', 'شحن', 'مجاني', 'استرجاع', 'تبديل', 'عدم', 'الحاجة', 'اليها', 'إليها',
    'تسوق', 'شراء', 'بيع', 'يبيع', 'للشراء', 'موجود', 'متوفر', 'وصل', 'توصيل', 'يشمل',
    'تتضمن', 'يتضمن', 'شامل', 'متاح', 'مطلوب', 'يريد', 'اريد', 'أريد', 'ابحث', 'أبحث',
    'جديد', 'شبه', 'كامل', 'كاملة', 'مجموعة', 'عدة', 'متنوعة', 'يوجد', 'اصلي', 'تقليد', 'مقاس', 'حجم',
    'بسبب', 'تغيير', 'يتم', 'التخلص', 'منها', 'كعنصر', 'غير', 'مستخدم', 'تتضمن',
    'والباقي', 'الباقي', 'باقي', 'ارجاع', 'إرجاع', 'استبدال', 'لأسباب', 'سبب', 'اسباب', 'أسباب',
    'من', 'على', 'به', 'او', 'أو', 'لا', 'في', 'مع', 'الان', 'حاليا',
    'كان', 'كانت', 'لديه', 'عنده', 'صديق', 'سابق', 'اغلق', 'أغلق', 'لبعض', 'بقي', 'دفعات',
    'مفرغة', 'مفرغ', 'نظرا', 'فهي', 'ليست', 'معباة', 'معبأة', 'فقط', 'تباع', 'بسعر',
    'منخفض', 'متوفرة', 'بشكل', 'بالجملة', 'بدون', 'خياطة', 'تحمل', 'للاستخدام', 'احترافي',
    'منافسات', 'يوان'
  ]);
  const noiseTerms = new Set([
    'مجانا', 'مجانية', 'مجانيه', 'خدمة', 'خدمات', 'خدمه', 'خدم', 'استلام',
    'تسليم', 'شامل', 'شاملا', 'امكانية', 'إمكانية', 'امكانيات', 'إمكانيات', 'امكاني', 'إمكاني',
    'ضمان', 'مرور', 'الم', 'توضيحات', 'تصحيح', 'تمرير', 'منصة', 'يلغى', 'مبلغ',
    'يمكننا', 'بالنيابة', 'يمكن', 'تفاوض', 'كميات', 'كبيرة', 'مستقر', 'مستقرة',
    'بدلا', 'بدلاً', 'عبر', 'مدفوع', 'يجب', 'استشارة', 'عملاء', 'لتفاصيل', 'تفاصيل',
    'ترسل', 'بالصور', 'تستبدل', 'بعد', 'طريقة', 'حساب', 'مباشرة', 'مدفوعة',
    'لوجستية', 'إنترنت', 'قيود', 'قيمة', 'حد', 'أدنى', 'أقل', 'متعددة', 'أنواع',
    'شخصي', 'إذا', 'نفس', 'يوم', 'صباحا', 'مساء', 'رقم', 'طلب', 'حجز', 'تتبع',
    'يرجى', 'تحقق', 'تأكد', 'صور', 'مرفوعة', 'قبلي', 'لرؤية', 'مفصل', 'ببعض',
    'شيء', 'علامات', 'شخصيا', 'توجد', 'تقريبا', 'جاهزة', 'فور', 'تلقائيا', 'نموذج',
    'مغلق', 'مغلقة', 'حدات', 'سكنية', 'بكين', 'شانغتشو', 'شانغتشانغ', 'حضرموت',
    'فوشان', 'جوميوي', 'لولو', 'باليك', 'شارك', 'موضح', 'صورة', 'تشحن', 'للإستخدام',
    'ذاتي', 'بكمية', 'كبيرة', 'جميعها', 'يدعم', 'خيارات', 'خيار', 'إنتاج', 'تاريخ',
    'وظائفها', 'تعمل', 'تحمي', 'تساعد', 'بسهولة', 'بأمان', 'اختر', 'حسب', 'معلن',
    'تحدد', 'إرساله', 'عشوائيا', 'ثانوي', 'جزئيا', 'كنت', 'موافقا', 'استخدامه', 'فتح', 'غلافه', 'قبل',
    'user', 'مصاحب', 'لمحبي', 'لمحبيه', 'لمحبية', 'لمحبيات', 'احتياجات', 'يناسب', 'مناسبة'
  ]);
  const weakSingleTerms = new Set([
    'مريحة', 'مريح', 'مريحات', 'جديدة', 'جديد', 'مستعملة', 'مستعمل', 'محمول',
    'خفيف', 'خفيفة', 'سريع', 'سريعة', 'مخصص', 'مخصصة', 'رياضي', 'رياضية',
    'فوتوغرافي', 'ميداني', 'باردة', 'بارد', 'صعبة', 'صعب', 'نظيف', 'جودة',
    'مميزة', 'موثوقة', 'جيد', 'جيدة', 'مناسبة', 'مناسب', 'طبيعي', 'صناعي',
    'ملونة', 'أخضر', 'خضراء', 'برتقالي', 'برتقالية', 'عسكري', 'بسيط', 'دافئة', 'دافئ',
    'مصنوعة', 'مصنوع', 'قابل', 'مطاطية', 'علوي', 'مرن', 'صلبة', 'مثالي', 'مثالية',
    'آمنة', 'فعالة', 'متكامل', 'متكاملة', 'مهني', 'مهنية', 'معقولة', 'تنافسية', 'متخصصة',
    'حديثة', 'حقيقية', 'عالية', 'رخيصة', 'موثوق', 'موثوقة', 'مبتكرة', 'كلاسيكي', 'كلاسيكية'
  ]);
  const latinKeywordAllowlist = new Set(['led', 'usb', 'wifi', 'typec', 'type-c']);
  const strongHeadTerms = new Set([
    'تنظيف', 'غسيل', 'غسل', 'تعقيم', 'تطهير', 'تجفيف', 'إصلاح', 'تثبيت', 'تخزين', 'حماية', 'تعبئة',
    'حقيبة', 'شنطة', 'جنطة', 'كاميرا', 'كميرا', 'عدسة', 'عدسات', 'أحذية', 'احذية', 'حذاء', 'ملابس',
    'فستان', 'سجاد', 'موكيت', 'ستائر', 'مفروشات', 'جهاز', 'هاتف', 'جوال', 'موبايل', 'مصباح', 'بطارية',
    'قطع', 'غيار', 'شفرات', 'حزام', 'كتف', 'ظهر', 'فندق', 'مكتب', 'منزل', 'غرفة', 'شركة', 'شركات',
    'إضاءة', 'اضاءة', 'مفتاح', 'طقم', 'سرير', 'طاولة', 'طاوله', 'كرسي', 'صينية', 'سراويل', 'سروال'
  ]);
  const hasStrongHeadTerm = (tokens) => tokens.some((token) => strongHeadTerms.has(token));
  const buildPhraseCandidates = (tokens) => {
    const contentTokens = tokens.filter((word) => !stopwords.has(word) && !noiseTerms.has(word));
    const phrases = [];
    for (let size = 2; size <= 3; size += 1) {
      for (let start = 0; start <= contentTokens.length - size; start += 1) {
        const candidate = contentTokens.slice(start, start + size).join(' ').trim();
        if (isUsefulPhrase(candidate)) phrases.push(candidate);
      }
    }
    return dedupeKeywordsByShape(phrases);
  };
  const isUsefulPhrase = (phrase) => {
    if (!phrase) return false;
    if (phrase.length < 4 || phrase.length > 40) return false;
    if (/[\u3400-\u9FFF【】「」『』]/.test(phrase)) return false;
    const tokens = phrase.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 3) return false;
    const contentTokens = tokens.filter((token) => !stopwords.has(token) && !noiseTerms.has(token));
    if (contentTokens.length < 2) return false;
    if (contentTokens.some((token) => /^[a-z]+$/i.test(token) && !latinKeywordAllowlist.has(token.toLowerCase()))) return false;
    if (contentTokens.every((token) => weakSingleTerms.has(token))) return false;
    if (contentTokens.filter((token) => !weakSingleTerms.has(token)).length < 1) return false;
    if (!hasStrongHeadTerm(contentTokens)) return false;
    if (contentTokens.filter((token) => weakSingleTerms.has(token)).length > 1) return false;
    return true;
  };
  const isUsefulKeyword = (word) => {
    if (!word) return false;
    if (word.length < 2 || word.length > 24) return false;
    if (/^\d+$/.test(word)) return false;
    if (/(.)\1{2,}/.test(word)) return false;
    if (/اات$/.test(word)) return false;
    if (/[\u3400-\u9FFF【】「」『』]/.test(word)) return false;
    if (/^[^a-zA-Z\u0600-\u06FF0-9]+$/.test(word)) return false;
    if (!/[a-zA-Z\u0600-\u06FF]/.test(word)) return false;
    if (noiseTerms.has(word)) return false;
    if (weakSingleTerms.has(word)) return false;
    if (/^[a-z]+$/i.test(word) && !latinKeywordAllowlist.has(word.toLowerCase())) return false;
    return true;
  };
  const splitToWords = (input) => {
    const normalized = normalizeArabicKeyword(input);
    if (!normalized) return [];
    const tokens = normalized
      .split(/\s+/)
      .map((word) => word.trim())
      .flatMap((word) => {
        if (!word) return [];
        let cleaned = word;
        if (cleaned.startsWith('و') && cleaned.length > 2) cleaned = cleaned.slice(1);
        if (cleaned.startsWith('ال') && cleaned.length > 3) cleaned = cleaned.slice(2);
        return [cleaned];
      })
      .map((word) => word.trim())
      .filter(Boolean);
    const results = buildPhraseCandidates(tokens);
    return [
      ...results,
      ...tokens.filter((word) => !stopwords.has(word) && isUsefulKeyword(word))
    ];
  };
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((k) => splitToWords(k)).filter(Boolean))];
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.flatMap((k) => splitToWords(k)).filter(Boolean))];
    }
  } catch {}
  return [...new Set(trimmed.split(/,|،|\n/).flatMap((k) => splitToWords(k)).filter(Boolean))];
}

function dedupeKeywordsByShape(list) {
  const seen = new Set();
  const unique = [];
  list.forEach((entry) => {
    const key = normalizeArabicKeyword(entry).replace(/\s+/g, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(entry);
  });
  return unique;
}

const IRAQI_SYNONYMS = {
  'طاولة': ['ميز'],
  'طاوله': ['ميز'],
  'ميز': ['طاولة', 'طاوله', 'مكتب'],
  'مكتب': ['ميز', 'طاولة', 'طاوله'],
  'جربايه': ['سرير'],
  'سرير': ['جربايه'],
  'قنفه': ['اريكة', 'كنبة'],
  'برده': ['ستاره'],
  'ستاره': ['برده'],
  'بنكه': ['مروحه'],
  'مروحه': ['بنكه'],
  'ثلاجه': ['براد'],
  'براد': ['ثلاجه'],
  'مجمد': ['فريزر'],
  'فريزر': ['مجمد'],
  'طباخ': ['فرن', 'غاز'],
  'فرن': ['طباخ'],
  'كاونتر': ['خزانه', 'مطبخ'],
  'خزانه': ['كاونتر'],
  'دوشك': ['مرتبة'],
  'شرشف': ['مفرش', 'غطاء'],
  'مفرش': ['شرشف'],
  'خاولي': ['منشفه'],
  'منشفه': ['خاولي'],
  'تراكي': ['اقراط', 'حلق'],
  'اقراط': ['تراكي'],
  'سوار': ['اسواره'],
  'اسواره': ['سوار'],
  'جنطه': ['حقيبة', 'شنطة'],
  'حذاء': ['قندرة', 'جواتي'],
  'بوط': ['حذاء', 'جواتي'],
  'جزم': ['حذاء', 'قندرة'],
  'احذية': ['قنادر', 'جواتي'],
  'قندرة': ['حذاء', 'احذية'],
  'قنادر': ['احذية', 'جواتي'],
  'جواتي': ['حذاء', 'احذية', 'قندرة'],
  'شنطة': ['جنطة', 'جنطه'],
  'حقيبة': ['جنطة', 'جنطه', 'شنطة'],
  'كنبة': ['قنفه', 'اريكه'],
  'اريكة': ['قنفه', 'كنبة'],
  'مرتبة': ['دوشك'],
  'موبايل': ['جوال', 'تلفون'],
  'هاتف': ['جوال', 'موبايل', 'تلفون'],
  'جوال': ['هاتف', 'موبايل', 'تلفون'],
  'تلفون': ['هاتف', 'موبايل', 'جوال'],
  'تلفزيون': ['شاشه'],
  'شاشه': ['تلفزيون', 'مونيتر'],
  'لابتوب': ['حاسوب', 'كمبيوتر'],
  'حاسوب': ['لابتوب', 'كمبيوتر'],
  'كمبيوتر': ['لابتوب', 'حاسوب'],
  'شاحنه': ['شاحن'],
  'شاحن': ['شاحنه'],
  'سماعه': ['سبيكر', 'سماعات'],
  'سماعة': ['سبيكر', 'سماعات'],
  'سبيكر': ['سماعة', 'سماعه', 'سماعات'],
  'كاميرا': ['camera'],
  'مكياج': ['مكياج', 'ميك اب'],
  'بنطلون': ['سروال'],
  'تيشيرت': ['تي شيرت'],
  'نعال': ['شبشب', 'شحاطه'],
  'شحاطه': ['شبشب', 'صندل'],
  'شبشب': ['شحاطة', 'شحاطه'],
  'صندل': ['شحاطة', 'شحاطه'],
  'كلاو': ['قبعه'],
  'قبعه': ['كلاو'],
  'قميص': ['تيشيرت'],
  'فستان': ['دشداشه'],
  'دشداشه': ['فستان', 'جلابية', 'ثوب'],
  'تنوره': ['skirt'],
  'قاط': ['بدله'],
  'بدله': ['قاط'],
  'بايدر': ['دراجه'],
  'دراجه': ['بايدر'],
  'سياره': ['عربه'],
  'عربه': ['سياره'],
  'ملابس': ['هدوم'],
  'هدوم': ['ملابس'],
  'نساء': ['نسائي', 'بناتي'],
  'نسائي': ['نساء', 'بناتي'],
  'رجال': ['رجالي', 'ولادي'],
  'رجالي': ['رجال', 'ولادي'],
  'اطفال': ['ولادي', 'بناتي']
};

Object.assign(IRAQI_SYNONYMS, {
  'جركس': ['مطرقة', 'شاكوش'],
  'طرمبه': ['مضخة'],
  'دافور': ['موقد'],
  'صوبة': ['مدفأة'],
  'قنينة': ['زجاجة'],
  'تنك': ['خزان'],
  'تنكه': ['علبة', 'معدنية'],
  'جكارة': ['ولاعة'],
  'كابينه': ['خزانة'],
  'دولاب': ['خزانة', 'ملابس'],
  'طبك': ['طبق'],
  'شفاط': ['مروحة', 'شفط'],
  'خلاط': ['خلاط', 'كهربائي'],
  'مفرمه': ['مفرمة'],
  'قلايه': ['مقلاة'],
  'مشبك': ['مشبك', 'غسيل'],
  'قفل': ['قفل'],
  'مفتاح': ['مفتاح'],
  'سلسله': ['سلسلة'],
  'مسامير': ['مسامير'],
  'برغي': ['برغي'],
  'كيبل شحن': ['كابل', 'شحن'],
  'باور بنك': ['بطارية', 'متنقلة', 'باوربنك'],
  'ماوس': ['فأرة', 'حاسوب'],
  'كيبورد': ['لوحة', 'مفاتيح'],
  'كامره': ['كاميرا'],
  'ستاند': ['حامل'],
  'حامل موبايل': ['حامل', 'هاتف'],
  'كفر': ['غطاء', 'هاتف'],
  'سكرين': ['واقي', 'شاشة'],
  'فلتر': ['مرشح'],
  'فلتر مي': ['فلتر', 'ماء'],
  'كولر': ['مبرد', 'ماء'],
  'كولر هواء': ['مبرد', 'هواء'],
  'جاط': ['وعاء', 'كبير'],
  'كاسه': ['وعاء'],
  'ملقط': ['ملقط'],
  'مصفايه': ['مصفاة'],
  'مبخره': ['مبخرة'],
  'مسبحه': ['سبحة'],
  'مصباح': ['مصباح', 'لمبه'],
  'كشاف': ['مصباح', 'يدوي'],
  'لمبه ليد': ['مصباح', 'ليد'],
  'فيشه': ['قابس', 'كهربائي'],
  'توصيله': ['وصلة', 'كهربائية'],
  'مقسم كهرباء': ['موزع', 'كهرباء'],
  'مروحه سقف': ['مروحة', 'سقفية'],
  'مروحه مكتب': ['مروحة', 'مكتبية'],
  'مروحه يد': ['مروحة', 'يدوية'],
  'ميزان': ['ميزان'],
  'ميزان الكتروني': ['ميزان', 'الكتروني'],
  'قنينة غاز': ['اسطوانة', 'غاز'],
  'راس غاز': ['منظم', 'غاز'],
  'لي غاز': ['خرطوم', 'غاز'],
  'كيس زباله': ['كيس', 'قمامة'],
  'سله': ['سلة'],
  'سله مهملات': ['سلة', 'قمامة'],
  'ممسحه': ['ممسحة'],
  'جارو': ['مكنسة'],
  'فرشه': ['فرشاة'],
  'اسفنجه': ['اسفنجة'],
  'مسند': ['مسند'],
  'حزام': ['حزام'],
  'ساعة': ['ساعة'],
  'ساعة حايط': ['ساعة', 'حائط'],
  'ساعة يد': ['ساعة', 'يد'],
  'نظاره': ['نظارة'],
  'نظاره شمسيه': ['نظارة', 'شمسية'],
  'مظله': ['مظلة'],
  'شماسيه': ['مظلة', 'شمسية'],
  'مكبس': ['مكبس'],
  'قشاطه': ['مقشرة'],
  'فتاحه': ['فتاحة'],
  'مبرد': ['مبرد'],
  'مقص حديد': ['مقص', 'معدني'],
  'مطرقه مطاط': ['مطرقة', 'مطاطية'],
  'قاطع': ['قاطع'],
  'فيتر': ['مرشح'],
  'جنطه سفر': ['حقيبة', 'سفر'],
  'جنطه ظهر': ['حقيبة', 'ظهر'],
  'محفظه': ['محفظة'],
  'ميداليه': ['ميدالية', 'مفاتيح']
});

Object.assign(IRAQI_SYNONYMS, {
  'جركز': ['مطرقة', 'شاكوش'],
  'ماطور': ['مولد', 'محرك'],
  'محوله': ['محول', 'كهربائي'],
  'مكناسه': ['مكنسة'],
  'خاشوكه': ['ملعقة'],
  'طاسه': ['وعاء', 'طنجرة'],
  'جدر': ['قدر', 'طبخ'],
  'جدر ضغط': ['قدر ضغط', 'طنجرة ضغط'],
  'صينيه': ['صينية'],
  'قوري': ['ابريق', 'شاي'],
  'استكان': ['كوب', 'شاي'],
  'كلاص': ['كاس', 'كوب'],
  'بوري': ['انبوب'],
  'سطل': ['دلو'],
  'طشت': ['حوض', 'طست'],
  'منشر': ['منشر', 'غسيل'],
  'بطانيه': ['بطانية'],
  'دواشك': ['مراتب', 'مرتبة'],
  'مخده': ['وسادة', 'مخدة'],
  'كبت': ['خزانة'],
  'تخت': ['سرير'],
  'جادر': ['غطاء', 'مشمع'],
  'ترمس': ['حافظة', 'حرارية'],
  'فريزه': ['مجمد', 'فريزر'],
  'مكيف': ['مكيف', 'هواء'],
  'سبلت': ['مكيف', 'سبليت'],
  'دفايه': ['مدفأة', 'دافيه'],
  'غساله': ['غسالة'],
  'نشافه': ['مجفف', 'ملابس'],
  'مكوه': ['مكواة'],
  'جويته': ['حذاء', 'جواتي'],
  'قوطية': ['علبة', 'معدنية'],
  'كارتون': ['صندوق', 'كرتون'],
  'علبه': ['علبة'],
  'باكيت': ['حزمة', 'عبوة'],
  'شماغ': ['غطاء', 'راس'],
  'عقال': ['عقال'],
  'جاكيت': ['سترة', 'جكيت'],
  'بنطرون': ['سروال', 'بنطلون'],
  'فنيله': ['قميص', 'داخلي'],
  'كيبل': ['كابل'],
  'راوتر': ['موجه', 'انترنت'],
  'مودم': ['مودم'],
  'بطاريه': ['بطارية'],
  'لمبه': ['مصباح', 'لمبة'],
  'فيش': ['قابس', 'كهربائي'],
  'ابريز': ['مقبس', 'كهربائي'],
  'تيب': ['شريط', 'لاصق'],
  'سكوتش': ['شريط', 'لاصق', 'شفاف'],
  'كتر': ['مشرط', 'سكين'],
  'شاكوش': ['مطرقة', 'جركز'],
  'بنجه': ['مفتاح', 'ربط'],
  'مفك': ['مفك', 'براغي'],
  'دريل': ['مثقاب'],
  'منشار': ['منشار'],
  'كماشه': ['كماشة'],
  'زرديه': ['زرادية'],
  'جنط': ['اطار', 'عجلة'],
  'تاير': ['اطار', 'سيارة'],
  'جك': ['رافعة', 'سيارة'],
  'مضخه': ['مضخة'],
  'خرطوم': ['انبوب', 'ماء'],
  'برميل': ['برميل'],
  'قوطية صبغ': ['علبة', 'طلاء', 'صبغ'],
  'فرشه صبغ': ['فرشاة', 'طلاء'],
  'مسطره': ['مسطرة'],
  'دفتر': ['دفتر'],
  'قلم رصاص': ['قلم', 'رصاص'],
  'برايه': ['مبراة'],
  'ممحاة': ['ممحاة'],
  'شنطه مدرسه': ['حقيبة', 'مدرسية']
});

Object.assign(IRAQI_SYNONYMS, {
  'بوري مي': ['انبوب', 'ماء'],
  'بوري مجاري': ['انبوب', 'صرف'],
  'غطا بوري': ['غطاء', 'انبوب'],
  'وصله بوري': ['وصلة', 'انبوب'],
  'كوع بوري': ['وصلة', 'زاوية', 'انبوب'],
  'مضخه مي': ['مضخة', 'ماء'],
  'موتور مي': ['محرك', 'مضخة', 'ماء'],
  'حنفيه': ['صنبور'],
  'لي مي': ['خرطوم', 'ماء'],
  'رشاش مي': ['مرش', 'ماء'],
  'كفوف': ['قفازات'],
  'خوذه': ['خوذة'],
  'نظارات حمايه': ['نظارات', 'واقية'],
  'بدله عمل': ['ملابس', 'عمل'],
  'قلم تعليم': ['قلم', 'تحديد'],
  'ماركر': ['قلم', 'تحديد'],
  'سبوره': ['لوح', 'كتابة'],
  'طباشير': ['طباشير'],
  'ملف': ['ملف', 'اوراق'],
  'حافظه اوراق': ['حافظة', 'مستندات'],
  'كيس نايلون': ['كيس', 'بلاستيك'],
  'نايلون': ['بلاستيك'],
  'مشمع': ['غطاء', 'بلاستيكي'],
  'كتر كبير': ['مشرط', 'كبير'],
  'كتر صغير': ['مشرط', 'صغير'],
  'سكينه': ['سكين'],
  'سكين مطبخ': ['سكين', 'مطبخ'],
  'لوح تقطيع': ['لوح', 'تقطيع'],
  'مدقه': ['مدقة'],
  'هاون': ['هاون'],
  'مقشه': ['مكنسة', 'يدوية'],
  'كيس غسيل': ['كيس', 'غسيل'],
  'رف': ['رف'],
  'رف حديد': ['رف', 'معدني'],
  'رف جدار': ['رف', 'جداري'],
  'برواز': ['اطار', 'صورة'],
  'لوحه حايط': ['لوحة', 'جدارية'],
  'مخده سفر': ['وسادة', 'سفر'],
  'قنفة سرير': ['اريكة', 'سرير'],
  'مخده ارضيه': ['وسادة', 'ارضية'],
  'دواشك ارضي': ['مرتبة', 'ارضية'],
  'مفرش طاوله': ['غطاء', 'طاولة'],
  'سجاده': ['سجادة'],
  'دعاسه': ['بساط', 'باب'],
  'ممسحه ارض': ['ممسحة', 'ارضية'],
  'مساحه زجاج': ['ممسحة', 'زجاج'],
  'بخاخ': ['بخاخ'],
  'قنينة بخاخ': ['زجاجة', 'رش'],
  'مبيد': ['مبيد', 'حشرات'],
  'مصيده': ['مصيدة'],
  'مصيده فئران': ['مصيدة', 'فئران'],
  'مصيده حشرات': ['مصيدة', 'حشرات'],
  'كاشف دخان': ['جهاز', 'كشف', 'الدخان'],
  'كاشف غاز': ['جهاز', 'كشف', 'الغاز'],
  'كامره مراقبه': ['كاميرا', 'مراقبة'],
  'جهاز تسجيل كامرات': ['مسجل', 'كاميرات'],
  'شاشه كمبيوتر': ['شاشة', 'حاسوب'],
  'شاشه تلفزيون': ['شاشة', 'تلفاز'],
  'ريموت': ['جهاز', 'تحكم'],
  'ستلايت': ['جهاز', 'استقبال', 'فضائي'],
  'دش': ['طبق', 'استقبال', 'فضائي'],
  'راس دش': ['راس', 'طبق', 'فضائي'],
  'سلك دش': ['كابل', 'فضائي'],
  'سماعه بلوتوث': ['سماعة', 'بلوتوث'],
  'مكبر صوت': ['مكبر', 'صوت'],
  'حامل تلفزيون': ['حامل', 'تلفاز'],
  'حامل جدار': ['حامل', 'جداري'],
  'مبرد لابتوب': ['مبرد', 'حاسوب', 'محمول'],
  'طابعه': ['طابعة'],
  'حبر طابعه': ['حبر', 'طابعة'],
  'ورق طابعه': ['ورق', 'طباعة'],
  'كابل طابعه': ['كابل', 'طابعة'],
  'موزع نت': ['موزع', 'انترنت'],
  'مقوي واي فاي': ['مقوي', 'اشارة'],
  'حامل كامره': ['حامل', 'كاميرا'],
  'ستاند اضاءة': ['حامل', 'اضاءة'],
  'لمبه طوارئ': ['مصباح', 'طوارئ'],
  'كشاف يدوي': ['مصباح', 'يدوي'],
  'كشاف راس': ['مصباح', 'راس'],
  'حبل': ['حبل'],
  'جنزير': ['سلسلة', 'معدنية'],
  'قفل باب': ['قفل', 'باب'],
  'مقبض باب': ['مقبض', 'باب'],
  'مفصل باب': ['مفصل', 'باب'],
  'مسمار تثبيت': ['مسمار', 'تثبيت'],
  'مسمار جدار': ['مسمار', 'جدار'],
  'مسامير خشب': ['مسامير', 'خشب'],
  'مسامير حديد': ['مسامير', 'معدنية'],
  'لاصق': ['مادة', 'لاصقة'],
  'غرا': ['غراء'],
  'غرا قوي': ['غراء', 'قوي'],
  'سيليكون': ['سيليكون'],
  'مسدس سيليكون': ['مسدس', 'سيليكون'],
  'بخاخ صبغ': ['بخاخ', 'طلاء'],
  'رول صبغ': ['اسطوانة', 'طلاء'],
  'سطل صبغ': ['دلو', 'طلاء']
});

function expandIraqiKeywords(list) {
  const extras = [];
  list.forEach((entry) => {
    const normalized = normalizeArabicKeyword(entry);
    if (!normalized) return;
    const wholeMapped = IRAQI_SYNONYMS[normalized];
    if (Array.isArray(wholeMapped)) {
      wholeMapped.forEach((m) => extras.push(m));
    }
    const tokens = normalized.split(/\s+/).filter(Boolean);
    tokens.forEach((token) => {
      const mapped = IRAQI_SYNONYMS[token];
      if (!mapped) return;
      mapped.forEach((m) => extras.push(m));
    });
  });
  return dedupeKeywordsByShape(extras);
}

function buildKeywordCandidatesFromText(text) {
  return normalizeKeywordList(text);
}

const ARABIC_IRREGULAR_PLURAL_MAP = {
  'مصباح': ['مصابيح'],
  'مصابيح': ['مصباح'],
  'مفتاح': ['مفاتيح'],
  'مفاتيح': ['مفتاح'],
  'كتاب': ['كتب'],
  'كتب': ['كتاب'],
  'قلم': ['اقلام'],
  'اقلام': ['قلم'],
  'هاتف': ['هواتف'],
  'هواتف': ['هاتف'],
  'حاسوب': ['حواسيب'],
  'حواسيب': ['حاسوب'],
  'حقيبة': ['حقائب'],
  'حقائب': ['حقيبة'],
  'حذاء': ['احذية'],
  'احذية': ['حذاء'],
  'ساعة': ['ساعات'],
  'ساعات': ['ساعة'],
  'سماعة': ['سماعات'],
  'سماعات': ['سماعة']
};

function expandArabicSingularPlural(list) {
  const extras = [];
  list.forEach((entry) => {
    const token = normalizeArabicKeyword(entry);
    if (!token || token.length < 2 || token.includes(' ')) return;
    const irregular = ARABIC_IRREGULAR_PLURAL_MAP[token];
    if (Array.isArray(irregular)) extras.push(...irregular);
    if (token.endsWith('ات') && token.length > 3) {
      const stem = token.slice(0, -2);
      if (stem.length >= 3 && !stem.endsWith('ي')) extras.push(`${stem}ة`, `${stem}ه`);
    } else if ((token.endsWith('ة') || token.endsWith('ه')) && token.length > 3) {
      const stem = token.slice(0, -1);
      if (stem.length >= 3) extras.push(`${stem}ات`);
    }
  });
  return dedupeKeywordsByShape(extras);
}

const CATEGORY_KEYWORD_RULES = [
  { signals: ['مصباح', 'اضاءة', 'إنارة', 'نور', 'ليد', 'LED', 'كشاف', 'فانوس'], keywords: ['انارة', 'مصابيح', 'لمبات', 'كشافات', 'مصباح'], minSignals: 1 },
  { signals: ['تخييم', 'مخيم', 'كشتة', 'خيمة', 'رحلات'], keywords: ['تخييم', 'رحلات', 'معدات تخييم', 'لوازم بر', 'ادوات رحلات'], minSignals: 2 },
  { signals: ['حذاء', 'احذية', 'قندرة', 'جواتي', 'شوز'], keywords: ['احذية', 'حذاء رجالي', 'حذاء نسائي', 'احذية رياضية', 'احذية كاجوال'], minSignals: 1 },
  { signals: ['شنطة', 'جنطة', 'حقيبة', 'باك'], keywords: ['حقائب', 'شنط', 'حقيبة يد', 'شنطة كتف', 'حقيبة ظهر'], minSignals: 1 },
  { signals: ['هاتف', 'موبايل', 'جوال', 'تلفون'], keywords: ['الكترونيات', 'هواتف', 'اكسسوارات موبايل', 'تقنية', 'اتصالات'], minSignals: 1 },
  { signals: ['سماعة', 'سماعات', 'سبيكر', 'بلوتوث'], keywords: ['اكسسوارات صوت', 'سماعات', 'الكترونيات', 'بلوتوث', 'صوتيات'], minSignals: 1 },
  { signals: ['ساعة', 'ساعات', 'ذكية'], keywords: ['ساعات', 'اكسسوارات', 'ساعة ذكية', 'ساعة يد', 'اكسسوارات الكترونية'], minSignals: 1 },
  { signals: ['قميص', 'تيشيرت', 'بلوزة', 'بنطلون', 'فستان', 'عباية', 'ملابس'], keywords: ['ملابس', 'ازياء', 'ملابس رجالية', 'ملابس نسائية', 'ملابس اطفال'], minSignals: 1 },
  { signals: ['كنبة', 'اريكة', 'طاولة', 'كرسي', 'خزانة', 'سرير', 'مطبخ'], keywords: ['اثاث', 'منزل', 'ديكور', 'غرفة نوم', 'مطبخ'], minSignals: 1 },
  { signals: ['عطر', 'كريم', 'سيروم', 'مكياج', 'ميك اب'], keywords: ['عناية', 'جمال', 'مستحضرات تجميل', 'عطور', 'العناية بالبشرة'], minSignals: 1 },
  { signals: ['لعبة', 'العاب', 'اطفال', 'بيبي', 'رضيع'], keywords: ['اطفال', 'العاب', 'مستلزمات اطفال', 'هدايا اطفال', 'ترفيه'], minSignals: 1 },
  { signals: ['سيارة', 'سيارات', 'اطار', 'رافعة', 'تاير'], keywords: ['سيارات', 'اكسسوارات سيارات', 'ادوات', 'معدات', 'ورشة'], minSignals: 1 }
];

function inferCategoryKeywords(seedText, list = []) {
  const haystack = normalizeArabicKeyword(`${seedText || ''} ${(Array.isArray(list) ? list.join(' ') : '')}`);
  if (!haystack) return [];
  const matched = [];
  CATEGORY_KEYWORD_RULES.forEach((rule) => {
    const signalHits = rule.signals.filter((signal) => haystack.includes(normalizeArabicKeyword(signal)));
    const requiredHits = Math.max(1, Number(rule.minSignals || 1));
    if (signalHits.length >= requiredHits) matched.push(...rule.keywords);
  });
  return dedupeKeywordsByShape(matched);
}

function ensureKeywordList(value, seedText = '') {
  const normalized = dedupeKeywordsByShape(normalizeKeywordList(value))
    .filter((k) => k.length >= 2);
  const extras = dedupeKeywordsByShape(buildKeywordCandidatesFromText(seedText));
  const iraqiExtras = expandIraqiKeywords([...normalized, ...extras]);
  const singularPluralExtras = expandArabicSingularPlural([...normalized, ...extras, ...iraqiExtras]);
  const categoryExtras = inferCategoryKeywords(seedText, [...normalized, ...extras, ...iraqiExtras, ...singularPluralExtras]);
  const actionTerms = new Set(['تنظيف', 'غسيل', 'غسل', 'تعقيم', 'تطهير', 'تجفيف', 'إصلاح', 'تثبيت', 'تخزين', 'حماية', 'تعبئة', 'شحن']);
  const productTerms = new Set([
    'حقيبة', 'شنطة', 'جنطة', 'كاميرا', 'كميرا', 'عدسة', 'عدسات', 'أحذية', 'احذية', 'حذاء',
    'ملابس', 'فستان', 'سجاد', 'موكيت', 'ستائر', 'مفروشات', 'جهاز', 'هاتف', 'جوال', 'موبايل',
    'مصباح', 'بطارية', 'مفتاح', 'طقم', 'سرير', 'طاولة', 'طاوله', 'كرسي', 'صينية', 'سراويل',
    'سروال', 'مطبخ', 'طباخ', 'مقلاة', 'صندوق', 'لعبة', 'دمية', 'رداء', 'غطاء'
  ]);
  const categoryTerms = new Set([
    'رياضية', 'رياضي', 'بانورامية', 'منزلية', 'مكتبية', 'نسائية', 'رجالية', 'داخلية',
    'خارجية', 'لاسلكي', 'كهربائي', 'سيليكون', 'جلدية', 'قطن', 'مصري', 'شموع', 'مطبخ'
  ]);
  const scorePhrasePattern = (key) => {
    const tokens = key.split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens.length > 3) return 0;
    const [first, second, third] = tokens;
    let score = 0;
    if (actionTerms.has(first) && (productTerms.has(second) || categoryTerms.has(second))) score += 5;
    if (productTerms.has(first) && (productTerms.has(second) || categoryTerms.has(second))) score += 4;
    if (categoryTerms.has(first) && productTerms.has(second)) score += 2;
    if (third) {
      if (actionTerms.has(first) && productTerms.has(second) && (productTerms.has(third) || categoryTerms.has(third))) score += 4;
      if (productTerms.has(first) && productTerms.has(second) && categoryTerms.has(third)) score += 3;
      if (productTerms.has(first) && categoryTerms.has(second) && productTerms.has(third)) score += 2;
    }
    if (!tokens.some((token) => actionTerms.has(token) || productTerms.has(token))) score -= 3;
    return score;
  };
  const aiSet = new Set(normalized.map(normalizeArabicKeyword));
  const textSet = new Set(extras.map(normalizeArabicKeyword));
  const iraqiSet = new Set(iraqiExtras.map(normalizeArabicKeyword));
  const variantSet = new Set(singularPluralExtras.map(normalizeArabicKeyword));
  const categorySet = new Set(categoryExtras.map(normalizeArabicKeyword));
  return dedupeKeywordsByShape([...normalized, ...extras, ...iraqiExtras, ...singularPluralExtras, ...categoryExtras])
    .filter((k) => k.length >= 2)
    .map((keyword, index) => {
      const key = normalizeArabicKeyword(keyword);
      let score = 0;
      if (textSet.has(key)) score += 5;
      if (aiSet.has(key)) score += 4;
      if (categorySet.has(key)) score += 3;
      if (iraqiSet.has(key)) score += 2;
      if (variantSet.has(key)) score += 1;
      if (key.includes(' ')) score += 3 + scorePhrasePattern(key);
      if (key.length >= 4) score += 1;
      return { keyword, score: score - (index * 0.01) };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ keyword }) => keyword)
    .slice(0, KEYWORDS_PER_PRODUCT);
}


function detectNewOrOldFromTexts(title, conditionText) {
  const text = `${String(title || '')} ${String(conditionText || '')}`.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  const mixedRegex = /(some\s+are\s+new|partly\s+new|partial(?:ly)?\s+new|mix(?:ed)?\s+condition|部分全新|部分新品|有新有旧|بعضها\s+جديد|جزء\s+جديد)/i;
  if (mixedRegex.test(normalized)) return null;
  const usedRegex = /(轻微使用痕迹|使用痕迹|二手|闲置|自用|有磨损|有划痕|成色|旧款|旧包|旧货|used|pre[-\s]?owned|second[-\s]?hand)/i;
  const newRegex = /(全新|全新未使用|未使用|未拆封|全新带吊牌|全新带标签|吊牌未拆|brand\s*new)/i;
  if (usedRegex.test(normalized)) return false;
  if (newRegex.test(normalized)) return true;
  return null;
}

function detectRealBrandFromTexts(title, conditionText) {
  const text = `${String(title || '')} ${String(conditionText || '')}`.trim();
  if (!text) return null;
  const mixedRegex = /(some\s+are\s+real|partly\s+authentic|partial(?:ly)?\s+authentic|mixed\s+authenticity|部分正品|有真有假|بعضها\s+أصلي|جزء\s+أصلي)/i;
  if (mixedRegex.test(text.toLowerCase())) return null;
  const negativeRegex = /(高仿|复刻|仿|a货|同款|平替|替代款|1[:：]\s*1|replica|fake|copy)/i;
  const positiveRegex = /(正品|专柜正品|官方正品|品牌正品|保真|真品|原装|官方|直营|authentic|genuine|original)/i;
  if (negativeRegex.test(text)) return false;
  if (positiveRegex.test(text)) return true;
  return null;
}

function sanitizeTranslationText(value) {
  return String(value || '')
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .replace(/(?:^|\s)user\s+translate\s+this\s+chinese\s+product\s+title\s+to\s+arabic\.?\s*return\s+arabic\s+only\.?/gi, ' ')
    .replace(/translate\s+this\s+chinese\s+product\s+title\s+to\s+arabic\.?\s*return\s+arabic\s+only\.?/gi, ' ')
    .replace(/请用阿拉伯语翻译这个产品标题[:：]?\s*/g, ' ')
    .replace(/^\s*(title_ar|titlear|description_ar|descriptionar|full_description_ar|fullDescriptionAr)\s*[:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAiTranslationPayload(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
  let parsed = null;
  try {
    parsed = JSON.parse(normalized);
  } catch {}
  if (!parsed) {
    const jsonMatch = normalized.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {}
    }
  }
  const titleLine = normalized.match(/(?:^|\n|[{,]\s*)["']?(?:title_ar|titleAr|title)["']?\s*[:：]\s*["']?([^,"\n}]+)["']?/i)?.[1]?.trim();
  const descriptionLine = normalized.match(/(?:^|\n|[{,]\s*)["']?(?:description_ar|descriptionAr|full_description_ar|fullDescriptionAr)["']?\s*[:：]\s*["']?([^}\n]+)["']?/i)?.[1]?.trim();
  const keywordLine = normalized.match(/(?:^|\n)\s*keywords?\s*[:：]\s*(.+)/i)?.[1]?.trim();
  if (!parsed && !titleLine && !descriptionLine && !keywordLine) return null;
  return {
    title_ar: parsed?.title_ar ?? parsed?.titleAr ?? parsed?.title ?? titleLine ?? '',
    description_ar: parsed?.description_ar ?? parsed?.descriptionAr ?? parsed?.full_description_ar ?? parsed?.fullDescriptionAr ?? descriptionLine ?? '',
    keywords: Array.isArray(parsed?.keywords)
      ? parsed.keywords
      : (parsed?.keywords ?? parsed?.keywords_csv ?? keywordLine ?? '')
  };
}

function normalizeTranslationCacheKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function loadTranslationCache() {
  try {
    if (!fs.existsSync(TRANSLATION_CACHE_PATH)) return {};
    const raw = fs.readFileSync(TRANSLATION_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveTranslationCache(cache) {
  try {
    fs.writeFileSync(TRANSLATION_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {}
}

function loadTermDetailLinks() {
  try {
    if (!fs.existsSync(TERM_DETAIL_LINKS_PATH)) return null;
    const raw = fs.readFileSync(TERM_DETAIL_LINKS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return {
      batchId: parsed.batchId || null,
      termIndex: Number.isFinite(Number(parsed.termIndex)) ? Number(parsed.termIndex) : null,
      term: String(parsed.term || ''),
      items: items
        .map((item) => ({
          url: String(item?.url || '').trim(),
          title: String(item?.title || '').trim(),
          image: String(item?.image || '').trim()
        }))
        .filter((item) => Boolean(item.url))
    };
  } catch {
    return null;
  }
}

function saveTermDetailLinks(batchId, termIndex, term, items) {
  try {
    const payload = {
      batchId: batchId || null,
      termIndex: Number.isFinite(Number(termIndex)) ? Number(termIndex) : null,
      term: String(term || ''),
      items: (Array.isArray(items) ? items : [])
        .map((item) => ({
          url: String(item?.url || '').trim(),
          title: String(item?.title || '').trim(),
          image: String(item?.image || '').trim()
        }))
        .filter((item) => Boolean(item.url))
        .slice(0, ITEMS_PER_SEARCH),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(TERM_DETAIL_LINKS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

function clearTermDetailLinks() {
  try {
    if (fs.existsSync(TERM_DETAIL_LINKS_PATH)) fs.unlinkSync(TERM_DETAIL_LINKS_PATH);
  } catch {}
}

function loadBatchLinksQueue() {
  try {
    if (!fs.existsSync(BATCH_LINKS_PATH)) return null;
    const raw = fs.readFileSync(BATCH_LINKS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.termStates)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveBatchLinksQueue(queue) {
  try {
    fs.writeFileSync(BATCH_LINKS_PATH, JSON.stringify(queue, null, 2), 'utf8');
  } catch {}
}

function clearBatchLinksQueue() {
  try {
    if (fs.existsSync(BATCH_LINKS_PATH)) fs.unlinkSync(BATCH_LINKS_PATH);
  } catch {}
}

function hasPendingBatchQueueWork(queue, expectedBatchId = null, expectedTermCount = null) {
  if (!queue || typeof queue !== 'object') return false;
  if (expectedBatchId && queue.batchId !== expectedBatchId) return false;
  if (!Array.isArray(queue.termStates)) return false;
  if (expectedTermCount != null && queue.termStates.length !== expectedTermCount) return false;
  const termStates = queue.termStates;
  const hasQueuedItems = termStates.some((state) => Array.isArray(state?.items) && state.items.length > 0);
  const hasUncollectedTerms = termStates.some((state) => !state?.collectDone);
  const phase = String(queue.phase || '').toLowerCase();
  if (phase === 'collect') return hasUncollectedTerms || hasQueuedItems;
  if (phase === 'process') return hasQueuedItems || Math.max(0, Number(queue.nextProcessTerm || 0)) < termStates.length;
  return hasUncollectedTerms || hasQueuedItems;
}

function getCachedTranslation(cache, title) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return null;
  const entry = cache[key];
  if (!entry || typeof entry !== 'object') return null;
  const titleAr = normalizeTranslatedTitle(entry.titleAr, title);
  const descriptionAr = cleanDescriptionText(entry.descriptionAr || entry.translatedDescription || titleAr || title) || titleAr || title;
  if (isLowQualityTranslationText(titleAr, 3) || isLowQualityTranslationText(descriptionAr, 6)) return null;
  const seedText = `${titleAr} ${descriptionAr}`.trim();
  const keywords = ensureKeywordList(entry.keywords, seedText);
  return { titleAr, descriptionAr, keywords };
}

function setCachedTranslation(cache, title, data) {
  const key = normalizeTranslationCacheKey(title);
  if (!key) return;
  const normalizedTitleAr = normalizeTranslatedTitle(data?.titleAr, title);
  const descriptionAr = cleanDescriptionText(data?.descriptionAr || data?.translatedDescription || normalizedTitleAr || title);
  if (isLowQualityTranslationText(normalizedTitleAr, 3) || isLowQualityTranslationText(descriptionAr, 6)) return;
  const seedText = `${normalizedTitleAr} ${descriptionAr}`.trim();
  cache[key] = {
    titleAr: normalizedTitleAr,
    descriptionAr,
    keywords: ensureKeywordList(data?.keywords, seedText),
    updatedAt: new Date().toISOString()
  };
}

puppeteer.use(StealthPlugin());

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

// UA List for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'
];

function getExecutablePath() {
  const envPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.GOOFISH_CHROME_PATH,
    process.env.CHROME_PATH
  ].filter(Boolean);
  for (const p of envPaths) {
    if (fs.existsSync(p)) return p;
  }

  if (process.platform === 'linux') {
    const linuxPaths = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/opt/google/chrome/chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    ];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
    const commands = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium', 'chrome'];
    for (const command of commands) {
      try {
        const resolved = spawnSync('which', [command], { encoding: 'utf8' });
        if (resolved.status === 0) {
          const candidate = String(resolved.stdout || '').trim().split('\n')[0];
          if (candidate && fs.existsSync(candidate)) return candidate;
        }
      } catch {}
    }
    return null;
  }
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findChromeInPuppeteerCache() {
  const roots = [
    path.join(process.cwd(), '.cache', 'puppeteer'),
    path.join(process.cwd(), '..', '.cache', 'puppeteer'),
    path.join('/app', '.cache', 'puppeteer'),
    path.join('/root', '.cache', 'puppeteer')
  ];
  const seen = new Set();
  const walk = (dir) => {
    let files = [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      if (entry.isDirectory()) {
        files = files.concat(walk(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  };
  for (const root of roots) {
    const files = walk(root);
    const match = files.find((filePath) => /[\\/]chrome(?:\.exe)?$/.test(filePath) && filePath.includes('chrome-linux'));
    if (match) return match;
  }
  return null;
}

function installChromeForLinux() {
  const result = spawnSync('npx', ['-y', '@puppeteer/browsers', 'install', 'chrome@stable', '--path', '.cache/puppeteer'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  return result.status === 0;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));
const humanDelay = (min = 1000, max = 3000) => delay(Math.floor(Math.random() * (max - min + 1)) + min);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function loadUpdateExistingProgress() {
  if (!fs.existsSync(UPDATE_PROGRESS_PATH)) return null;
  try {
    const raw = fs.readFileSync(UPDATE_PROGRESS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      lastId: Math.max(0, Number(parsed.lastId || 0) || 0),
      scanned: Math.max(0, Number(parsed.scanned || 0) || 0),
      updatedCount: Math.max(0, Number(parsed.updatedCount || 0) || 0),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch {
    return null;
  }
}

function saveUpdateExistingProgress(progress) {
  try {
    const payload = {
      lastId: Math.max(0, Number(progress?.lastId || 0) || 0),
      scanned: Math.max(0, Number(progress?.scanned || 0) || 0),
      updatedCount: Math.max(0, Number(progress?.updatedCount || 0) || 0),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(UPDATE_PROGRESS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to save update progress:', error?.message || error);
  }
}

function clearUpdateExistingProgress() {
  try {
    if (fs.existsSync(UPDATE_PROGRESS_PATH)) fs.unlinkSync(UPDATE_PROGRESS_PATH);
  } catch (error) {
    console.warn('Failed to clear update progress:', error?.message || error);
  }
}

function loadSearchTermHistory() {
  if (!fs.existsSync(SEARCH_TERMS_PATH)) return { used: [], batches: [], activeBatch: null };
  try {
    const raw = fs.readFileSync(SEARCH_TERMS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const used = Array.isArray(parsed?.used) ? parsed.used : [];
    const batches = Array.isArray(parsed?.batches) ? parsed.batches : [];
    const activeBatch = parsed?.activeBatch && typeof parsed.activeBatch === 'object' ? parsed.activeBatch : null;
    return { used, batches, activeBatch };
  } catch {
    return { used: [], batches: [], activeBatch: null };
  }
}

function saveSearchTermHistory(history) {
  fs.writeFileSync(SEARCH_TERMS_PATH, JSON.stringify(history, null, 2));
}

let dbConnectPromise = null;
let dbLastConnectError = null;

const resetPrismaClient = async (label = 'db reset') => {
  const oldPrisma = prisma;
  dbConnectPromise = null;
  dbReady = false;
  dbChecked = false;
  try {
    await Promise.race([
      oldPrisma.$disconnect(),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
  } catch {}
  prisma = createPrismaClient();
};

const isDbEngineError = (error) => {
  const msg = String(error?.message || '');
  return msg.includes('Engine is not yet connected')
    || msg.includes('Response from the Engine was empty');
};

const isDbConnectionFailure = (error) => {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  return isDbEngineError(error)
    || msg.includes('Timed out fetching a new connection from the connection pool')
    || msg.includes("Can't reach database server")
    || msg.includes('timed out after')
    || msg.includes('db connect failed')
    || msg.includes('Server has closed the connection')
    || code === 'P2024'
    || code === 'P1017'
    || code === 'P1001';
};

const isDbCircuitOpen = () => Date.now() < dbCircuitOpenUntil;

const recordDbEngineFailure = (error) => {
  if (!isDbConnectionFailure(error)) return;
  const now = Date.now();
  dbEngineFailureTimestamps = dbEngineFailureTimestamps.filter((ts) => now - ts <= GOOFISH_DB_ENGINE_FAILURE_WINDOW_MS);
  dbEngineFailureTimestamps.push(now);
  if (dbEngineFailureTimestamps.length >= GOOFISH_DB_ENGINE_FAILURE_THRESHOLD) {
    dbCircuitOpenUntil = now + GOOFISH_DB_ENGINE_COOLDOWN_MS;
    dbEngineFailureTimestamps = [];
    dbReady = false;
    dbChecked = false;
    console.warn(`[DB Circuit] Opened for ${GOOFISH_DB_ENGINE_COOLDOWN_MS}ms after repeated Prisma engine errors.`);
  }
};

function clearSearchTermHistory() {
  try {
    if (fs.existsSync(SEARCH_TERMS_PATH)) fs.unlinkSync(SEARCH_TERMS_PATH);
    console.log('Search term history reset.');
  } catch (error) {
    console.warn('Failed to reset search term history:', error?.message || error);
  }
}

function resetRunProgressKeepTermMemory() {
  try {
    const history = loadSearchTermHistory();
    const nextHistory = {
      used: Array.isArray(history.used) ? history.used : [],
      batches: Array.isArray(history.batches) ? history.batches : [],
      activeBatch: null
    };
    saveSearchTermHistory(nextHistory);
    console.log('Run progress reset while preserving term memory.');
  } catch (error) {
    console.warn('Failed to reset run progress with term memory:', error?.message || error);
  }
}

function isFoodTerm(term) {
  return FOOD_BLACKLIST.some((word) => term.includes(word));
}

function normalizeSearchTerm(term) {
  return String(term || '').trim().replace(/\s+/g, '');
}

function shuffleTerms(terms) {
  const arr = [...terms];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function generateSearchTermsWithAi(existingTerms) {
  const allNormalizedTerms = existingTerms.map(normalizeSearchTerm).filter(Boolean);
  const recentTerms = allNormalizedTerms.slice(-400);
  const existingSet = new Set(allNormalizedTerms);
  const termsToAvoid = recentTerms.slice(-120).join(', ');

  let results = [];
  let usedAi = false;
  const termGenAttempts = Math.max(1, Math.min(MAX_AI_ATTEMPTS, GOOFISH_TERM_AI_MAX_ATTEMPTS));
  for (let attempt = 0; attempt < termGenAttempts && results.length < GOOFISH_TERMS_PER_BATCH; attempt += 1) {
    console.log(`[AI Term Gen] Requesting new terms from SiliconFlow (attempt ${attempt + 1})...`);
    const prompt = [
      {
        role: 'system',
        content: 'You generate Chinese e-commerce category search terms for a marketplace like Xianyu. Output only valid JSON.'
      },
      {
        role: 'user',
        content: `Generate exactly ${GOOFISH_TERMS_PER_BATCH} unique Chinese category search terms for an e-commerce marketplace like Xianyu. 
Focus on shopping categories: electronics, phone accessories, home goods, furniture, fashion, shoes, bags, beauty, baby/kids, sports, tools, auto accessories, office, gaming, photography.
Avoid all food or grocery terms. Avoid brand names. Use short, natural category phrases in Chinese.
IMPORTANT: Do NOT use any of the following terms: ${termsToAvoid}.
Return a JSON array only, no other text or punctuation.`
      }
    ];
    const raw = await callSiliconFlow(prompt, 0.6, 500, {
      timeoutMs: GOOFISH_TERM_AI_CALL_TIMEOUT_MS,
      maxAttempts: GOOFISH_TERM_AI_MAX_ATTEMPTS
    });
    if (!raw) {
      console.log('[AI Term Gen] SiliconFlow returned empty or null response.');
      break;
    }
    usedAi = true;
    const cleaned = raw.trim().replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    console.log('[AI Term Gen] Raw response:', cleaned.substring(0, 100) + '...');
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }
    let candidates = Array.isArray(parsed) ? parsed : [];
    if (candidates.length === 0) {
      const quoted = cleaned.match(/"([^"\r\n]{2,40})"/g) || [];
      candidates = quoted.map((entry) => entry.replace(/^"/, '').replace(/"$/, ''));
    }
    for (const entry of candidates) {
      const term = normalizeSearchTerm(entry);
      if (!term || term.length < 2) continue;
      if (!isChineseTerm(term)) continue;
      if (isFoodTerm(term)) continue;
      if (existingSet.has(term)) continue;
      if (!results.includes(term)) results.push(term);
      if (results.length >= GOOFISH_TERMS_PER_BATCH) break;
    }
  }
  
  if (results.length > 0) {
    console.log(`[AI Term Gen] Successfully generated ${results.length} terms using SiliconFlow:`);
    console.log(results.join(', '));
  } else {
    console.log('[AI Term Gen] Failed to generate terms or API returned empty list.');
  }

  return { terms: results.slice(0, GOOFISH_TERMS_PER_BATCH), usedAi };
}

async function getSearchTermsForRun() {
  const history = loadSearchTermHistory();
  const existingQueue = loadBatchLinksQueue();
  let activeBatch = history.activeBatch;

  if (!activeBatch && existingQueue?.batchId) {
    const matchingBatch = (Array.isArray(history.batches) ? history.batches : [])
      .find((batch) => batch?.id === existingQueue.batchId && Array.isArray(batch?.terms) && batch.terms.length > 0);
    if (matchingBatch && hasPendingBatchQueueWork(existingQueue, matchingBatch.id, matchingBatch.terms.length)) {
      activeBatch = {
        id: matchingBatch.id,
        generatedAt: matchingBatch.generatedAt || new Date().toISOString(),
        terms: matchingBatch.terms,
        nextIndex: Math.max(0, Number(existingQueue.nextCollectTerm || 0) || 0),
        source: matchingBatch.source || 'resume',
        checkpoint: null,
        updatedAt: new Date().toISOString()
      };
      saveSearchTermHistory({ ...history, activeBatch });
    }
  }

  if (activeBatch && Array.isArray(activeBatch.terms) && activeBatch.terms.length > 0) {
    const activeNextIndex = Math.max(0, Number(activeBatch.nextIndex || 0) || 0);
    const hasPendingCheckpoint = Boolean(activeBatch.checkpoint && typeof activeBatch.checkpoint === 'object');
    const hasPendingQueue = hasPendingBatchQueueWork(existingQueue, activeBatch.id, activeBatch.terms.length);
    if (activeNextIndex >= activeBatch.terms.length && !hasPendingCheckpoint && !hasPendingQueue) {
      clearActiveBatch(activeBatch.id);
      activeBatch = null;
    }
  }

  if (activeBatch && Array.isArray(activeBatch.terms) && activeBatch.terms.length > 0) {
    const batchSource = activeBatch.source || 'resume';
    if (AI_ONLY_TERMS && batchSource !== 'ai' && batchSource !== 'custom') {
      clearActiveBatch(activeBatch.id);
    } else {
      return {
        terms: activeBatch.terms,
        startIndex: Math.max(0, Number(activeBatch.nextIndex || 0) || 0),
        batchId: activeBatch.id || activeBatch.generatedAt || null,
        source: batchSource,
        checkpoint: activeBatch.checkpoint || null
      };
    }
  }
  
  // Use custom terms if available - use all terms sequentially, don't batch
  if (customTerms && Array.isArray(customTerms) && customTerms.length > 0) {
    const history = loadSearchTermHistory();
    const existingActiveBatch = history.activeBatch;
    
    // Resume from existing batch if it matches custom terms
    if (existingActiveBatch && existingActiveBatch.source === 'custom' && 
        Array.isArray(existingActiveBatch.terms) && existingActiveBatch.terms.length === customTerms.length) {
      const nextIndex = Math.max(0, Math.min(customTerms.length, Number(existingActiveBatch.nextIndex || 0) || 0));
      console.log(`[Custom Terms] Resuming from term ${nextIndex}/${customTerms.length}`);
      return { 
        terms: customTerms, 
        startIndex: nextIndex, 
        batchId: existingActiveBatch.id || `custom_${Date.now()}`, 
        source: 'custom', 
        checkpoint: existingActiveBatch.checkpoint || null 
      };
    }
    
    // Start fresh from "床单" (index 48) or specified index
    const startIndex = 48; // Start from "床单"
    const batchId = `custom_${Date.now()}`;
    const active = { 
      id: batchId, 
      generatedAt: new Date().toISOString(), 
      terms: customTerms, 
      nextIndex: startIndex, 
      source: 'custom',
      checkpoint: null
    };
    const nextHistory = {
      used: customTerms.slice(0, startIndex), // Mark terms before start index as used
      batches: [
        ...(Array.isArray(history.batches) ? history.batches : []),
        { id: batchId, generatedAt: active.generatedAt, terms: customTerms, source: 'custom' }
      ],
      activeBatch: active
    };
    saveSearchTermHistory(nextHistory);
    clearBatchLinksQueue();
    console.log(`[Custom Terms] Using all ${customTerms.length} custom terms, starting from index ${startIndex} ("床单")`);
    return { terms: customTerms, startIndex, batchId, source: 'custom', checkpoint: null };
  }
  
  const existing = Array.isArray(history.used) ? history.used : [];
  const existingNormalized = new Set(existing.map(normalizeSearchTerm).filter(Boolean));
  const aiResult = await generateSearchTermsWithAi(existing);
  let finalTerms = aiResult.terms;
  let source = aiResult.usedAi ? 'ai' : 'fallback';
  let historyUsed = existing;
  let historyUsedNormalized = existingNormalized;
  if (AI_ONLY_TERMS && !SILICONFLOW_API_KEY) {
    throw new Error('AI-only mode is enabled but SILICONFLOW_API_KEY is missing.');
  }
  if (AI_ONLY_TERMS && finalTerms.length < GOOFISH_TERMS_PER_BATCH) {
    throw new Error(`AI-only mode could not generate ${GOOFISH_TERMS_PER_BATCH} unique terms.`);
  }
  if (finalTerms.length < GOOFISH_TERMS_PER_BATCH) {
    const fallback = DEFAULT_SEARCH_TERMS
      .map(normalizeSearchTerm)
      .filter((term) => term && !historyUsedNormalized.has(term) && !isFoodTerm(term));
    finalTerms = [...finalTerms, ...fallback].slice(0, GOOFISH_TERMS_PER_BATCH);
    source = 'fallback';
  }
  if (finalTerms.length < GOOFISH_TERMS_PER_BATCH) {
    console.warn(
      `[AI Term Gen] Term history exhausted after ${historyUsedNormalized.size} used terms. Resetting used-term memory and reusing fallback terms.`
    );
    historyUsed = [];
    historyUsedNormalized = new Set();
    const recycledFallback = DEFAULT_SEARCH_TERMS
      .map(normalizeSearchTerm)
      .filter((term) => term && !isFoodTerm(term));
    finalTerms = [...finalTerms, ...recycledFallback].slice(0, GOOFISH_TERMS_PER_BATCH);
    source = finalTerms.length > 0 ? 'fallback-reset' : source;
  }
  if (finalTerms.length < GOOFISH_TERMS_PER_BATCH) {
    throw new Error(`Unable to produce ${GOOFISH_TERMS_PER_BATCH} search terms. Default fallback list is empty or fully invalid.`);
  }
  finalTerms = shuffleTerms(finalTerms);
  const batchId = `batch_${Date.now()}`;
  const active = { id: batchId, generatedAt: new Date().toISOString(), terms: finalTerms, nextIndex: 0, source };
  const nextHistory = {
    used: Array.from(new Set([...historyUsed, ...finalTerms])),
    batches: [
      ...(Array.isArray(history.batches) ? history.batches : []),
      { id: batchId, generatedAt: active.generatedAt, terms: finalTerms, source }
    ],
    activeBatch: active
  };
  saveSearchTermHistory(nextHistory);
  clearBatchLinksQueue();
  return { terms: finalTerms, startIndex: 0, batchId, source, checkpoint: null };
}

function updateActiveBatchProgress(batchId, nextIndex) {
  const history = loadSearchTermHistory();
  const active = history.activeBatch;
  if (!active || (batchId && active.id !== batchId)) return;
  const updated = {
    ...active,
    nextIndex: Math.max(0, Number(nextIndex || 0) || 0),
    checkpoint: null,
    updatedAt: new Date().toISOString()
  };
  saveSearchTermHistory({ ...history, activeBatch: updated });
}

function normalizeDetailCheckpointItems(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  for (const item of items) {
    const id = Number(item?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    normalized.push({
      id,
      url: String(item?.url || '').trim(),
      name: String(item?.name || '').trim(),
      imagesChecked: Boolean(item?.imagesChecked),
      specs: item?.specs ?? null
    });
    if (normalized.length >= Math.max(ITEMS_PER_SEARCH, 300)) break;
  }
  return normalized;
}

function updateActiveBatchTermCheckpoint(batchId, termIndex, processedCount, urls = [], options = {}) {
  const history = loadSearchTermHistory();
  const active = history.activeBatch;
  if (!active || (batchId && active.id !== batchId)) return;
  const cleanedUrls = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  const stage = String(options?.stage || '').toLowerCase() === 'detail' ? 'detail' : 'collect';
  const detailItems = normalizeDetailCheckpointItems(options?.detail?.items);
  const detailNextIndexRaw = Number(options?.detail?.nextIndex || 0);
  const detailNextIndex = Number.isFinite(detailNextIndexRaw) ? Math.max(0, Math.min(detailItems.length, detailNextIndexRaw)) : 0;
  const collectPageIndexRaw = Number(options?.collectPageIndex || 0);
  const collectPageIndex = Number.isFinite(collectPageIndexRaw) ? Math.max(0, collectPageIndexRaw) : 0;
  const previousPageIndex = Math.max(0, Number(active?.checkpoint?.pageIndex || 0) || 0);
  const updated = {
    ...active,
    nextIndex: Math.max(0, Number(termIndex || 0) || 0),
    checkpoint: {
      termIndex: Math.max(0, Number(termIndex || 0) || 0),
      processedCount: Math.max(0, Number(processedCount || 0) || 0),
      urls: cleanedUrls.slice(-Math.max(300, ITEMS_PER_SEARCH * 3)),
      pageIndex: stage === 'collect' ? collectPageIndex : previousPageIndex,
      stage,
      detail: stage === 'detail'
        ? {
            nextIndex: detailNextIndex,
            total: detailItems.length,
            items: detailItems
          }
        : null
    },
    updatedAt: new Date().toISOString()
  };
  saveSearchTermHistory({ ...history, activeBatch: updated });
}

function clearActiveBatch(batchId) {
  const history = loadSearchTermHistory();
  if (!history.activeBatch) return;
  if (batchId && history.activeBatch.id !== batchId) return;
  saveSearchTermHistory({ ...history, activeBatch: null });
}

const UNAVAILABLE_KEYWORDS = [
  '卖掉了', // Sold out (Primary indicator)
  '宝贝不存在', // Baby does not exist
  '下架', // Taken off shelf
  '删除', // Deleted
  '转移', // Transferred
  '很抱歉', // Very sorry
  'Sold out',
  'This item is no longer available',
  '商品已失效' // Product invalid
];

const withTimeout = async (promiseFactory, label, timeoutMs = 60000) => {
  let timer;
  try {
    return await Promise.race([
      promiseFactory(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const safeDbDisconnect = async () => {
  try {
    await withTimeout(() => prisma.$disconnect(), 'db disconnect', 5000);
  } catch {}
  dbReady = false;
  dbChecked = false;
};

const dbPing = async () => withTimeout(() => prisma.$queryRaw`SELECT 1`, 'db ping', Math.min(12000, Math.max(5000, GOOFISH_DB_CONNECT_TIMEOUT_MS - 3000)));

const safeDbConnect = async () => {
  if (dbConnectPromise) return dbConnectPromise;
  dbConnectPromise = (async () => {
    try {
      dbLastConnectError = null;
      await withTimeout(() => prisma.$connect(), 'db connect', GOOFISH_DB_CONNECT_TIMEOUT_MS);
      if (GOOFISH_DB_CONNECT_VERIFY_PING) {
        await dbPing();
      }
      dbChecked = true;
      dbReady = true;
      return true;
    } catch (error) {
      dbLastConnectError = error;
      try { await prisma.$disconnect(); } catch {}
      dbChecked = true;
      dbReady = false;
      return false;
    }
  })();
  try {
    return await dbConnectPromise;
  } finally {
    dbConnectPromise = null;
  }
};

const recoverDbConnection = async (label, backoffMs, attemptIndex) => {
  const recoverWaitMs = Math.max(0, GOOFISH_DB_RECOVER_WAIT_MS);
  const infiniteWait = recoverWaitMs <= 0;
  const start = Date.now();
  let lastPauseLogAt = 0;
  while (infiniteWait || (Date.now() - start < recoverWaitMs)) {
    const now = Date.now();
    if (now - lastPauseLogAt >= 15000) {
      const elapsedSec = Math.floor((now - start) / 1000);
      const waitLabel = infiniteWait ? 'infinite' : `${Math.floor(recoverWaitMs / 1000)}s`;
      console.warn(`[DB Pause] ${label}: waiting for reconnect (${elapsedSec}s elapsed, wait=${waitLabel})`);
      lastPauseLogAt = now;
    }
    await safeDbDisconnect();
    await resetPrismaClient(`recover ${label}`);
    const delayMs = Math.max(1000, Math.min(15000, backoffMs * Math.max(1, attemptIndex)));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const connected = await safeDbConnect();
    if (!connected) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    try {
      await withTimeout(() => prisma.$queryRaw`SELECT 1`, `recover ping ${label}`, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS);
      console.warn(`[DB Pause] ${label}: reconnect successful, resuming.`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  return false;
};

export const recoverDbConnectionQuick = async (label) => {
  await safeDbDisconnect();
  await resetPrismaClient(`quick recover ${label}`);
  const connected = await safeDbConnect();
  if (!connected) return false;
  try {
    await withTimeout(() => prisma.$queryRaw`SELECT 1`, `quick recover ping ${label}`, Math.max(3000, Math.min(8000, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS)));
    return true;
  } catch {
    return false;
  }
};

const triggerDbReconnectNonBlocking = (label) => {
  Promise.resolve()
    .then(() => withTimeout(() => recoverDbConnectionQuick(label), `quick reconnect ${label}`, Math.max(4000, Math.min(10000, GOOFISH_DB_CONNECT_TIMEOUT_MS))))
    .catch(() => null);
};

const forceDbReconnectFromScratch = async (label) => {
  console.warn(`[DB Reconnect] Restarting DB connection from scratch: ${label}`);
  await safeDbDisconnect();
  await resetPrismaClient(`force reconnect ${label}`);
  const connected = await withTimeout(
    () => safeDbConnect(),
    `force reconnect connect ${label}`,
    Math.max(5000, GOOFISH_DB_CONNECT_TIMEOUT_MS)
  );
  if (!connected) {
    throw new Error(`force reconnect failed: ${label}`);
  }
  await withTimeout(
    () => prisma.$queryRaw`SELECT 1`,
    `force reconnect ping ${label}`,
    Math.max(3000, Math.min(12000, GOOFISH_DB_RECOVER_PING_TIMEOUT_MS))
  );
  dbChecked = true;
  dbReady = true;
  console.warn(`[DB Reconnect] Completed: ${label}`);
  return true;
};

const markPipelineProgress = (label = '') => {
  pipelineLastProgressAt = Date.now();
  if (label) pipelineLastProgressLabel = String(label);
  pipelineWatchdogLastStallLabel = '';
  pipelineWatchdogStallCount = 0;
};

const schedulePipelineRestart = (reason) => {
  if (pipelineRestartScheduled) return;
  pipelineRestartScheduled = true;
  const exitCode = 99;
  console.error(`[Watchdog] Restarting pipeline: ${reason}`);
  process.exitCode = exitCode;
  setTimeout(() => {
    process.exit(exitCode);
  }, 250);
};

const startPipelineProgressWatchdog = () => {
  if (pipelineWatchdogTimer) return;
  pipelineWatchdogTimer = setInterval(() => {
    if (DISABLE_DB_WRITE) return;
    if (pipelineRestartScheduled) return;
    if (pipelineWatchdogReconnectInFlight) return;
    const now = Date.now();
    const idleMs = now - pipelineLastProgressAt;
    if (idleMs < GOOFISH_PROGRESS_STALL_TIMEOUT_MS) return;
    const idleSec = Math.floor(idleMs / 1000);
    const label = pipelineLastProgressLabel || 'unknown';
    if (pipelineWatchdogLastStallLabel === label) {
      pipelineWatchdogStallCount += 1;
    } else {
      pipelineWatchdogLastStallLabel = label;
      pipelineWatchdogStallCount = 1;
    }
    if (idleMs >= GOOFISH_PROGRESS_STALL_HARD_EXIT_MS || pipelineWatchdogStallCount > GOOFISH_PROGRESS_STALL_MAX_RECOVERS) {
      schedulePipelineRestart(
        `stalled at "${label}" for ${idleSec}s after ${pipelineWatchdogStallCount - 1} recoveries`
      );
      return;
    }
    if ((now - pipelineWatchdogLastRecoveryAt) < GOOFISH_PROGRESS_RECOVERY_COOLDOWN_MS) {
      return;
    }
    pipelineWatchdogReconnectInFlight = true;
    Promise.resolve()
      .then(async () => {
        console.warn(
          `[Watchdog] No pipeline progress for ${idleSec}s at "${label}". Triggering DB reconnect (${pipelineWatchdogStallCount}/${GOOFISH_PROGRESS_STALL_MAX_RECOVERS}).`
        );
        let reconnected = false;
        try {
          await forceDbReconnectFromScratch(`watchdog idle ${idleSec}s ${label.slice(0, 40)}`);
          reconnected = true;
        } catch (error) {
          console.warn(`[Watchdog] DB reconnect failed: ${toErrorText(error)}`);
        } finally {
          if (reconnected) {
            pipelineWatchdogLastRecoveryAt = Date.now();
          }
          pipelineWatchdogReconnectInFlight = false;
        }
      })
      .catch(() => {
        pipelineWatchdogReconnectInFlight = false;
      });
  }, GOOFISH_PROGRESS_WATCHDOG_INTERVAL_MS);
  if (typeof pipelineWatchdogTimer?.unref === 'function') {
    pipelineWatchdogTimer.unref();
  }
};

const stopPipelineProgressWatchdog = () => {
  if (!pipelineWatchdogTimer) return;
  clearInterval(pipelineWatchdogTimer);
  pipelineWatchdogTimer = null;
  pipelineWatchdogReconnectInFlight = false;
  pipelineWatchdogLastRecoveryAt = 0;
  pipelineWatchdogLastStallLabel = '';
  pipelineWatchdogStallCount = 0;
  pipelineRestartScheduled = false;
};

export const isRetryableDbError = (error) => {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  return msg.includes('Timed out fetching a new connection from the connection pool')
    || msg.includes("Can't reach database server")
    || msg.includes('timed out after')
    || msg.includes('db connect failed')
    || msg.includes('Server has closed the connection')
    || msg.includes('Engine is not yet connected')
    || msg.includes('Response from the Engine was empty')
    || msg.includes('Unable to start a transaction in the given time')
    || code === 'P2024'
    || code === 'P2028'
    || code === 'P1017'
    || code === 'P1001';
};

const withRetry = async (run, label, retries = 5, timeoutMs = 60000, backoffMs = 1500) => {
  let lastError;
  let recoverCycles = 0;
  for (let i = 1; i <= retries; i++) {
    try {
      return await withTimeout(run, label, timeoutMs);
    } catch (error) {
      lastError = error;
      recordDbEngineFailure(error);
      const msg = String(error?.message || '');
      const retryable = isRetryableDbError(error);
      if (!retryable || i === retries) break;
      if (recoverCycles >= GOOFISH_DB_RECOVER_MAX_CYCLES_PER_OP) {
        lastError = new Error(`db recovery cycle limit reached for ${label}`);
        break;
      }
      console.warn(`${label} failed (attempt ${i}/${retries}), retrying... ${msg}`);
      const recovered = await withTimeout(
        () => recoverDbConnectionQuick(label),
        `quick reconnect ${label}`,
        Math.max(4000, Math.min(10000, GOOFISH_DB_CONNECT_TIMEOUT_MS))
      );
      recoverCycles += 1;
      if (!recovered) {
        triggerDbReconnectNonBlocking(label);
        lastError = new Error(`db quick recovery failed for ${label}`);
        break;
      }
    }
  }
  throw lastError;
};

const toErrorText = (error) => String(error?.message || error || 'unknown error');
const toErrorCode = (error) => String(error?.code || '');
const makePipelineRestartError = (message, cause = null) => {
  const error = new Error(message);
  error.code = 'GOOFISH_PIPELINE_RESTART';
  if (cause) {
    error.cause = cause;
  }
  return error;
};
const isPipelineRestartError = (error) => String(error?.code || '') === 'GOOFISH_PIPELINE_RESTART';
const shouldRestartPipelineForItemError = (error) => {
  if (isPipelineRestartError(error)) return true;
  const text = toErrorText(error);
  return text.includes('process link ') && text.includes(' timed out after ');
};

const waitForDbCircuitRecovery = async (maxWaitMs = Math.max(15000, GOOFISH_DB_ENGINE_COOLDOWN_MS + 10000)) => {
  const startedAt = Date.now();
  while (isDbCircuitOpen()) {
    if (Date.now() - startedAt >= maxWaitMs) return false;
    await delay(1500);
  }
  return true;
};

async function createBrowser() {
  let executablePath = getExecutablePath();
  
  const launchOptions = {
    headless: GOOFISH_HEADLESS ? 'new' : false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--excludeSwitches=enable-automation',
      '--disable-features=IsolateOrigins,site-per-process',
      '--incognito',
      '--disable-dev-shm-usage',
      ...(GOOFISH_HEADLESS ? [
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--window-size=1920,1080'
      ] : ['--start-maximized'])
    ]
  };

  // Keep proxy if provided
  if (process.env.PROXY_SERVER) {
    launchOptions.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
  } else if (process.platform === 'win32') {
    launchOptions.args.push('--proxy-server=http://127.0.0.1:7890');
  }

  if (!executablePath && process.platform === 'linux') {
    const installed = installChromeForLinux();
    if (installed) {
      executablePath = getExecutablePath() || findChromeInPuppeteerCache();
    }
  }

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    throw new Error('Chrome executable not found on system and could not be installed.');
  }

  return puppeteer.launch(launchOptions);
}

function toAbsoluteImage(src) {
  if (!src) return '';
  if (src.startsWith('//')) return 'https:' + src;
  return src;
}

function parseCnyPrice(text) {
  if (!text) return 0;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function extractGoofishItemId(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return String(parsed.searchParams.get('id') || '').trim();
  } catch {
    return '';
  }
}

async function regenerateNameWithLanguageFilter(title, currentName) {
  if (!SILICONFLOW_API_KEY) return currentName;
  try {
    const result = await callSiliconFlow([
      {
        role: 'system',
        content: 'You are an Arabic e-commerce product naming expert. Your task is to regenerate the Arabic product name to ensure it contains ONLY Arabic and English characters. Remove any Chinese, Korean, Thai, or other languages. Keep it SHORT and CLEAR (2-5 words). Focus on: 1) What the product IS, 2) Key material if important, 3) Brand name ONLY if explicitly mentioned.'
      },
      {
        role: 'user',
        content: `Regenerate this Arabic product name to contain only Arabic and English characters. Remove any foreign languages. Keep it short (2-5 words).\nCurrent name: ${currentName}\nOriginal title: ${title}`
      }
    ], 0.2, 180, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
    const regenerated = cleanAiText(sanitizeTranslationText(result));
    if (!regenerated || isLowQualityTranslationText(regenerated, 3)) return currentName;
    return filterArabicEnglishOnly(regenerated);
  } catch {
    return currentName;
  }
}

async function translateFullTitleToArabic(title, fallbackText = '') {
  const source = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!source || !SILICONFLOW_API_KEY) return fallbackText || source;
  try {
    console.log(`[translateFullTitleToArabic] Translating: ${source.substring(0, 30)}...`);
    const result = await callSiliconFlow([
      {
        role: 'system',
        content: 'You are an Arabic e-commerce product naming expert. Translate Chinese product titles to neat and simple Arabic product names. Keep the name SHORT and CLEAN (2-5 words maximum). Focus on: 1) Product type (most important), 2) Brand name if available (VERY IMPORTANT - include brand name in the name), 3) Material if relevant, 4) Color/style if important. CRITICAL: Do NOT mention any prices, currency symbols, or monetary values in the name. Exclude size, seller policies, shipping, price, negotiation terms, promotional text, and unnecessary details. Keep English brand names if present. Return Arabic ONLY (except brand names), no JSON, no explanation.'
      },
      {
        role: 'user',
        content: `Translate this Chinese product title to a neat and simple Arabic product name. Keep it SHORT and CLEAN (2-5 words maximum). MUST include the product type first. MUST include the brand name if available in the title. You may add material and color after the product type if relevant. CRITICAL: Do NOT mention any prices, currency symbols, or monetary values in the name. Exclude size, seller policies, shipping, price, negotiation terms, promotional text, and unnecessary details. Keep English brand names if present. Return Arabic ONLY (except brand names), no JSON, no explanation.\nTitle: ${source}`
      }
    ], 0.2, 200, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
    console.log(`[translateFullTitleToArabic] Raw result: ${result.substring(0, 50)}...`);
    const translated = cleanAiText(sanitizeTranslationText(result));
    console.log(`[translateFullTitleToArabic] Cleaned: ${translated.substring(0, 30)}...`);
    if (!translated || isLowQualityTranslationText(translated, 3)) {
      console.log(`[translateFullTitleToArabic] Translation failed or low quality, using fallback`);
      return fallbackText || source;
    }
    let filtered = filterArabicEnglishOnly(translated);
    console.log(`[translateFullTitleToArabic] Filtered: ${filtered.substring(0, 30)}...`);
    return filtered;
  } catch (err) {
    console.error(`[translateFullTitleToArabic] Error: ${err.message}`);
    return fallbackText || source;
  }
}

async function translateDetailDescriptionToArabic(title, detailText, fallbackText = '') {
  const sourceTitle = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  const sourceDetail = String(detailText || '').trim().slice(0, 800);
  if (!sourceDetail || !SILICONFLOW_API_KEY) return fallbackText || '';
  
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[translateDetailDescriptionToArabic] Attempt ${attempt}/${maxRetries}`);
      const result = await callSiliconFlow([
        {
          role: 'system',
          content: 'You are an Arabic e-commerce content expert. Analyze the Chinese product details and generate a natural Arabic product description. Extract and present the most important product information in a clear, readable format. Output Arabic ONLY - no Chinese, Korean, Thai, or other languages.'
        },
        {
          role: 'user',
          content: `Analyze the following Chinese product detail text and generate a natural Arabic product description for an e-commerce listing.

Task:
- Extract the important product information (material, size, color, features, condition, etc.)
- Present it in clear, natural Arabic that reads like a real product description
- Summarize the key points in a concise way

Rules:
- Keep it factual and natural.
- Extract and present key product details clearly.
- Preserve brand names unchanged.
- CRITICAL: Convert Chinese weight unit "斤" (jin) to kg by dividing by 2. Example: 150斤 = 75 kg, 170斤 = 85 kg.
- CRITICAL: Do NOT mention any prices, currency symbols, or monetary values in the description. Remove all price information completely.
- Do not add features not present in source.
- Output Arabic ONLY - no Chinese, Korean, Thai, or other languages.
Product title: ${sourceTitle}
Product details: ${sourceDetail}`
        }
      ], 0.2, 300, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
      
      const translated = cleanDescriptionText(result);
      if (!translated) {
        console.log(`[translateDetailDescriptionToArabic] Attempt ${attempt} returned empty`);
        lastError = new Error('Empty translation');
        continue;
      }
      
      console.log(`[translateDetailDescriptionToArabic] Attempt ${attempt} succeeded: ${translated.substring(0, 50)}...`);
      return translated;
    } catch (err) {
      lastError = err;
      console.error(`[translateDetailDescriptionToArabic] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
  
  console.error(`[translateDetailDescriptionToArabic] All ${maxRetries} attempts failed, using fallback`);
  return fallbackText || '';
}

async function updateProductTranslatedDescription(productId, descriptionAr) {
  const normalizedDescription = cleanDescriptionText(descriptionAr);
  if (!normalizedDescription) return;
  const metadataPatch = JSON.stringify({
    translatedDescription: normalizedDescription,
    detailTranslationUpdatedAt: new Date().toISOString()
  });
  console.log(`[Desc Update] Product ${productId} - Description length: ${normalizedDescription.length}`);
  console.log(`[Desc Update] Product ${productId} - Metadata patch:`, metadataPatch.substring(0, 200));
  
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || $2::jsonb,
        "description" = $3,
        "updatedAt" = NOW()
    WHERE id = $1
    RETURNING "aiMetadata"
  `, productId, metadataPatch, normalizedDescription);
  
  console.log(`[Desc Update] Product ${productId} - Updated metadata:`, JSON.stringify(result[0]?.aiMetadata || {}).substring(0, 200));
  console.log(`[Desc Update] Product ${productId} - Database update complete`);
}

async function generateLongDescriptionFromTitle(title, fallbackText = '') {
  const source = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!source || !SILICONFLOW_API_KEY) return fallbackText || source;
  try {
    console.log(`[generateLongDescriptionFromTitle] Summarizing: ${source.substring(0, 30)}...`);
    const result = await callSiliconFlow([
      {
        role: 'system',
        content: 'You are an Arabic e-commerce content expert. Your task is to read the Chinese product title and generate a DETAILED Arabic product description that summarizes all important information. Extract and present all relevant details in a clear, readable format. Output Arabic or English ONLY - no Chinese, Korean, Thai, or other languages.'
      },
      {
        role: 'user',
        content: `Generate a detailed Arabic product description from this Chinese title. Extract and summarize ALL important details:

- Material (e.g., cotton, silk, polyester, viscose)
- Season (e.g., summer, winter, spring, autumn)
- Style/type (e.g., sleep robe, pajamas, dress)
- Sizes available (e.g., M, XL, 80-120cm)
- Weight/size limits (e.g., suitable for people under 140 jin = 70 kg)
- Features (e.g., belt, buttons, pockets, zipper, adjustable waist tie)
- Design details (e.g., colors, patterns, prints)
- Condition (e.g., brand new, used, with tags)
- Quantity available (e.g., 2-3 pieces per size)
- Price information (e.g., clearance price, wholesale, low price)
- Shipping information (e.g., free shipping, which courier)
- Brand information (if mentioned)
- Target audience (e.g., men, women, children, babies)

Make the description comprehensive and natural, like a real product listing. Convert Chinese weight unit "斤" (jin) to kg by dividing by 2. Example: 140斤 = 70 kg, 165斤 = 82.5 kg.

IMPORTANT: The description must be detailed and comprehensive, at least 30-50 words long. Do not just translate the brand name or product type - include ALL the details mentioned in the title.

Title: ${source}`
      }
    ], 0.2, 600, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
    console.log(`[generateLongDescriptionFromTitle] Raw result: ${result.substring(0, 80)}...`);
    const translated = cleanDescriptionText(result);
    console.log(`[generateLongDescriptionFromTitle] Cleaned: ${translated.substring(0, 50)}...`);
    
    // Convert any remaining Chinese to pinyin before filtering
    const withPinyin = await convertChineseToPinyin(translated);
    console.log(`[generateLongDescriptionFromTitle] After pinyin conversion: ${withPinyin.substring(0, 50)}...`);
    
    if (!withPinyin || withPinyin.length < 15) {
      console.log(`[generateLongDescriptionFromTitle] Translation too short (${withPinyin.length} chars), using fallback`);
      return fallbackText || source;
    }
    const filtered = filterArabicEnglishOnly(withPinyin);
    console.log(`[generateLongDescriptionFromTitle] Filtered: ${filtered.substring(0, 50)}... length=${filtered.length}`);
    if (filtered.length < 15) {
      console.log(`[generateLongDescriptionFromTitle] Filtered result too short (${filtered.length} chars), using original`);
      return withPinyin || fallbackText || source;
    }
    return filtered;
  } catch (err) {
    console.error(`[generateLongDescriptionFromTitle] Error: ${err.message}`);
    return fallbackText || source;
  }
}

async function generateTitleAndKeywords(title, detailText = '') {
  const fallback = String(title || '').trim().slice(0, GOOFISH_AI_TITLE_MAX_CHARS);
  if (!SILICONFLOW_API_KEY || !fallback) {
    return { titleAr: fallback, descriptionAr: fallback, keywords: [], translationSucceeded: false };
  }
  try {
    // If we have detail text, use the detail description function for longer descriptions
    if (detailText && detailText.length > 20) {
      const descriptionAr = await translateDetailDescriptionToArabic(title, detailText, fallback);
      const titleAr = await translateFullTitleToArabic(title, fallback);
      // Use generated content even if quality check fails, as long as it's not empty
      const finalTitleAr = titleAr && titleAr !== fallback && titleAr.length > 2 ? titleAr : fallback;
      const finalDescriptionAr = descriptionAr && descriptionAr !== fallback && descriptionAr.length > 5 ? descriptionAr : fallback;
      const translationSucceeded = (titleAr && titleAr !== fallback) || (descriptionAr && descriptionAr !== fallback);
      return { titleAr: finalTitleAr, descriptionAr: finalDescriptionAr, keywords: [], translationSucceeded };
    }
    
    // Separate AI calls: one for name, one for long description
    const titleAr = await translateFullTitleToArabic(title, fallback);
    const descriptionAr = await generateLongDescriptionFromTitle(title, fallback);
    
    console.log(`[generateTitleAndKeywords] titleAr=${titleAr?.substring(0, 30)}... descriptionAr=${descriptionAr?.substring(0, 30)}...`);
    
    // Use generated content even if quality check fails, as long as it's not empty
    const finalTitleAr = titleAr && titleAr !== fallback && titleAr.length > 2 ? titleAr : fallback;
    const finalDescriptionAr = descriptionAr && descriptionAr !== fallback && descriptionAr.length > 5 ? descriptionAr : fallback;
    
    const translationSucceeded = (titleAr && titleAr !== fallback && hasArabic(titleAr))
      || (descriptionAr && descriptionAr !== fallback && hasArabic(descriptionAr));
    
    console.log(`[generateTitleAndKeywords] finalTitleAr=${finalTitleAr?.substring(0, 30)}... finalDescriptionAr=${finalDescriptionAr?.substring(0, 30)}... translationSucceeded=${translationSucceeded}`);
    
    return { titleAr: finalTitleAr, descriptionAr: finalDescriptionAr, keywords: [], translationSucceeded };
  } catch (error) {
    console.error('[AI Debug] generateTitleAndKeywords error:', error.message);
    return { titleAr: fallback, descriptionAr: fallback, keywords: [], translationSucceeded: false };
  }
}

export async function ensureDbReady() {
  // Skip database connection in queue mode
  if (USE_QUEUE_MODE) {
    console.log('[Queue Mode] Skipping database connection - scraper only saves to queue');
    return false;
  }
  
  console.log("ensureDbReady called. DISABLE_DB_WRITE:", DISABLE_DB_WRITE, "BATCH_INSERT_FROM_JSON:", BATCH_INSERT_FROM_JSON);
  
  // Skip DB connection if batch insert mode is enabled (we'll connect later during batch insert)
  if (BATCH_INSERT_FROM_JSON) {
    console.log("ensureDbReady: Skipping DB connection in batch insert mode");
    return false;
  }
  
  if (DISABLE_DB_WRITE) {
    if (REQUIRE_DB_WRITE) {
      throw new Error('GOOFISH_DISABLE_DB_WRITE is true while DB write is required.');
    }
    return false;
  }
  if (isDbCircuitOpen()) {
    const now = Date.now();
    if (now - dbCircuitLastLogAt > 5000) {
      dbCircuitLastLogAt = now;
      console.warn(`[DB Circuit] Skipping DB connect during cooldown (${Math.ceil((dbCircuitOpenUntil - now) / 1000)}s left).`);
    }
    return false;
  }
  console.log("dbChecked:", dbChecked);
  if (dbConnectPromise) {
    return await dbConnectPromise;
  }
  if (dbChecked && dbReady) {
    if (!GOOFISH_DB_CONNECT_VERIFY_PING) return true;
    try {
      await dbPing();
      return true;
    } catch {
      dbReady = false;
      dbChecked = false;
    }
  }
  dbChecked = true;
  const maxAttempts = GOOFISH_DB_CONNECT_RETRIES;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Prisma connecting (attempt ${attempt})...`);
      const connected = await safeDbConnect();
      if (!connected) {
        throw dbLastConnectError || new Error('db connect failed');
      }
      dbReady = true;
      console.log('Database connection established.');
      return true;
    } catch (e) {
      recordDbEngineFailure(e);
      dbReady = false;
      dbChecked = false;
      const code = String(e?.code || '');
      const msg = String(e?.message || '');
      const retryable = code === 'P2024'
        || code === 'P1001'
        || code === 'P1017'
        || msg.includes('db connect failed')
        || msg.includes('Engine is not yet connected')
        || msg.includes('Response from the Engine was empty')
        || msg.includes('timed out after')
        || msg.includes("Can't reach database server")
        || msg.includes('Server has closed the connection');
      if (!retryable || attempt === maxAttempts) {
        console.error('Database unavailable.');
        console.error(String(e?.message || e));
        if (REQUIRE_DB_WRITE) {
          throw e;
        }
        return dbReady;
      }
      console.warn(`Database connection attempt ${attempt}/${maxAttempts} failed. Retrying in ${GOOFISH_DB_CONNECT_RETRY_DELAY_MS}ms...`);
      await safeDbDisconnect();
      await new Promise((resolve) => setTimeout(resolve, GOOFISH_DB_CONNECT_RETRY_DELAY_MS));
    }
  }
  if (REQUIRE_DB_WRITE) {
    throw new Error('Database unavailable after retries.');
  }
  return dbReady;
}

async function randomInteraction(page) {
  try {
    const width = await page.evaluate(() => window.innerWidth);
    const height = await page.evaluate(() => window.innerHeight);
    const moveCount = 5 + Math.floor(Math.random() * 5); // More moves
    
    // Random mouse movements
    for (let i = 0; i < moveCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 20) });
      await humanDelay(100, 400);
      
      // Occasionally hover over something if possible
      if (Math.random() < 0.3) {
         await humanDelay(200, 500);
      }
    }
    
    // Random scroll with pauses
    const scrollAmount = 300 + Math.floor(Math.random() * 500);
    await page.evaluate((amt) => window.scrollBy(0, amt), scrollAmount);
    await humanDelay(800, 1500);
    
    // Scroll back up a bit sometimes
    if (Math.random() < 0.4) {
      await page.evaluate(() => window.scrollBy(0, -100 - Math.floor(Math.random() * 200)));
      await humanDelay(500, 1000);
    }
  } catch {
  }
}

async function closeLoginPopup(page) {
  const selectors = [
    '.closeIconBg--cubvOqVh',
    'img.closeIcon--gwB7wNKs',
    '.closeIcon--gwB7wNKs'
  ];
  for (const selector of selectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        await humanDelay(600, 1200);
        return true;
      }
    } catch {}
  }
  return false;
}

async function openHomeAndSearch(page, term) {
  await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(2000, 3500);
  await closeLoginPopup(page);
  await page.waitForSelector('input[class*="search-input--"]', { timeout: 30000 });
  await page.click('input[class*="search-input--"]', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('input[class*="search-input--"]', term, { delay: 40 + Math.floor(Math.random() * 40) });
  await humanDelay(250, 600);
  const submitBtn = await page.$('button.search-icon--bewLHteU, button[class*="search-icon--"]');
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForSelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]', { timeout: 30000 });
  await humanDelay(1200, 2200);
  
  // Check "全新" (Brand New) and "包邮" (Free Shipping) checkboxes
  try {
    await page.waitForSelector('.search-filter-checkbox-container--pbR_LEIX', { timeout: 10000 });
    
    // Find all checkbox labels
    const checkboxLabels = await page.$$('.search-checkbox-label--yt8qOVYk');
    console.log(`[Filter] Found ${checkboxLabels.length} checkbox labels`);
    
    for (const label of checkboxLabels) {
      const labelText = await page.evaluate(el => el.textContent.trim(), label);
      console.log(`[Filter] Found checkbox label: "${labelText}"`);
      
      // Check for "全新" (Brand New)
      if (labelText === '全新') {
        const parent = await label.evaluateHandle(el => el.parentElement);
        const checkbox = await parent.$('div[class*="search-checkbox"]');
        if (checkbox) {
          const isChecked = await checkbox.evaluate(el => el.classList.contains('search-checkbox-checked--tu74qy3u'));
          if (!isChecked) {
            // Use JavaScript click instead of Puppeteer click
            await checkbox.evaluate(el => el.click());
            console.log('[Filter] Clicked "全新" (Brand New) checkbox');
            await humanDelay(500, 1000);
          } else {
            console.log('[Filter] "全新" checkbox already checked');
          }
        }
      }
      
      // Check for "包邮" (Free Shipping)
      if (labelText === '包邮') {
        const parent = await label.evaluateHandle(el => el.parentElement);
        const checkbox = await parent.$('div[class*="search-checkbox"]');
        if (checkbox) {
          const isChecked = await checkbox.evaluate(el => el.classList.contains('search-checkbox-checked--tu74qy3u'));
          if (!isChecked) {
            // Use JavaScript click instead of Puppeteer click
            await checkbox.evaluate(el => el.click());
            console.log('[Filter] Clicked "包邮" (Free Shipping) checkbox');
            await humanDelay(500, 1000);
          } else {
            console.log('[Filter] "包邮" checkbox already checked');
          }
        }
      }
    }
    
    // Wait for page to refresh after filter selection
    await page.waitForSelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]', { timeout: 30000 });
    await humanDelay(1000, 2000);
  } catch (err) {
    console.warn('[Filter] Could not check filter checkboxes:', err.message);
  }
}

async function findExistingProductByUrl(url) {
  if (!url || url.includes('search?')) return null;
  if (!dbReady) return null;
  try {
    const byUrl = await withTimeout(() => prisma.product.findFirst({
      where: { purchaseUrl: url },
      select: {
        id: true,
        name: true,
        keywords: true,
        aiMetadata: true
      }
    }), 'find existing product by url', 12000);
    if (byUrl) return byUrl;

    const goofishItemId = extractGoofishItemId(url);
    if (!goofishItemId) return null;

    const rows = await withTimeout(() => prisma.$queryRawUnsafe(`
      SELECT id, name, keywords, "aiMetadata"
      FROM "Product"
      WHERE "aiMetadata"->>'goofishItemId' = $1
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `, goofishItemId), 'find existing product by goofish item id', 12000);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      keywords: Array.isArray(row.keywords) ? row.keywords : [],
      aiMetadata: row.aiMetadata || null
    };
  } catch (error) {
    if (isRetryableDbError(error)) {
      dbReady = false;
      dbChecked = false;
    }
    return null;
  }
}

function shouldTranslateFromExistingProduct(existingProduct) {
  if (!existingProduct) {
    return { shouldTranslate: true, reason: 'no existing product' };
  }
  const existingName = cleanAiText(String(existingProduct.name || '').trim());
  const existingDescription = cleanDescriptionText(String(existingProduct?.aiMetadata?.translatedDescription || existingName).trim());
  const existingKeywords = Array.isArray(existingProduct.keywords) ? existingProduct.keywords : [];
  const hasGoodName = Boolean(existingName) && hasArabic(existingName) && !isChineseTerm(existingName);
  const hasGoodDescription = existingDescription.length >= 24 && hasArabic(existingDescription) && !isChineseTerm(existingDescription);
  const hasStrongKeywords = existingKeywords.length >= Math.max(10, Math.floor(KEYWORDS_PER_PRODUCT * 0.7));
  const shouldTranslate = !(hasGoodName && hasGoodDescription && hasStrongKeywords);
  const reason = shouldTranslate
    ? `existing data weak (name:${hasGoodName ? 'ok' : 'bad'}, desc:${hasGoodDescription ? 'ok' : 'bad'}, keywords:${hasStrongKeywords ? 'ok' : 'bad'})`
    : 'existing translated data is strong';
  return { shouldTranslate, reason };
}

async function saveProductToDb(item, existingProductId = null) {
  try {
    if (!item.url || item.url.includes('search?')) {
        console.warn('Skipping item with invalid URL:', item.url);
        return;
    }
    let ready = await ensureDbReady();
    let dbReadyRetries = 0;
    const maxDbReadyRetries = 5;
    while (!ready && dbReadyRetries < maxDbReadyRetries) {
      dbReadyRetries += 1;
      console.warn(`[DB Save] Database not ready (attempt ${dbReadyRetries}/${maxDbReadyRetries}), waiting 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      ready = await ensureDbReady();
    }
    if (!ready) {
        console.error(`[DB Save] Failed to get database ready after ${maxDbReadyRetries} retries. Skipping save for ${extractGoofishItemId(item.url) || 'item'}`);
        return null;
    }

    const existing = existingProductId ? { id: existingProductId } : null;
    const goofishItemId = extractGoofishItemId(item.url);
    const metadata = {
      originalTitle: item.title,
      translatedDescription: item.descriptionAr || '',
      isRealBrand: typeof item.realBrand === 'boolean' ? item.realBrand : null,
      goofishItemId: goofishItemId || null,
      source: 'goofish',
      scrapedAt: new Date()
    };
    const keywordsList = ensureKeywordList(item.keywords, item.titleEn || item.title);
    const hasDetectedCondition = typeof item.newOrOld === 'boolean';
    const newOrOldValue = hasDetectedCondition ? item.newOrOld : null;

    const basePriceIQD = Math.max(0, Number(item.priceCny || 0) * CNY_TO_IQD_RATE);
    const multiplier = calculatePriceMultiplier(basePriceIQD);
    const priceIQD = Math.round(basePriceIQD * multiplier);
    if (existing) {
      try {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            name: item.titleEn || item.title,
            price: priceIQD,
            basePriceIQD,
            // description: item.descriptionAr || '', // Skip Prisma update - use raw SQL fallback
            // keywords: keywordsList, // Removing this because it causes "Unknown argument" error
            aiMetadata: metadata,
            updatedAt: new Date(),
            ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
          }
        });
        // Update keywords using raw SQL to bypass Prisma schema mismatch
        if (keywordsList && keywordsList.length > 0) {
          const keywordsSql = Prisma.join(keywordsList);
          await prisma.$executeRaw`
            UPDATE "Product"
            SET "keywords" = ARRAY[${keywordsSql}]
            WHERE "id" = ${existing.id}
          `;
        }
        console.log(`Updated product: ${item.titleEn || item.title}`);
        return existing.id;
      } catch (updateError) {
        if (isRetryableDbError(updateError)) {
          throw updateError;
        }
        console.error('Update failed, trying raw SQL fallback:', updateError.message);
        if (keywordsList && keywordsList.length > 0) {
          const keywordsSql = Prisma.join(keywordsList);
          if (hasDetectedCondition) {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "price" = ${priceIQD},
                  "basePriceIQD" = ${basePriceIQD},
                  "name" = ${item.titleEn || item.title},
                  "description" = ${item.descriptionAr || ''},
                  "keywords" = ARRAY[${keywordsSql}],
                  "neworold" = ${newOrOldValue},
                  "aiMetadata" = ${JSON.stringify(metadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${existing.id}
            `;
          } else {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "price" = ${priceIQD},
                  "basePriceIQD" = ${basePriceIQD},
                  "name" = ${item.titleEn || item.title},
                  "description" = ${item.descriptionAr || ''},
                  "keywords" = ARRAY[${keywordsSql}],
                  "aiMetadata" = ${JSON.stringify(metadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${existing.id}
            `;
          }
        } else {
          if (hasDetectedCondition) {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "price" = ${priceIQD},
                  "basePriceIQD" = ${basePriceIQD},
                  "name" = ${item.titleEn || item.title},
                  "description" = ${item.descriptionAr || ''},
                  "neworold" = ${newOrOldValue},
                  "aiMetadata" = ${JSON.stringify(metadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${existing.id}
            `;
          } else {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "price" = ${priceIQD},
                  "basePriceIQD" = ${basePriceIQD},
                  "name" = ${item.titleEn || item.title},
                  "description" = ${item.descriptionAr || ''},
                  "aiMetadata" = ${JSON.stringify(metadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${existing.id}
            `;
          }
        }
        console.log(`Updated product (raw SQL): ${item.titleEn || item.title}`);
        return existing.id;
      }
    } else {
      let newProduct;
      try {
        const createData = {
            name: item.titleEn || item.title,
            price: priceIQD,
            basePriceIQD,
            image: item.image,
            purchaseUrl: item.url,
            status: 'PUBLISHED',
            isActive: true,
            // description: item.descriptionAr || '', // Skip Prisma update - use raw SQL fallback
            // keywords: keywordsList, // Removed to avoid "Unknown argument"
            aiMetadata: metadata,
            ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
        };
        newProduct = await prisma.product.create({
          data: createData
        });
        // Update keywords using raw SQL
        if (newProduct?.id && keywordsList && keywordsList.length > 0) {
            const keywordsSql = Prisma.join(keywordsList);
            await prisma.$executeRaw`
                UPDATE "Product"
                SET "keywords" = ARRAY[${keywordsSql}]
                WHERE "id" = ${newProduct.id}
            `;
        }
      } catch (createError) {
        if (isRetryableDbError(createError)) {
          throw createError;
        }
        console.warn(`Prisma create failed, trying minimal create fallback: ${toErrorText(createError)}`);
        const fallbackCreateData = {
          name: String(item.titleEn || item.title || '').slice(0, 380),
          price: priceIQD,
          basePriceIQD,
          image: item.image,
          purchaseUrl: item.url,
          status: 'PUBLISHED',
          isActive: true,
          // description: item.descriptionAr || '', // Skip Prisma update - use raw SQL fallback
          ...(hasDetectedCondition ? { neworold: newOrOldValue } : {})
        };
        newProduct = await prisma.product.create({
          data: fallbackCreateData
        });
        if (newProduct?.id) {
          try {
            if (keywordsList && keywordsList.length > 0) {
              const keywordsSql = Prisma.join(keywordsList);
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "keywords" = ARRAY[${keywordsSql}],
                    "aiMetadata" = ${JSON.stringify(metadata)}::jsonb
                WHERE "id" = ${newProduct.id}
              `;
            } else {
              await prisma.$executeRaw`
                UPDATE "Product"
                SET "aiMetadata" = ${JSON.stringify(metadata)}::jsonb
                WHERE "id" = ${newProduct.id}
              `;
            }
          } catch (fallbackMetaErr) {
            console.warn(`Post-create metadata update skipped for ${newProduct.id}: ${toErrorText(fallbackMetaErr)}`);
          }
        }
      }
      
      // Add main image
      if (item.image && newProduct?.id) {
        try {
          await withRetry(
            () => prisma.productImage.createMany({
              data: [{
                productId: newProduct.id,
                url: item.image,
                order: 0,
                type: 'GALLERY'
              }],
              skipDuplicates: true
            }),
            `insert product image ${newProduct.id}`,
            1,
            5000,
            500
          );
        } catch (imageErr) {
          console.warn(`Product image insert skipped for ${newProduct.id}: ${toErrorText(imageErr)}`);
        }
      }
      if (newProduct?.id) {
        console.log(`Saved to DB: id=${newProduct.id} title=${item.titleEn || item.title}`);
        // Category assignment moved to detail phase
      } else {
        console.log(`Saved to DB: id=unknown title=${item.titleEn || item.title}`);
      }
      return newProduct?.id || null;
    }
  } catch (e) {
    console.error(`Failed to save product ${item.titleEn}:`, e.message);
    // Print stack trace for debugging
    if (e.stack) console.error(e.stack);
    if (isRetryableDbError(e)) {
      recordDbEngineFailure(e);
      dbReady = false;
      dbChecked = false;
      throw e;
    }
    return null;
  }
}

async function processProductDetailsToJson(page, url, index) {
  const detailDataPath = path.join(process.cwd(), 'goofish-detail-results.json');
  
  console.log(`\n[Pipeline JSON Mode] Processing URL ${index}: ${url}`);

  if (!url || typeof url !== 'string') {
    console.log(`⚠️ Invalid URL (type: ${typeof url}). Skipping.`);
    return;
  }

  const detailItem = {
    url: url,  // URL must be a string
    title: '',
    image: '',
    aiMetadata: {},
    specs: null,
    translatedSpecs: null,
    soldCount: null,
    translatedName: null,
    translatedDescription: null,
    categoryId: null,
    images: [],
    isActive: true,
    priceCny: 0,
    newOrOld: null,
    realBrand: null,
    keywords: []
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const delay = Math.floor(Math.random() * 1500) + 1000;
    await new Promise(r => setTimeout(r, delay));

    const pageContent = await page.evaluate(() => document.body.innerText);
    const title = await page.title();
    
    let isUnavailable = false;
    let unavailableReason = '';

    for (const keyword of UNAVAILABLE_KEYWORDS) {
      if (pageContent.includes(keyword) || title.includes(keyword)) {
        isUnavailable = true;
        unavailableReason = keyword;
        break;
      }
    }

    if (isUnavailable) {
      console.log(`❌ URL ${url} is UNAVAILABLE. Reason: ${unavailableReason}`);
      detailItem.isActive = false;
      saveDetailItemToJson(detailItem, detailDataPath);
      return;
    }

    console.log(`✅ URL ${url} is AVAILABLE.`);
    
    // Extract title and basic info
    detailItem.title = title;
    
    // Extract seller sold count
    const sellerInfo = await page.evaluate(() => {
      const userLabels = document.querySelectorAll('.item-user-info-label--NLTMHARN');
      for (const label of userLabels) {
        const text = label.innerText || '';
        const match = text.match(/卖出(\d+)件宝贝/);
        if (match) return parseInt(match[1], 10);
      }
      return null;
    });
    
    if (sellerInfo !== null) {
      console.log(`[Seller Info] URL ${url} - Seller sold count: ${sellerInfo}`);
      detailItem.soldCount = sellerInfo;
    }

    // Extract image
    const mainImage = await page.evaluate(() => {
      const img = document.querySelector('.item-main-window-list--od7DK4Fm img, img.fadeInImg--DnykYtf4, .item-body--P2hJb44_ img, .item-main--N18QxQe1 img');
      return img?.src || '';
    });
    if (mainImage) {
      detailItem.image = mainImage;
    }

    // Extract price
    const priceText = await page.evaluate(() => {
      const selectors = [
        '.price--qH7y0yJl',
        '.price--gq5h3rYh',
        '.price--fHfY0Q3N',
        '[class*="price--"]',
        '.price',
        '.item-price',
        '.price-num'
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.innerText || el.textContent || '';
          const match = text.match(/(\d+(?:\.\d+)?)/);
          if (match) return match[1];
        }
      }
      return '';
    });
    if (priceText) {
      const cny = parseCnyPrice(priceText);
      detailItem.priceCny = cny;
      console.log(`[Price] Extracted price: ${cny} CNY`);
    } else {
      console.log(`[Price] No price found for ${url}`);
    }

    // Extract name and description from the specific div
    let rawDetailDescription = '';
    const extractedContent = await page.evaluate(() => {
      const mainDiv = document.querySelector('.main--Nu33bWl6.open--gEYf_BQc');
      if (!mainDiv) return null;
      const descSpan = mainDiv.querySelector('.desc--GaIUKUQY');
      if (!descSpan) return null;
      return descSpan.innerText || descSpan.textContent || '';
    });

    if (extractedContent && extractedContent.length > 10) {
      console.log(`[Detail Phase] Extracted content from product page: ${extractedContent.substring(0, 50)}...`);
      
      const generated = await generateTitleAndKeywords(extractedContent, extractedContent);
      
      if (generated.translationSucceeded) {
        console.log(`[Detail Phase] Generated Arabic name: ${generated.titleAr?.substring(0, 30)}...`);
        console.log(`[Detail Phase] Generated Arabic description: ${generated.descriptionAr?.substring(0, 50)}...`);
        
        detailItem.translatedName = generated.titleAr;
        detailItem.translatedDescription = generated.descriptionAr;
        detailItem.keywords = generated.keywords || [];
      }
    } else {
      console.log(`[Detail Phase] Could not extract content from specific div, using fallback extraction`);
      
      rawDetailDescription = cleanAiText(await page.evaluate(() => {
        const selectors = [
          '.desc--GaIUKUQY',
          '[class*="desc--"]',
          '.item-desc--fHfY0Q3N',
          '[class*="item-desc"]',
          '[class*="description"]'
        ];
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const txt = (el?.textContent || '').trim();
          if (txt) return txt;
        }
        const bodyText = (document.body?.innerText || '').trim();
        if (!bodyText) return '';
        const lines = bodyText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line.length >= 8)
          .slice(0, 30);
        return lines.join(' ');
      }));
      
      if (rawDetailDescription) {
        const fallbackDescription = cleanDescriptionText(String(extractedContent || '').trim());
        const translatedDetailDescription = await translateDetailDescriptionToArabic(extractedContent || '', rawDetailDescription, fallbackDescription);
        if (translatedDetailDescription && hasArabic(translatedDetailDescription)) {
          detailItem.translatedDescription = translatedDetailDescription;
        }
      }
    }

    // Extract category ID from URL
    const categoryId = extractCategoryId(url);
    if (categoryId) {
      detailItem.categoryId = categoryId;
    }

    // Extract specs
    const rawSpecsText = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.labels--ndhPFgp8 .item--qI9ENIfp'));
      const specs = {};
      for (const label of labels) {
        const labelText = label.querySelector('.label--ejJeaTRV')?.innerText || '';
        const valueText = label.querySelector('.value--EyQBSInp')?.innerText || '';
        if (labelText && valueText) {
          specs[labelText] = valueText;
        }
      }
      return specs;
    });
    
    if (Object.keys(rawSpecsText).length > 0) {
      console.log(`ℹ️ Found specs for ${url}:`, JSON.stringify(rawSpecsText));
      detailItem.specs = rawSpecsText;
      
      // Translate specs
      const specsPrompt = Object.entries(rawSpecsText)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
      const translatedSpecs = await callSiliconFlow([
        {
          role: 'system',
          content: 'You are a Chinese to Arabic translator for e-commerce product specifications. Translate BOTH keys and values to Arabic (Iraqi dialect). CRITICAL: Translate ALL keys to meaningful Arabic labels - do NOT keep Chinese keys. Key translations to memorize: 品牌→الماركة, 成色→الحالة, 适用性别→الجنس, 适用季节→الموسم, 尺码→المقاس, 适用人群→الفئة المستهدفة, 材质→المادة, 颜色→اللون. Return ONLY a JSON object with Arabic keys and Arabic values. Do not include any explanation or extra text.'
        },
        {
          role: 'user',
          content: `Translate these specifications to Arabic:\n${specsPrompt}`
        }
      ], 0.2, 300, { timeoutMs: 60000 });
      
      try {
        const parsedSpecs = JSON.parse(translatedSpecs);
        console.log(`✅ Translated specs for ${url}:`, JSON.stringify(parsedSpecs));
        detailItem.translatedSpecs = parsedSpecs;
      } catch {
        console.warn(`⚠️ Failed to parse translated specs for ${url}`);
      }
    }

    // Extract images
    console.log('Checking for images...');
    await page.waitForSelector('.item-main-window-list--od7DK4Fm, img.fadeInImg--DnykYtf4, .item-body--P2hJb44_, .item-main--N18QxQe1, img[src*="alicdn.com"]', { timeout: 5000 }).catch(() => {});

    const images = await page.evaluate(() => {
      const MAX_GALLERY_IMAGES = 8;
      const CANDIDATE_ATTRS = ['src', 'data-src', 'data-lazy-src', 'data-ks-lazyload', 'data-original', 'data-url', 'data-imgurl'];
      const BAD_HINTS = ['avatar', 'icon', 'sprite', 'logo', 'gif'];
      const SIZE_HINT_RE = /_\d+x\d+.*$/;
      const SMALL_HINT_RE = /(?:^|[_-])(40|48|50|60|72|80|96|100|120|160|180)x\1(?:[_-]|$)/i;

      const normalize = (value) => {
        if (!value) return '';
        let url = String(value).trim();
        if (!url) return '';
        url = url.replace(/^[`'"]+|[`'"]+$/g, '');
        if (url.startsWith('//')) url = `https:${url}`;
        if (!/^https?:\/\//i.test(url)) return '';
        url = url.replace(/[)\]}",:;`]+$/g, '');
        url = url.replace(/[#?].*$/, '').replace(SIZE_HINT_RE, '').replace(/\.webp$/i, '');
        return url;
      };

      const images = [];
      const seen = new Set();

      document.querySelectorAll('img').forEach(img => {
        if (images.length >= MAX_GALLERY_IMAGES) return;
        let src = null;
        for (const attr of CANDIDATE_ATTRS) {
          const val = img.getAttribute(attr);
          if (val) {
            src = val;
            break;
          }
        }
        if (!src) return;
        const normalized = normalize(src);
        if (!normalized) return;
        if (seen.has(normalized)) return;
        const lower = normalized.toLowerCase();
        if (BAD_HINTS.some(h => lower.includes(h))) return;
        if (SMALL_HINT_RE.test(normalized)) return;
        seen.add(normalized);
        images.push(normalized);
      });

      return images;
    });

    if (images.length > 0) {
      console.log(`Found ${images.length} images.`);
      detailItem.images = images.slice(0, 8);
    }

    // Save to JSON
    saveDetailItemToJson(detailItem, detailDataPath);
    console.log(`✅ Saved detail data for ${url} to JSON`);

  } catch (error) {
    console.error(`Error processing ${url} (JSON mode):`, error.message);
    // Save whatever data we have
    saveDetailItemToJson(detailItem, detailDataPath);
  }
}

function saveDetailItemToJson(item, filePath) {
  // Validate item structure before saving
  if (!item || typeof item !== 'object') {
    console.warn(`[saveDetailItemToJson] Invalid item type: ${typeof item}, skipping`);
    return;
  }
  
  // Ensure URL is a string
  if (item.url && typeof item.url !== 'string') {
    console.warn(`[saveDetailItemToJson] Invalid URL type: ${typeof item.url}, attempting to extract string URL`);
    if (item.url.url && typeof item.url.url === 'string') {
      item.url = item.url.url;
    } else {
      console.warn(`[saveDetailItemToJson] Cannot extract valid URL from item, skipping`);
      return;
    }
  }
  
  let existingItems = [];
  if (fs.existsSync(filePath)) {
    try {
      const rawData = fs.readFileSync(filePath, 'utf8');
      existingItems = JSON.parse(rawData);
    } catch (err) {
      console.warn(`[saveDetailItemToJson] Failed to read existing JSON: ${err.message}`);
      existingItems = [];
    }
  }
  
  // Update or add item by URL
  const existingIndex = existingItems.findIndex(i => i.url === item.url);
  if (existingIndex >= 0) {
    existingItems[existingIndex] = item;
  } else {
    existingItems.push(item);
  }
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(existingItems, null, 2));
  } catch (err) {
    console.error(`[saveDetailItemToJson] Failed to write JSON: ${err.message}`);
  }
}

async function processProductDetailsAccumulate(page, product, detailProgress = null) {
  const mutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_MUTATION_TIMEOUT_MS || '15000', 10) || 15000);
  const mutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const imageMutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_IMAGE_MUTATION_TIMEOUT_MS || '30000', 10) || 30000);
  const imageMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_IMAGE_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const embeddingMutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_EMBEDDING_MUTATION_TIMEOUT_MS || '30000', 10) || 30000);
  const embeddingMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_EMBEDDING_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const newOrOldTimeoutMs = Math.max(4000, Number.parseInt(process.env.GOOFISH_NEWOROLD_TIMEOUT_MS || '30000', 10) || 30000);
  const newOrOldRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_NEWOROLD_RETRY_COUNT || '3', 10) || 3);
  const retryBackoffMs = Math.max(200, Number.parseInt(process.env.GOOFISH_RETRY_BACKOFF_MS || '500', 10) || 500);
  const productTimeoutMs = 180000;
  const specsMutationTimeoutMs = Math.max(4000, Number.parseInt(process.env.GOOFISH_SPECS_MUTATION_TIMEOUT_MS || '30000', 10) || 30000);
  const specsMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_SPECS_MUTATION_RETRY_COUNT || '3', 10) || 3);

  const progressLabel = detailProgress && Number.isFinite(detailProgress.current) && Number.isFinite(detailProgress.total)
    ? ` [${detailProgress.current}/${detailProgress.total}]`
    : '';

  // Local accumulation object
  const accumulatedData = {
    productId: product.id,
    url: product.url,
    soldCount: null,
    newOrOld: null,
    name: null,
    originalName: product.name || null, // Store original Chinese name
    description: null,
    specs: null,
    images: [],
    imageEmbeddings: [], // Store embeddings locally
    categoryId: null,
    isActive: true
  };

  console.log(`\n[Pipeline Accumulate]${progressLabel} Checking details for Product ID ${product.id}: ${product.name}`);
  console.log(`URL: \`${product.url}\``);

  if (!product.url) {
    console.log(`⚠️ No URL. Skipping.`);
    return;
  }

  try {
    await ensureDbReady();
    await withTimeout(async () => {
      const productProcessStartMs = Date.now();
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
      const delay = Math.floor(Math.random() * 1500) + 1000;
      await new Promise(r => setTimeout(r, delay));

      const pageContent = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
    
      let isUnavailable = false;
      let unavailableReason = '';

      for (const keyword of UNAVAILABLE_KEYWORDS) {
        if (pageContent.includes(keyword) || title.includes(keyword)) {
          isUnavailable = true;
          unavailableReason = keyword;
          break;
        }
      }

      if (page.url().includes('login.taobao.com') || page.url().includes('login.tmall.com')) {
        console.warn('⚠️ Redirected to login page. Cannot verify status accurately. Skipping.');
        return;
      }

      if (isUnavailable) {
        console.log(`❌ Product ${product.id} is UNAVAILABLE. Reason: Found keyword: ${unavailableReason}`);
        console.log(`[Accumulate] Skipping unavailable product`);
        return;
      } else {
        console.log(`✅ Product ${product.id} is AVAILABLE.`);
        
        // Extract seller sold count
        const sellerInfo = await page.evaluate(() => {
          const userLabels = document.querySelectorAll('.item-user-info-label--NLTMHARN');
          for (const label of userLabels) {
            const text = label.innerText || '';
            const match = text.match(/卖出(\d+)件宝贝/);
            if (match) return parseInt(match[1], 10);
          }
          return null;
        });
        
        if (sellerInfo !== null) {
          console.log(`[Seller Info] Product ${product.id} - Seller sold count: ${sellerInfo}`);
          accumulatedData.soldCount = sellerInfo;
        }
        
        // Ensure we are on the correct product page
        const currentUrl = page.url();
        const expectedIdMatch = product.url.match(/id=(\d+)/);
        const expectedId = expectedIdMatch ? expectedIdMatch[1] : null;
        
        const isOnProductPage = currentUrl.includes('goofish.com/item') && expectedId && currentUrl.includes(`id=${expectedId}`);

        if (!isOnProductPage) {
           console.log(`⚠️ Browser not on the correct product page (current: ${currentUrl}). Re-navigating to ${product.url}`);
           await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
           await new Promise(r => setTimeout(r, 2000));
        }
      
        // Extract new/old status
        const newOrOldStatus = await page.evaluate(() => {
          try {
            const images = Array.from(document.querySelectorAll('img'));
            const newImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN015hOhg21hTpVIveeDA_!!6000000004279-2-tps-252-60.png';
            const usedImgUrl = 'https://gw.alicdn.com/imgextra/i4/O1CN01MQosre1EmUmuzzD3k_!!6000000000394-2-tps-252-60.png';
            const almostNewImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN01yU5CER1wslIj9m7bv_!!6000000006364-2-tps-252-60.png';

            const hasNewImg = images.some(img => img.src === newImgUrl);
            const hasUsedImg = images.some(img => img.src === usedImgUrl);
            const hasAlmostNewImg = images.some(img => img.src === almostNewImgUrl);

            if (hasNewImg) return true;
            if (hasUsedImg || hasAlmostNewImg) return false;

            const labels = Array.from(document.querySelectorAll('.item--qI9ENIfp'));
            for (const label of labels) {
              const labelText = label.querySelector('.label--ejJeaTRV')?.innerText || '';
              const valueText = label.querySelector('.value--EyQBSInp')?.innerText || '';
          
              if (labelText.includes('成色')) {
                if (valueText.includes('全新')) return true;
                if (valueText.includes('使用痕迹') || valueText.includes('二手') || valueText.includes('闲置') || valueText.includes('有磨损') || valueText.includes('有划痕')) return false;
              }
            }

            const desc = document.querySelector('.desc--GaIUKUQY')?.innerText || '';
            if (desc.includes('全新') && !desc.includes('部分全新') && !desc.includes('99新')) return true;
            if (desc.includes('使用痕迹') || desc.includes('二手') || desc.includes('闲置')) return false;

            return null;
          } catch (e) {
            return null;
          }
        });

        if (newOrOldStatus !== null) {
          console.log(`ℹ️ Product ${product.id} detected as ${newOrOldStatus ? 'NEW' : 'USED'}.`);
          accumulatedData.newOrOld = newOrOldStatus;
        }

        // Extract price
        const priceText = await page.evaluate(() => {
          const selectors = [
            '.price--qH7y0yJl',
            '.price--gq5h3rYh',
            '.price--fHfY0Q3N',
            '[class*="price--"]',
            '.price',
            '.item-price',
            '.price-num'
          ];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              const text = el.innerText || el.textContent || '';
              const match = text.match(/(\d+(?:\.\d+)?)/);
              if (match) return match[1];
            }
          }
          return '';
        });
        if (priceText) {
          const cny = parseCnyPrice(priceText);
          accumulatedData.priceCny = cny;
          console.log(`[Accumulate] Extracted price: ${cny} CNY`);
        } else {
          console.log(`[Accumulate] No price found for ${product.url}`);
        }

        // Extract name and description
        let rawDetailDescription = '';
        const extractedContent = await page.evaluate(() => {
          const mainDiv = document.querySelector('.main--Nu33bWl6.open--gEYf_BQc');
          if (!mainDiv) return null;
          const descSpan = mainDiv.querySelector('.desc--GaIUKUQY');
          if (!descSpan) return null;
          return descSpan.innerText || descSpan.textContent || '';
        });

        if (extractedContent && extractedContent.length > 10) {
          console.log(`[Detail Phase] Extracted content from product page: ${extractedContent.substring(0, 50)}...`);
          
          const generated = await generateTitleAndKeywords(extractedContent, extractedContent);
          
          if (generated.translationSucceeded) {
            console.log(`[Detail Phase] Generated Arabic name: ${generated.titleAr?.substring(0, 30)}...`);
            console.log(`[Detail Phase] Generated Arabic description: ${generated.descriptionAr?.substring(0, 50)}...`);
            
            if (generated.titleAr && hasArabic(generated.titleAr)) {
              accumulatedData.name = generated.titleAr;
            }
            
            if (generated.descriptionAr && hasArabic(generated.descriptionAr)) {
              accumulatedData.description = generated.descriptionAr;
            }
          }
        } else {
          console.log(`[Detail Phase] Could not extract content from specific div, using fallback extraction`);
          
          rawDetailDescription = cleanAiText(await page.evaluate(() => {
            const selectors = [
              '.desc--GaIUKUQY',
              '[class*="desc--"]',
              '.item-desc--fHfY0Q3N',
              '[class*="item-desc"]',
              '[class*="description"]'
            ];
            for (const selector of selectors) {
              const el = document.querySelector(selector);
              const txt = (el?.textContent || '').trim();
              if (txt) return txt;
            }
            const bodyText = (document.body?.innerText || '').trim();
            if (!bodyText) return '';
            const lines = bodyText
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .filter((line) => line.length >= 8)
              .slice(0, 30);
            return lines.join(' ');
          }));
          if (rawDetailDescription) {
            const fallbackDescription = cleanDescriptionText(String(product.name || '').trim());
            const translatedDetailDescription = await translateDetailDescriptionToArabic(product.name || '', rawDetailDescription, fallbackDescription);
            if (translatedDetailDescription && hasArabic(translatedDetailDescription)) {
              accumulatedData.description = translatedDetailDescription;
            }
          }
        }

        // Check if product name is still in Chinese
        const productName = String(product.name || '').trim();
        const isProductNameChinese = /[\u4e00-\u9fff]/.test(productName);
        if (isProductNameChinese) {
          console.log(`[Name Update] Product has Chinese name, translating to Arabic: ${productName.substring(0, 30)}...`);
          const translatedName = await translateFullTitleToArabic(productName, productName);
          if (translatedName && translatedName !== productName && hasArabic(translatedName)) {
            accumulatedData.name = translatedName;
            console.log(`[Name Update] Translated name stored: ${translatedName.substring(0, 30)}...`);
          } else {
            console.warn(`[Name Update] Translation failed or invalid, using original name`);
            accumulatedData.name = productName;
          }
        } else if (accumulatedData.name) {
          console.log(`[Name Update] Using already translated name: ${accumulatedData.name.substring(0, 30)}...`);
        } else {
          console.log(`[Name Update] Name is not Chinese: ${productName.substring(0, 30)}...`);
          accumulatedData.name = productName;
        }

        // Extract category ID from URL
        const urlMatch = product.url.match(/categoryId=(\d+)/);
        if (urlMatch) {
          accumulatedData.categoryId = urlMatch[1];
        }

        // Extract specs
        const existingSpecs = product.specs && product.specs !== 'null' ? String(product.specs) : '';
        const hasArabicSpecs = existingSpecs.length > 0 && /[\u0600-\u06FF]/.test(existingSpecs);
        
        if (!hasArabicSpecs) {
          const elapsedMs = Date.now() - productProcessStartMs;
          const timeLeftMs = productTimeoutMs - elapsedMs;
          if (timeLeftMs >= 45000) {
            const rawSpecs = await page.evaluate(() => {
              try {
                const selectorStrategies = [
                  '.labels--ndhPFgp8 .item--qI9ENIfp',
                  '[class*="labels"] [class*="item"]',
                  '.item--qI9ENIfp',
                  '[class*="item--qI9"]',
                  '[class*="label"]',
                ];
                
                const specs = {};
                let strategyUsed = '';
                let elementsFound = 0;
                
                for (const strategy of selectorStrategies) {
                  let labels;
                  if (strategy === '[class*="label"]') {
                    const allLabels = Array.from(document.querySelectorAll(strategy));
                    labels = allLabels.filter(el => {
                      const parent = el.parentElement;
                      return parent && (parent.querySelector('[class*="value"]') || parent.nextElementSibling?.matches('[class*="value"]'));
                    }).map(el => el.closest('[class*="item"]') || el.parentElement);
                    labels = [...new Set(labels)];
                  } else {
                    labels = Array.from(document.querySelectorAll(strategy));
                  }
                  
                  if (labels.length > 0) {
                    elementsFound = labels.length;
                    strategyUsed = strategy;
                    
                    for (const item of labels) {
                      const labelSelectors = ['.label--ejJeaTRV', '[class*="label--"]', '[class*="label"]'];
                      const valueSelectors = ['.value--EyQBSInp', '[class*="value--"]', '[class*="value"]'];
                      
                      let labelEl = null;
                      for (const sel of labelSelectors) {
                        labelEl = item.querySelector(sel);
                        if (labelEl) break;
                      }
                      if (!labelEl) continue;
                      
                      let valueEl = null;
                      for (const sel of valueSelectors) {
                        valueEl = item.querySelector(sel);
                        if (valueEl) break;
                      }
                      if (!valueEl) {
                        const parentText = item.textContent || '';
                        const labelText = labelEl.textContent || '';
                        const remainingText = parentText.replace(labelText, '').trim();
                        if (remainingText) {
                          valueEl = { innerText: remainingText };
                        } else {
                          continue;
                        }
                      }
                      
                      let key = labelEl.innerText?.replace(/[\n\r\s\uff1a?:]/g, '').trim() || '';
                      let value = (valueEl.innerText || valueEl.textContent || '').trim();
                      
                      if (key && value && key.length < 50 && value.length < 200) {
                        specs[key] = value;
                      }
                    }
                    
                    if (Object.keys(specs).length > 0) {
                      break;
                    }
                  }
                }
                
                return Object.keys(specs).length > 0 ? { specs, debug: { strategy: strategyUsed, count: elementsFound } } : { specs: null, debug: { strategy: strategyUsed || 'none', count: elementsFound } };
              } catch (e) {
                return { specs: null, debug: { error: e.message, strategy: 'error', count: 0 } };
              }
            });
            
            console.log(`[Specs Debug] Product ${product.id}: strategy="${rawSpecs?.debug?.strategy || 'unknown'}", elements=${rawSpecs?.debug?.count || 0}`);
            
            const extractedSpecs = rawSpecs?.specs || null;

            if (extractedSpecs) {
              console.log(`ℹ️ Found specs for Product ${product.id}:`, JSON.stringify(extractedSpecs));
        
              const rawSpecsText = JSON.stringify(extractedSpecs);

              if (SILICONFLOW_API_KEY) {
                console.log(`ℹ️ Product ${product.id} specs found. Attempting translation...`);
                try {
                  const prompt = `You are translating product specifications for an Iraqi e-commerce website. Translate the following JSON from Chinese to Arabic (Iraqi dialect preferred).

CRITICAL RULES:
- Translate ALL keys to meaningful Arabic labels - THIS IS MANDATORY
- Translate ALL values to Arabic
- Keep brand names in ENGLISH if they are English (like Apple, Nike, etc.)
- Transliterate Chinese brand names to Arabic (like 芬腾 → فينتن)
- Keep model numbers as-is
- "适用人群":"成人" must translate to "بالغين" (adults) NOT "ult"
- Do NOT include Chinese characters in output - NEITHER KEYS NOR VALUES
- Return ONLY a valid JSON object, no markdown, no explanations

Key translations (memorize these):
品牌 → الماركة
成色 → الحالة
适用性别 → الجنس
适用季节 → الموسم
尺码 → المقاس
适用人群 → الفئة المستهدفة
材质 → المادة
颜色 → اللون

Input JSON:
${JSON.stringify(extractedSpecs)}

Output JSON ONLY (with Arabic keys and Arabic values):`;
                  const result = await callSiliconFlow([
                    { role: 'system', content: 'You are a Chinese to Arabic translator for e-commerce product specifications.' },
                    { role: 'user', content: prompt }
                  ], 0.2, 300, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
                  
                  const translatedSpecs = JSON.parse(result.trim());
                  console.log(`✅ Translated specs for Product ${product.id}:`, JSON.stringify(translatedSpecs));
                  accumulatedData.specs = translatedSpecs;
                } catch (specErr) {
                  console.warn(`⚠️ Failed to translate specs for Product ${product.id}: ${toErrorText(specErr)}`);
                }
              }
            }
          }
        }

        // Add soldCount to specs
        if (accumulatedData.soldCount !== null && accumulatedData.soldCount !== undefined) {
          if (!accumulatedData.specs) {
            accumulatedData.specs = {};
          }
          accumulatedData.specs['عدد المبيعات'] = String(accumulatedData.soldCount);
          console.log(`[Accumulate] Added soldCount to specs: ${accumulatedData.soldCount}`);
        }

        // Extract images
        const images = await page.evaluate(() => {
          const mainWindow = document.querySelector('.item-main-window--BgQbsIsU');
          const imgElements = mainWindow ? Array.from(mainWindow.querySelectorAll('img')) : [];
          const imageUrls = [];
          const seenUrls = new Set();
          for (const img of imgElements) {
            const src = img.src || img.getAttribute('data-src');
            if (src && src.includes('alicdn.com') && !src.includes('logo') && !src.includes('icon') && src.length > 20) {
              // Filter out placeholder/white images
              // Common patterns for placeholder images on alicdn
              if (src.includes('100x100') || src.includes('50x50') || src.includes('40x40')) {
                continue; // Skip small placeholder images
              }
              if (src.includes('loading') || src.includes('placeholder') || src.includes('blank')) {
                continue; // Skip loading/placeholder images
              }
              if (src.includes('T1') && src.includes('_.webp')) {
                continue; // Skip common placeholder pattern
              }
              // Skip images that are too small (likely placeholders)
              if (src.match(/_\d+x\d+\./)) {
                const match = src.match(/_(\d+)x(\d+)\./);
                if (match) {
                  const width = parseInt(match[1], 10);
                  const height = parseInt(match[2], 10);
                  if (width < 200 || height < 200) {
                    continue; // Skip small images
                  }
                }
              }
              if (!seenUrls.has(src)) {
                seenUrls.add(src);
                imageUrls.push(src);
              }
            }
          }
          return imageUrls.slice(0, 10);
        });
        
        if (images.length > 0) {
          console.log(`Found ${images.length} images.`);
          // Sanitize all image URLs before storing
          accumulatedData.images = images.map(sanitizeProductImageUrl).filter(url => url);
          
          // Generate embeddings locally for each image
          if (!GOOFISH_DISABLE_IMAGE_EMBEDDINGS) {
            console.log(`[Accumulate] Generating embeddings locally for ${accumulatedData.images.length} images...`);
            for (let i = 0; i < Math.min(accumulatedData.images.length, 5); i++) {
              const imageUrl = accumulatedData.images[i];
              if (!imageUrl) continue;
              
              try {
                console.log(`[Accumulate] Generating embedding for image ${i + 1}/${Math.min(accumulatedData.images.length, 5)}...`);
                const embedding = await embedImage(imageUrl, accumulatedData.name || product.name || null);
                if (Array.isArray(embedding) && embedding.length > 0 && !embedding.every(v => v === 0)) {
                  accumulatedData.imageEmbeddings.push({
                    url: imageUrl,
                    embedding: embedding,
                    order: i
                  });
                  console.log(`[Accumulate] Generated embedding for image ${i + 1}`);
                } else {
                  console.log(`[Accumulate] Skipped image ${i + 1} - empty embedding`);
                }
              } catch (embedErr) {
                console.warn(`[Accumulate] Failed to generate embedding for image ${i + 1}: ${toErrorText(embedErr)}`);
              }
            }
            console.log(`[Accumulate] Generated ${accumulatedData.imageEmbeddings.length} embeddings locally`);
          }
        }
      }

      // Now push all accumulated data to DB in one transaction OR save to queue
      if (USE_QUEUE_MODE) {
        console.log(`[Accumulate] Queue mode enabled, saving product to queue file...`);
        const saved = await saveToQueue(accumulatedData);
        if (saved) {
          console.log(`[Accumulate] Successfully saved product to queue`);
        } else {
          console.error(`[Accumulate] Failed to save product to queue`);
        }
      } else {
        console.log(`[Accumulate] Creating product with all data...`);
        
        let createdProduct;
        const maxDbRetries = 10;
        let dbRetryCount = 0;
        
        while (dbRetryCount < maxDbRetries) {
          try {
            createdProduct = await prisma.$transaction(async (tx) => {
              console.log(`[Accumulate] Transaction started for product creation (attempt ${dbRetryCount + 1}/${maxDbRetries})`);
              // Create product with all data
              const basePriceIQD = Math.max(0, Number(accumulatedData.priceCny || 0) * CNY_TO_IQD_RATE);
              const multiplier = calculatePriceMultiplier(basePriceIQD);
              const priceIQD = Math.round(basePriceIQD * multiplier);
              console.log(`[Accumulate] Calculated price: ${accumulatedData.priceCny || 0} CNY -> ${priceIQD} IQD`);

            const newProduct = await tx.product.create({
              data: {
                purchaseUrl: accumulatedData.url,
                name: accumulatedData.name || product.name,
                image: accumulatedData.images && accumulatedData.images.length > 0 ? accumulatedData.images[0] : product.image,
                price: priceIQD,
                basePriceIQD,
                neworold: accumulatedData.newOrOld,
                specs: accumulatedData.specs ? JSON.stringify(accumulatedData.specs) : null,
                aiMetadata: {
                  source: "goofish",
                  scrapedAt: new Date().toISOString(),
                  soldCount: accumulatedData.soldCount || null,
                  isRealBrand: null,
                  goofishItemId: accumulatedData.url.match(/id=(\d+)/)?.[1] || null,
                  originalTitle: product.name,
                  translatedDescription: accumulatedData.description || null,
                  detailTranslationUpdatedAt: accumulatedData.description ? new Date().toISOString() : null
                },
                isActive: accumulatedData.isActive,
                keywords: [],
                imagesChecked: true
              }
            });
            
            console.log(`[Accumulate] Created product with ID: ${newProduct.id}`);
            
            // Assign category inside transaction if categoryId is available
            if (accumulatedData.categoryId) {
              console.log(`[Accumulate] Assigning category inside transaction for Product ${newProduct.id}...`);
              try {
                const categoryId = extractCategoryId(accumulatedData.url);
                let categorySlug = null;
                let categoryNameAr = null;

                if (categoryId && goofishMappings[categoryId]) {
                  categorySlug = goofishMappings[categoryId];
                  const existingCat = categories.find(c => c.slug === categorySlug);
                  categoryNameAr = existingCat?.name_ar || categorySlug;
                  console.log(`  → Using existing mapping: ${categorySlug}`);
                }

                if (categorySlug && categoryNameAr) {
                  let categoryRecord = await tx.category.findUnique({
                    where: { slug: categorySlug }
                  });

                  if (!categoryRecord) {
                    console.log(`  → Category not found in database, creating: ${categorySlug}`);
                    categoryRecord = await tx.category.create({
                      data: {
                        slug: categorySlug,
                        nameAr: categoryNameAr,
                        nameEn: categoryNameAr,
                        goofishCategoryId: categoryId || null
                      }
                    });
                    console.log(`  → Created category in database with ID: ${categoryRecord.id}`);
                  } else {
                    console.log(`  → Found category in database with ID: ${categoryRecord.id}`);
                  }

                  // Update product with categoryId
                  await tx.product.update({
                    where: { id: newProduct.id },
                    data: { categoryId: categoryRecord.id }
                  });
                  console.log(`✅ Assigned category inside transaction: ${categorySlug} (${categoryRecord.id})`);
                }
              } catch (catErr) {
                console.warn(`⚠️ Failed to assign category inside transaction: ${toErrorText(catErr)}`);
              }
            }
            
            // Insert images without embeddings first (vector type causes issues in INSERT)
            if (accumulatedData.images && accumulatedData.images.length > 0) {
              for (const imageUrl of accumulatedData.images) {
                try {
                  await tx.productImage.create({
                    data: {
                      productId: newProduct.id,
                      url: imageUrl,
                      order: accumulatedData.images.indexOf(imageUrl),
                      type: 'GALLERY'
                    }
                  });
                } catch (imageErr) {
                  console.error(`[Accumulate] Failed to insert image ${imageUrl}: ${toErrorText(imageErr)}`);
                  throw imageErr;
                }
              }
            }
            
            return newProduct;
          }, {
            timeout: 120000
          });
          
          console.log(`✅ Transaction committed successfully for product ${createdProduct.id}`);
          console.log(`[Accumulate] Transaction completed successfully for product`);
          break; // Success - exit retry loop
        } catch (txErr) {
          dbRetryCount++;
          const errorMsg = toErrorText(txErr);
          console.error(`[Accumulate] Transaction failed for product (attempt ${dbRetryCount}/${maxDbRetries}): ${errorMsg}`);
          
          // Check if it's a retryable database error
          const isRetryable = isRetryableDbError(txErr) || errorMsg.includes('Server has closed the connection');
          
          if (!isRetryable || dbRetryCount >= maxDbRetries) {
            console.error(`[Accumulate] Transaction failed after ${dbRetryCount} attempts, giving up`);
            throw txErr;
          }
          
          // Wait before retry with exponential backoff
          const backoffMs = Math.min(5000, 1000 * dbRetryCount);
          console.log(`[Accumulate] Waiting ${backoffMs}ms before retry...`);
          await new Promise(r => setTimeout(r, backoffMs));
          
          // Try to reconnect before retry
          try {
            await recoverDbConnectionQuick(`accumulate retry ${dbRetryCount}`);
            console.log(`[Accumulate] Reconnected to database, retrying transaction...`);
          } catch (reconnectErr) {
            console.warn(`[Accumulate] Reconnect failed, will retry anyway: ${toErrorText(reconnectErr)}`);
          }
        }
      }
      
      console.log(`✅ Successfully created product ${createdProduct.id} with all data`);
      
      // Verify product exists in database
      try {
        const verification = await prisma.product.findUnique({
          where: { id: createdProduct.id }
        });
        if (verification) {
          console.log(`✅ Verified product ${createdProduct.id} exists in database`);
        } else {
          console.error(`❌ Product ${createdProduct.id} NOT FOUND in database after transaction commit!`);
        }
      } catch (verifyErr) {
        console.error(`❌ Failed to verify product ${createdProduct.id}: ${toErrorText(verifyErr)}`);
      }
      
      // Update image embeddings after transaction using the existing service
      if (accumulatedData.imageEmbeddings && accumulatedData.imageEmbeddings.length > 0) {
        console.log(`[Accumulate] Using ensureProductImageEmbeddings service to update embeddings for ${accumulatedData.imageEmbeddings.length} images...`);
        
        const maxEmbeddingRetries = 5;
        let embeddingRetryCount = 0;
        
        while (embeddingRetryCount < maxEmbeddingRetries) {
          try {
            const result = await ensureProductImageEmbeddings({
              prisma,
              productId: createdProduct.id,
              productName: createdProduct.name,
              maxImages: accumulatedData.imageEmbeddings.length
            });
            console.log(`[Accumulate] ensureProductImageEmbeddings completed: ${result.embeddedCount} images embedded`);
            break; // Success - exit retry loop
          } catch (embErr) {
            embeddingRetryCount++;
            const errorMsg = toErrorText(embErr);
            console.error(`[Accumulate] ensureProductImageEmbeddings failed for product ${createdProduct.id} (attempt ${embeddingRetryCount}/${maxEmbeddingRetries}): ${errorMsg}`);
            
            // Check if it's a retryable database error
            const isRetryable = isRetryableDbError(embErr) || errorMsg.includes('Server has closed the connection');
            
            if (!isRetryable || embeddingRetryCount >= maxEmbeddingRetries) {
              console.warn(`⚠️ ensureProductImageEmbeddings failed after ${embeddingRetryCount} attempts, skipping embeddings for product ${createdProduct.id}`);
              break;
            }
            
            // Wait before retry with exponential backoff
            const backoffMs = Math.min(3000, 500 * embeddingRetryCount);
            console.log(`[Accumulate] Waiting ${backoffMs}ms before retrying embeddings...`);
            await new Promise(r => setTimeout(r, backoffMs));
            
            // Try to reconnect before retry
            try {
              await recoverDbConnectionQuick(`embedding retry ${embeddingRetryCount}`);
              console.log(`[Accumulate] Reconnected to database, retrying embeddings...`);
            } catch (reconnectErr) {
              console.warn(`[Accumulate] Reconnect failed, will retry anyway: ${toErrorText(reconnectErr)}`);
            }
          }
        }
      }
      
      // Clear accumulated data
      Object.keys(accumulatedData).forEach(key => {
        if (key !== 'productId') {
          accumulatedData[key] = null;
        }
        if (key === 'images') {
          accumulatedData[key] = [];
        }
      });
      console.log(`[Accumulate] Cleared local data for Product ${product.id}`);
      }
      
    }, `processProductDetailsAccumulate ${product.id}`, productTimeoutMs);
  } catch (err) {
    console.error(`[Accumulate] Error processing Product ${product.id}: ${toErrorText(err)}`);
    throw err;
  }
}

async function processProductDetails(page, product, detailProgress = null) {
  // If batch insert mode is enabled, gather data to JSON instead of DB updates
  if (BATCH_INSERT_FROM_JSON) {
    const index = detailProgress?.current || 0;
    return processProductDetailsToJson(page, product.url, index);
  }
  
  // If accumulate per product mode is enabled, gather all data locally then push once
  if (GOOFISH_ACCUMULATE_PER_PRODUCT) {
    return processProductDetailsAccumulate(page, product, detailProgress);
  }
  
  const mutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_MUTATION_TIMEOUT_MS || '15000', 10) || 15000);
  const mutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const imageMutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_IMAGE_MUTATION_TIMEOUT_MS || '30000', 10) || 30000);
  const imageMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_IMAGE_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const embeddingMutationTimeoutMs = Math.max(5000, Number.parseInt(process.env.GOOFISH_EMBEDDING_MUTATION_TIMEOUT_MS || '30000', 10) || 30000);
  const embeddingMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_EMBEDDING_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const newOrOldTimeoutMs = Math.max(4000, Number.parseInt(process.env.GOOFISH_NEWOROLD_TIMEOUT_MS || '30000', 10) || 30000);
  const newOrOldRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_NEWOROLD_RETRY_COUNT || '3', 10) || 3);
  const retryBackoffMs = Math.max(200, Number.parseInt(process.env.GOOFISH_RETRY_BACKOFF_MS || '500', 10) || 500);
  const productTimeoutMs = Math.max(30000, Number.parseInt(process.env.GOOFISH_PRODUCT_TIMEOUT_MS || '180000', 10) || 180000);
  const specsMutationTimeoutMs = Math.max(4000, Number.parseInt(process.env.GOOFISH_SPECS_MUTATION_TIMEOUT_MS || '30000', 10) || 30000);
  const specsMutationRetryCount = Math.max(1, Number.parseInt(process.env.GOOFISH_SPECS_MUTATION_RETRY_COUNT || '3', 10) || 3);
  const updateNewOrOld = async (statusValue) => withRetry(
    () => prisma.$executeRaw`
      UPDATE "Product"
      SET "neworold" = ${statusValue},
          "updatedAt" = NOW()
      WHERE "id" = ${product.id}
    `,
    `update neworold raw ${product.id}`,
    newOrOldRetryCount,
    newOrOldTimeoutMs,
    retryBackoffMs
  );
  const updateSpecsValue = async (specsValue, label) => withRetry(
    () => prisma.$executeRaw`
      UPDATE "Product"
      SET "specs" = ${specsValue},
          "updatedAt" = NOW()
      WHERE "id" = ${product.id}
    `,
    label,
    specsMutationRetryCount,
    specsMutationTimeoutMs,
    retryBackoffMs
  );

  const progressLabel = detailProgress && Number.isFinite(detailProgress.current) && Number.isFinite(detailProgress.total)
    ? ` [${detailProgress.current}/${detailProgress.total}]`
    : '';
  console.log(`\n[Pipeline]${progressLabel} Checking details for Product ID ${product.id}: ${product.name}`);
  console.log(`URL: \`${product.url}\``);

  if (!product.url) {
    console.log(`⚠️ No URL. Skipping.`);
    return;
  }

  try {
    await ensureDbReady();
    await withTimeout(async () => {
      const productProcessStartMs = Date.now();
      await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
      const delay = Math.floor(Math.random() * 1500) + 1000;
      await new Promise(r => setTimeout(r, delay));

      const pageContent = await page.evaluate(() => document.body.innerText);
      const title = await page.title();
    
      let isUnavailable = false;
      let unavailableReason = '';

      for (const keyword of UNAVAILABLE_KEYWORDS) {
        if (pageContent.includes(keyword) || title.includes(keyword)) {
          isUnavailable = true;
          unavailableReason = keyword;
          break;
        }
      }

      if (page.url().includes('login.taobao.com') || page.url().includes('login.tmall.com')) {
        console.warn('⚠️ Redirected to login page. Cannot verify status accurately. Skipping.');
        return;
      }

      if (isUnavailable) {
        console.log(`❌ Product ${product.id} is UNAVAILABLE. Reason: Found keyword: ${unavailableReason}`);
      
        await withRetry(
          () => prisma.product.update({
            where: { id: product.id },
            data: { isActive: false }
          }),
          `update isActive ${product.id}`,
          mutationRetryCount,
          mutationTimeoutMs,
          retryBackoffMs
        );
      } else {
        console.log(`✅ Product ${product.id} is AVAILABLE.`);
        
        // Extract seller sold count from user info
        const sellerInfo = await page.evaluate(() => {
          const userLabels = document.querySelectorAll('.item-user-info-label--NLTMHARN');
          for (const label of userLabels) {
            const text = label.innerText || '';
            const match = text.match(/卖出(\d+)件宝贝/);
            if (match) return parseInt(match[1], 10);
          }
          return null;
        });
        
        if (sellerInfo !== null) {
          console.log(`[Seller Info] Product ${product.id} - Seller sold count: ${sellerInfo}`);
          try {
            await withRetry(
              () => prisma.$executeRaw`
                UPDATE "Product"
                SET "aiMetadata" = COALESCE("aiMetadata", '{}'::jsonb) || jsonb_build_object('soldCount', ${sellerInfo}),
                    "updatedAt" = NOW()
                WHERE id = ${product.id}
              `,
              `update sold count ${product.id}`,
              mutationRetryCount,
              mutationTimeoutMs,
              retryBackoffMs
            );
            console.log(`✅ Updated seller sold count for Product ${product.id}`);
          } catch (soldCountErr) {
            console.warn(`⚠️ Failed to update sold count for Product ${product.id}: ${toErrorText(soldCountErr)}`);
          }
        }
        
        // Ensure we are actually on the product URL before evaluating anything
        const currentUrl = page.url();
        const expectedIdMatch = product.url.match(/id=(\d+)/);
        const expectedId = expectedIdMatch ? expectedIdMatch[1] : null;
        
        const isOnProductPage = currentUrl.includes('goofish.com/item') && expectedId && currentUrl.includes(`id=${expectedId}`);

        if (!isOnProductPage) {
           console.log(`⚠️ Browser not on the correct product page (current: ${currentUrl}). Re-navigating to ${product.url}`);
           await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
           await new Promise(r => setTimeout(r, 2000));
        }
      
        const newOrOldStatus = await page.evaluate(() => {
          try {
            const images = Array.from(document.querySelectorAll('img'));
            const newImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN015hOhg21hTpVIveeDA_!!6000000004279-2-tps-252-60.png';
            const usedImgUrl = 'https://gw.alicdn.com/imgextra/i4/O1CN01MQosre1EmUmuzzD3k_!!6000000000394-2-tps-252-60.png';
            const almostNewImgUrl = 'https://gw.alicdn.com/imgextra/i3/O1CN01yU5CER1wslIj9m7bv_!!6000000006364-2-tps-252-60.png';

            const hasNewImg = images.some(img => img.src === newImgUrl);
            const hasUsedImg = images.some(img => img.src === usedImgUrl);
            const hasAlmostNewImg = images.some(img => img.src === almostNewImgUrl);

            if (hasNewImg) return true;
            if (hasUsedImg || hasAlmostNewImg) return false;

            const labels = Array.from(document.querySelectorAll('.item--qI9ENIfp'));
            for (const label of labels) {
              const labelText = label.querySelector('.label--ejJeaTRV')?.innerText || '';
              const valueText = label.querySelector('.value--EyQBSInp')?.innerText || '';
          
              if (labelText.includes('成色')) {
                if (valueText.includes('全新')) return true;
                if (valueText.includes('使用痕迹') || valueText.includes('二手') || valueText.includes('闲置') || valueText.includes('有磨损') || valueText.includes('有划痕')) return false;
              }
            }

            const desc = document.querySelector('.desc--GaIUKUQY')?.innerText || '';
            if (desc.includes('全新') && !desc.includes('部分全新') && !desc.includes('99新')) return true;
            if (desc.includes('使用痕迹') || desc.includes('二手') || desc.includes('闲置')) return false;

            return null;
          } catch (e) {
            return null;
          }
        });

        if (newOrOldStatus !== null) {
          console.log(`ℹ️ Product ${product.id} detected as ${newOrOldStatus ? 'NEW' : 'USED'}. Updating...`);
          try {
            await updateNewOrOld(newOrOldStatus);
          } catch (updateErr) {
            console.error(`Error updating neworold for Product ${product.id} (code=${toErrorCode(updateErr) || 'n/a'}): ${toErrorText(updateErr)}`);
            const updateErrText = toErrorText(updateErr);
            const updateErrCode = toErrorCode(updateErr);
            if (
              updateErrText.includes('Server has closed the connection')
              || updateErrText.includes("Can't reach database server")
              || updateErrText.includes('timed out after')
              || updateErrCode === 'P1017'
              || updateErrCode === 'P1001'
            ) {
              await safeDbDisconnect();
              try {
                await withRetry(
                  () => prisma.$connect(),
                  'reconnect after neworold failure',
                  1,
                  12000,
                  500
                );
              } catch {}
              console.warn(`Skipping neworold update for Product ${product.id} after retries.`);
            }
          }
        }

        // Extract name and description from the specific div
        let rawDetailDescription = '';
        const extractedContent = await page.evaluate(() => {
          const mainDiv = document.querySelector('.main--Nu33bWl6.open--gEYf_BQc');
          if (!mainDiv) return null;
          const descSpan = mainDiv.querySelector('.desc--GaIUKUQY');
          if (!descSpan) return null;
          return descSpan.innerText || descSpan.textContent || '';
        });

        if (extractedContent && extractedContent.length > 10) {
          console.log(`[Detail Phase] Extracted content from product page: ${extractedContent.substring(0, 50)}...`);
          
          // Generate Arabic name and description from extracted content
          const generated = await generateTitleAndKeywords(extractedContent, extractedContent);
          
          if (generated.translationSucceeded) {
            console.log(`[Detail Phase] Generated Arabic name: ${generated.titleAr?.substring(0, 30)}...`);
            console.log(`[Detail Phase] Generated Arabic description: ${generated.descriptionAr?.substring(0, 50)}...`);
            
            // Update product name
            if (generated.titleAr && hasArabic(generated.titleAr)) {
              try {
                await withRetry(
                  () => prisma.$executeRaw`
                    UPDATE "Product"
                    SET "name" = ${generated.titleAr},
                        "updatedAt" = NOW()
                    WHERE id = ${product.id}
                  `,
                  `update product name ${product.id}`,
                  mutationRetryCount,
                  mutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`✅ Updated product name for Product ${product.id}`);
              } catch (nameUpdateErr) {
                console.warn(`⚠️ Failed to update product name for Product ${product.id}: ${toErrorText(nameUpdateErr)}`);
                if (isRetryableDbError(nameUpdateErr)) triggerDbReconnectNonBlocking(`update product name ${product.id}`);
              }
            }
            
            // Update product description
            if (generated.descriptionAr && hasArabic(generated.descriptionAr)) {
              try {
                await withRetry(
                  () => updateProductTranslatedDescription(product.id, generated.descriptionAr),
                  `update translated description ${product.id}`,
                  mutationRetryCount,
                  mutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`✅ Updated translated description for Product ${product.id}`);
              } catch (descUpdateErr) {
                console.warn(`⚠️ Failed to update translated description for Product ${product.id}: ${toErrorText(descUpdateErr)}`);
                if (isRetryableDbError(descUpdateErr)) triggerDbReconnectNonBlocking(`update translated description ${product.id}`);
              }
            }
          }
        } else {
          console.log(`[Detail Phase] Could not extract content from specific div, using fallback extraction`);
          
          let translatedDetailDescription = '';
          rawDetailDescription = cleanAiText(await page.evaluate(() => {
            const selectors = [
              '.desc--GaIUKUQY',
              '[class*="desc--"]',
              '.item-desc--fHfY0Q3N',
              '[class*="item-desc"]',
              '[class*="description"]'
            ];
            for (const selector of selectors) {
              const el = document.querySelector(selector);
              const txt = (el?.textContent || '').trim();
              if (txt) return txt;
            }
            const bodyText = (document.body?.innerText || '').trim();
            if (!bodyText) return '';
            const lines = bodyText
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .filter((line) => line.length >= 8)
              .slice(0, 30);
            return lines.join(' ');
          }));
          if (rawDetailDescription) {
            const fallbackDescription = cleanDescriptionText(String(product.name || '').trim());
            translatedDetailDescription = await translateDetailDescriptionToArabic(product.name || '', rawDetailDescription, fallbackDescription);
            if (translatedDetailDescription && hasArabic(translatedDetailDescription)) {
              try {
                await withRetry(
                  () => updateProductTranslatedDescription(product.id, translatedDetailDescription),
                  `update translated description ${product.id}`,
                  mutationRetryCount,
                  mutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`✅ Updated translated description for Product ${product.id}`);
              } catch (descUpdateErr) {
                console.warn(`⚠️ Failed to update translated description for Product ${product.id}: ${toErrorText(descUpdateErr)}`);
                if (isRetryableDbError(descUpdateErr)) triggerDbReconnectNonBlocking(`update translated description ${product.id}`);
              }
            }
          }
        }

        // Check if product name is still in Chinese and update it
        const productName = String(product.name || '').trim();
        const isProductNameChinese = /[\u4e00-\u9fff]/.test(productName);
        if (isProductNameChinese) {
          console.log(`[Name Update] Product ${product.id} has Chinese name, translating to Arabic...`);
          const translatedName = await translateFullTitleToArabic(productName, productName);
          if (translatedName && translatedName !== productName && hasArabic(translatedName)) {
            try {
              await withRetry(
                () => prisma.$executeRaw`
                  UPDATE "Product"
                  SET "name" = ${translatedName},
                      "updatedAt" = NOW()
                  WHERE id = ${product.id}
                `,
                `update product name ${product.id}`,
                mutationRetryCount,
                mutationTimeoutMs,
                retryBackoffMs
              );
              console.log(`✅ Updated product name for Product ${product.id}: ${translatedName}`);
            } catch (nameUpdateErr) {
              console.warn(`⚠️ Failed to update product name for Product ${product.id}: ${toErrorText(nameUpdateErr)}`);
              if (isRetryableDbError(nameUpdateErr)) triggerDbReconnectNonBlocking(`update product name ${product.id}`);
            }
          }
        }

        // Assign category to product in detail phase
        try {
          await assignCategoryToProduct(product.id, product.name, product.url);
          console.log(`✅ Category assignment completed for Product ${product.id}`);
        } catch (categoryErr) {
          console.warn(`⚠️ Failed to assign category for Product ${product.id}: ${toErrorText(categoryErr)}`);
        }

        // Check if specs already exist and contain Arabic - only then skip
        const existingSpecs = product.specs && product.specs !== 'null' ? String(product.specs) : '';
        const hasArabicSpecs = existingSpecs.length > 0 && /[\u0600-\u06FF]/.test(existingSpecs);
        
        if (hasArabicSpecs) {
          console.log(`ℹ️ Arabic specs already exist for Product ${product.id}. Skipping extraction.`);
        } else {
          const elapsedMs = Date.now() - productProcessStartMs;
          const elapsedSec = Math.round(elapsedMs / 1000);
          const timeLeftMs = productTimeoutMs - elapsedMs;
          if (timeLeftMs < 45000) {
            console.warn(`⏱️ Skipping spec extraction for Product ${product.id} - only ${timeLeftMs/1000}s left (${elapsedSec}s elapsed).`);
          } else {
          const rawSpecs = await page.evaluate(() => {
            try {
              // Try multiple selector strategies since Xianyu/Goofish changes class names frequently
              const selectorStrategies = [
                // Strategy 1: Current known selectors
                '.labels--ndhPFgp8 .item--qI9ENIfp',
                // Strategy 2: Generic label/value patterns
                '[class*="labels"] [class*="item"]',
                // Strategy 3: Direct item selectors
                '.item--qI9ENIfp',
                '[class*="item--qI9"]',
                // Strategy 4: Any element with label + value children
                '[class*="label"]',
              ];
              
              const specs = {};
              let strategyUsed = '';
              let elementsFound = 0;
              
              for (const strategy of selectorStrategies) {
                let labels;
                if (strategy === '[class*="label"]') {
                  // Special handling: find parent containers that have both label and value
                  const allLabels = Array.from(document.querySelectorAll(strategy));
                  labels = allLabels.filter(el => {
                    const parent = el.parentElement;
                    return parent && (parent.querySelector('[class*="value"]') || parent.nextElementSibling?.matches('[class*="value"]'));
                  }).map(el => el.closest('[class*="item"]') || el.parentElement);
                  // Deduplicate
                  labels = [...new Set(labels)];
                } else {
                  labels = Array.from(document.querySelectorAll(strategy));
                }
                
                if (labels.length > 0) {
                  elementsFound = labels.length;
                  strategyUsed = strategy;
                  
                  for (const item of labels) {
                    // Try multiple label/value selector patterns
                    const labelSelectors = ['.label--ejJeaTRV', '[class*="label--"]', '[class*="label"]'];
                    const valueSelectors = ['.value--EyQBSInp', '[class*="value--"]', '[class*="value"]'];
                    
                    let labelEl = null;
                    for (const sel of labelSelectors) {
                      labelEl = item.querySelector(sel);
                      if (labelEl) break;
                    }
                    if (!labelEl) continue;
                    
                    let valueEl = null;
                    for (const sel of valueSelectors) {
                      valueEl = item.querySelector(sel);
                      if (valueEl) break;
                    }
                    if (!valueEl) {
                      // Try getting value from next sibling or parent text
                      const parentText = item.textContent || '';
                      const labelText = labelEl.textContent || '';
                      const remainingText = parentText.replace(labelText, '').trim();
                      if (remainingText) {
                        valueEl = { innerText: remainingText };
                      } else {
                        continue;
                      }
                    }
                    
                    let key = labelEl.innerText?.replace(/[\n\r\s\uff1a?:]/g, '').trim() || '';
                    let value = (valueEl.innerText || valueEl.textContent || '').trim();
                    
                    if (key && value && key.length < 50 && value.length < 200) {
                      specs[key] = value;
                    }
                  }
                  
                  if (Object.keys(specs).length > 0) {
                    break; // Found specs, stop trying strategies
                  }
                }
              }
              
              // Return metadata for debugging
              return Object.keys(specs).length > 0 ? { specs, debug: { strategy: strategyUsed, count: elementsFound } } : { specs: null, debug: { strategy: strategyUsed || 'none', count: elementsFound } };
            } catch (e) {
              return { specs: null, debug: { error: e.message, strategy: 'error', count: 0 } };
            }
          });
          
          console.log(`[Specs Debug] Product ${product.id}: strategy="${rawSpecs?.debug?.strategy || 'unknown'}", elements=${rawSpecs?.debug?.count || 0}`);
          
          const extractedSpecs = rawSpecs?.specs || null;

          if (extractedSpecs) {
            console.log(`ℹ️ Found specs for Product ${product.id}:`, JSON.stringify(extractedSpecs));
        
            const rawSpecsText = JSON.stringify(extractedSpecs);

            if (SILICONFLOW_API_KEY) {
              console.log(`ℹ️ Product ${product.id} specs found. Attempting translation...`);
              try {
                const prompt = `You are translating product specifications for an Iraqi e-commerce website. Translate the following JSON from Chinese to Arabic (Iraqi dialect preferred).

CRITICAL RULES:
- Translate ALL keys to meaningful Arabic labels - THIS IS MANDATORY
- Translate ALL values to Arabic
- Keep brand names in ENGLISH if they are English (like Apple, Nike, etc.)
- Transliterate Chinese brand names to Arabic (like 芬腾 → فينتن)
- Keep model numbers as-is
- "适用人群":"成人" must translate to "بالغين" (adults) NOT "ult"
- Do NOT include Chinese characters in output - NEITHER KEYS NOR VALUES
- Return ONLY a valid JSON object, no markdown, no explanations

Key translations (memorize these):
品牌 → الماركة
成色 → الحالة
适用性别 → الجنس
适用季节 → الموسم
尺码 → المقاس
适用人群 → الفئة المستهدفة
材质 → المادة
颜色 → اللون

Examples:
{"品牌": "苹果"} → {"الماركة": "Apple"}
{"品牌": "芬腾"} → {"الماركة": "فينتن"}
{"成色": "全新"} → {"الحالة": "جديد"}
{"适用人群": "成人"} → {"الفئة المستهدفة": "بالغين"}
{"连接方式": "蓝牙连接"} → {"نوع الاتصال": "بلوتوث"}
{"功能": "蓝牙通话"} → {"الوظائف": "مكالمات بلوتوث"}

Input JSON:
${JSON.stringify(extractedSpecs)}

Output JSON ONLY (with Arabic keys and Arabic values):`;
                
                const translatedJsonStr = await callSiliconFlow([{ role: "user", content: prompt }], 0.2, 300, { timeoutMs: GOOFISH_AI_CALL_TIMEOUT_MS });
                
                if (translatedJsonStr) {
                  const cleanJson = translatedJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
                  let translatedSpecs;
                  try {
                    translatedSpecs = JSON.parse(cleanJson);
                  } catch (parseErr) {
                     console.error(`❌ Failed to parse translated specs JSON for Product ${product.id}:`, parseErr.message);
                     translatedSpecs = extractedSpecs;
                  }
                  
                  // Validate translation - check if it contains Arabic
                  const translatedText = JSON.stringify(translatedSpecs);
                  const hasArabic = /[\u0600-\u06FF]/.test(translatedText);
                  
                  if (hasArabic) {
                    console.log(`✅ Translated specs for Product ${product.id}:`, JSON.stringify(translatedSpecs));
                    await updateSpecsValue(JSON.stringify(translatedSpecs), `update specs ${product.id}`);
                  } else {
                    console.warn(`⚠️ Translation for Product ${product.id} does not contain Arabic. Saving raw specs.`);
                    await updateSpecsValue(rawSpecsText, `update specs raw ${product.id}`);
                  }
                } else {
                    console.warn(`⚠️ Translation returned empty for Product ${product.id}. Saving raw specs.`);
                    await updateSpecsValue(rawSpecsText, `update specs raw ${product.id}`);
                }
              } catch (err) {
                const isTimeout = String(err?.message || '').includes('timeout') || String(err?.message || '').includes('timed out');
                console.error(`❌ Failed to translate specs for Product ${product.id}:`, err.message);
                // Don't try to save raw specs on timeout to avoid further delays - just skip specs for this product
                if (!isTimeout) {
                  try {
                    await updateSpecsValue(rawSpecsText, `update specs fallback ${product.id}`);
                  } catch (specFallbackErr) {
                    console.error(`❌ Failed to save fallback specs for Product ${product.id}: ${toErrorText(specFallbackErr)}`);
                  }
                } else {
                  console.warn(`⚠️ Spec translation timed out for Product ${product.id}. Skipping specs save to avoid blocking.`);
                }
              }
            } else {
              console.warn(`⚠️ SILICONFLOW_API_KEY missing. Saving raw specs for Product ${product.id}.`);
              await updateSpecsValue(rawSpecsText, `update specs raw ${product.id}`);
            }
          }

          // Extract prices from description
          if (rawDetailDescription) {
            console.log(`[Price Extraction] Checking description for prices...`);
            try {
              const priceData = await extractPricesWithFallback(rawDetailDescription);
              if (priceData && priceData.lowestPriceCny) {
                const newPriceIQD = convertCnyToIqdWithProfit(priceData.lowestPriceCny);
                console.log(`[Price Extraction] Found price: ¥${priceData.lowestPriceCny} -> ${newPriceIQD} IQD`);
                
                // Update product price
                await withRetry(
                  () => prisma.$executeRaw`
                    UPDATE "Product"
                    SET "price" = ${newPriceIQD},
                        "generated_options" = ${JSON.stringify(priceData.priceVariants)}::jsonb,
                        "updatedAt" = NOW()
                    WHERE "id" = ${product.id}
                  `,
                  `update price ${product.id}`,
                  specsMutationRetryCount,
                  specsMutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`✓ Updated price for Product ${product.id}: ${newPriceIQD} IQD`);
              } else {
                console.log(`[Price Extraction] No prices found in description`);
              }
            } catch (priceErr) {
              console.error(`[Price Extraction] Failed to extract prices for Product ${product.id}:`, priceErr.message);
            }
          }
          }
        }

        let mainImage = null;
        if (product.imagesChecked) {
          console.log(`ℹ️ Images already checked for Product ${product.id}. Skipping extraction.`);
        } else {
          console.log('Checking for images...');
          
          // Wait for the image container to appear, using a more generic selector for the item body
          await page.waitForSelector('.item-main-window-list--od7DK4Fm, img.fadeInImg--DnykYtf4, .item-body--P2hJb44_, .item-main--N18QxQe1, img[src*="alicdn.com"]', { timeout: 5000 }).catch(() => {});

          const images = await page.evaluate(() => {
            const MAX_GALLERY_IMAGES = 8;
            const CANDIDATE_ATTRS = [
              'src',
              'data-src',
              'data-lazy-src',
              'data-ks-lazyload',
              'data-original',
              'data-url',
              'data-imgurl',
            ];
            const BAD_HINTS = ['avatar', 'icon', 'sprite', 'logo', 'gif'];
            const SIZE_HINT_RE = /_\d+x\d+.*$/;
            const SMALL_HINT_RE = /(?:^|[_-])(40|48|50|60|72|80|96|100|120|160|180)x\1(?:[_-]|$)/i;

            const normalize = (value) => {
              if (!value) return '';
              let url = String(value).trim();
              if (!url) return '';
              url = url.replace(/^[`'"]+|[`'"]+$/g, '');
              if (url.startsWith('//')) url = `https:${url}`;
              if (!/^https?:\/\//i.test(url)) return '';
              url = url.replace(/[)\]}",:;`]+$/g, '');
              url = url.replace(/[#?].*$/, '').replace(SIZE_HINT_RE, '').replace(/\.webp$/i, '');
              return url;
            };

            const looksLikeProductImage = (url) => {
              const lower = String(url || '').toLowerCase();
              if (!lower.includes('alicdn.com')) return false;
              if (SMALL_HINT_RE.test(lower)) return false;
              return !BAD_HINTS.some((hint) => lower.includes(hint));
            };

            const candidates = new Map();
            const pushUrl = (url, score = 0) => {
              const normalized = normalize(url);
              if (!normalized) return;
              if (!looksLikeProductImage(normalized)) return;
              const prev = candidates.get(normalized);
              if (!prev || score > prev.score) {
                candidates.set(normalized, { url: normalized, score });
              }
            };

            const pushFromNode = (img) => {
              if (!img) return;
              const rect = img.getBoundingClientRect();
              const width = Number(img.naturalWidth || img.width || 0);
              const height = Number(img.naturalHeight || img.height || 0);
              const nearTop = rect.top > -250 && rect.top < window.innerHeight * 1.8;
              const visibleEnough = rect.width >= 80 && rect.height >= 80;
              const largeEnough = width === 0 || height === 0 || (width >= 140 && height >= 140);
              if (!largeEnough || !visibleEnough) return;
              const areaScore = Math.max(0, width * height);
              const positionBonus = nearTop ? 120000 : 0;
              const score = areaScore + positionBonus;
              for (const attr of CANDIDATE_ATTRS) {
                pushUrl(img.getAttribute(attr), score);
              }
              const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
              if (srcset) {
                for (const part of srcset.split(',')) {
                  const srcsetUrl = part.trim().split(/\s+/)[0];
                  pushUrl(srcsetUrl, score - 1000);
                }
              }
            };

            // 1) Prefer explicit gallery containers.
            const galleryNodes = Array.from(document.querySelectorAll(
              '.item-main-window-list--od7DK4Fm img, [class*="item-main-window--"] img, img[class*="fadeInImg"], img[class*="detailPic"]'
            ));
            for (const img of galleryNodes) {
              pushFromNode(img);
            }

            // 2) Fallback to main product section only.
            if (candidates.size === 0) {
              const mainSectionNodes = Array.from(document.querySelectorAll(
                '.item-main--N18QxQe1 img, .item-body--P2hJb44_ img, [class*="item-main--"] img'
              ));
              for (const img of mainSectionNodes) {
                pushFromNode(img);
              }
            }

            // 3) Last DOM fallback: only top-fold visible images (avoids recommendation/gallery pollution).
            if (candidates.size === 0) {
              const topFoldNodes = Array.from(document.querySelectorAll('img'));
              for (const img of topFoldNodes) {
                const rect = img.getBoundingClientRect();
                const width = Number(img.naturalWidth || img.width || 0);
                const height = Number(img.naturalHeight || img.height || 0);
                const nearTop = rect.top > -200 && rect.top < window.innerHeight * 1.8;
                const bigEnough = width >= 120 && height >= 120;
                if (!nearTop || !bigEnough) continue;
                pushFromNode(img);
              }
            }

            // 4) Script JSON fallback only when no DOM image found.
            if (candidates.size === 0) {
              const scriptTexts = Array.from(document.querySelectorAll('script'))
                .map((s) => s.textContent || '')
                .filter(Boolean);
              const regex = /https?:\/\/[^"'\s]+alicdn\.com[^"'\s]+/g;
              for (const text of scriptTexts) {
                const matches = text.match(regex) || [];
                for (const matched of matches) {
                  pushUrl(matched, 1);
                }
              }
            }

            return Array.from(candidates.values())
              .sort((a, b) => b.score - a.score)
              .map((item) => item.url)
              .slice(0, MAX_GALLERY_IMAGES);
          });

          if (images.length > 0) {
            const cleanImages = Array.from(new Set(images.map(url => {
              let clean = url;
              if (clean.startsWith('//')) clean = 'https:' + clean;
              return clean
                .replace(/^[`'"]+|[`'"]+$/g, '')
                .replace(/[)\]}",:;`]+$/g, '')
                .replace(/[#?].*$/, '')
                .replace(/_\d+x\d+.*$/, '')
                .replace(/\.webp$/i, '');
            }))).slice(0, 8);

            mainImage = cleanImages[0];

            console.log(`Found ${cleanImages.length} images. Updating database...`);
            
            // Skip products without images entirely
            if (cleanImages.length === 0) {
              console.warn(`⚠️ Product ${product.id} has no images. Skipping and deleting...`);
              try {
                await prisma.product.delete({
                  where: { id: product.id }
                });
                console.log(`✓ Deleted Product ${product.id} (no images)`);
              } catch (deleteErr) {
                console.warn(`⚠️ Failed to delete Product ${product.id}: ${toErrorText(deleteErr)}`);
              }
              return; // Skip the rest of processing for this product
            }
            
            if (isDbCircuitOpen()) {
              const remaining = Math.max(1, Math.ceil((dbCircuitOpenUntil - Date.now()) / 1000));
              console.warn(`[DB Circuit] Skipping image DB update for Product ${product.id} (${remaining}s left).`);
            } else {
              try {
                await withRetry(
                  () => prisma.product.update({
                    where: { id: product.id },
                    data: {
                      image: mainImage,
                      imagesChecked: true
                    }
                  }),
                  `update image base ${product.id}`,
                  imageMutationRetryCount,
                  imageMutationTimeoutMs,
                  retryBackoffMs
                );
                await withRetry(
                  () => prisma.productImage.deleteMany({
                    where: { productId: product.id }
                  }),
                  `delete images ${product.id}`,
                  imageMutationRetryCount,
                  imageMutationTimeoutMs,
                  retryBackoffMs
                );
                if (cleanImages.length > 0) {
                  await withRetry(
                    () => prisma.productImage.createMany({
                      data: cleanImages.map((url, index) => ({
                        productId: product.id,
                        url: url,
                        order: index,
                        type: 'GALLERY'
                      }))
                    }),
                    `create images ${product.id}`,
                    imageMutationRetryCount,
                    imageMutationTimeoutMs,
                    retryBackoffMs
                  );
                }
                console.log(`Images updated for Product ${product.id}`);
              } catch (imageDbErr) {
                console.warn(`Image DB update deferred for Product ${product.id}: ${toErrorText(imageDbErr)}`);
                if (isRetryableDbError(imageDbErr)) triggerDbReconnectNonBlocking(`image update ${product.id}`);
              }
            }
          } else {
            console.log('No images found with the specified selector.');
            if (isDbCircuitOpen()) {
              const remaining = Math.max(1, Math.ceil((dbCircuitOpenUntil - Date.now()) / 1000));
              console.warn(`[DB Circuit] Skipping imagesChecked update for Product ${product.id} (${remaining}s left).`);
            } else {
              try {
                await withRetry(
                  () => prisma.product.update({
                    where: { id: product.id },
                    data: { imagesChecked: true }
                  }),
                  `mark imagesChecked ${product.id}`,
                  imageMutationRetryCount,
                  imageMutationTimeoutMs,
                  retryBackoffMs
                );
                console.log(`Marked Product ${product.id} as checked (no images found).`);
              } catch (markErr) {
                console.warn(`imagesChecked update deferred for Product ${product.id}: ${toErrorText(markErr)}`);
                if (isRetryableDbError(markErr)) triggerDbReconnectNonBlocking(`imagesChecked ${product.id}`);
              }
            }
          }
        }

        const imageToEmbed = mainImage || product.image;
        if (imageToEmbed && !GOOFISH_DISABLE_IMAGE_EMBEDDINGS) {
          console.log(`[Pipeline] Generating embedding for Product ${product.id}...`);
          try {
            const embeddingResult = await withTimeout(
              () => ensureProductImageEmbeddings({
                prisma,
                productId: product.id,
                productName: GOOFISH_EMBED_USE_PRODUCT_NAME ? (product.name || null) : null,
                fallbackImageUrl: imageToEmbed,
                runDb: (operation, label) => withRetry(
                  operation,
                  label,
                  embeddingMutationRetryCount,
                  embeddingMutationTimeoutMs,
                  retryBackoffMs
                ),
                logger: console,
              }),
              `embedding step ${product.id}`,
              GOOFISH_EMBEDDING_STEP_TIMEOUT_MS
            );
            if (embeddingResult.embeddedCount > 0) {
              console.log(`✅ Saved ${embeddingResult.embeddedCount} image embeddings for Product ${product.id}`);
            } else {
              console.warn(`⚠️ Failed to generate image embeddings for Product ${product.id}`);
            }
          } catch (embedErr) {
            console.error(`❌ Embedding error for Product ${product.id}: ${embedErr.message}`);
          }
        } else if (imageToEmbed && GOOFISH_DISABLE_IMAGE_EMBEDDINGS) {
          console.log(`[Pipeline] Skipping image embeddings for Product ${product.id} (disabled by config)`);
        } else {
          console.log(`ℹ️ No image available to embed for Product ${product.id}`);
        }
      }
    }, `process product ${product.id}`, productTimeoutMs);

  } catch (error) {
    console.error(`Error processing Product ${product.id}:`, error.message);
  }
}

async function run() {
  console.log("Starting goofish-pipeline run()...");
  
  // Initialize queue directory if queue mode is enabled
  if (USE_QUEUE_MODE) {
    await initQueueDir();
  }
  
  // Load category data for automatic category assignment
  if (CATEGORY_ASSIGN_ENABLED) {
    loadCategoryData();
    console.log('[Category] Category assignment enabled');
  } else {
    console.log('[Category] Category assignment disabled via GOOFISH_CATEGORY_ASSIGN env var');
  }
  
  // Load custom search terms if available
  customTerms = loadCustomTerms();
  if (customTerms) {
    console.log('[Custom Terms] Using provided custom search terms instead of AI generation');
  }
  
  const browser = await createBrowser();
  console.log(`Browser launched in ${GOOFISH_HEADLESS ? 'hidden/headless' : 'visible'} mode.`);
  
  // Login wait - wait for user to manually log in / solve CAPTCHA before starting
  // Disabled - auto-start
  // if (!GOOFISH_HEADLESS) {
  //   const pages = await browser.pages();
  //   let page = pages[0];
  //   if (!page) page = await browser.newPage();
  //
  //   await page.goto('https://www.goofish.com/', { waitUntil: 'networkidle2', timeout: 60000 });
  //
  //   const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  //   await page.setUserAgent(ua);
  //
  //   console.log('\n========================================');
  //   console.log('  LOGIN / CAPTCHA WAIT');
  //   console.log('========================================');
  //   console.log('Browser is visible. Please log in to Goofish/Xianyu or solve the CAPTCHA if present.');
  //   console.log('Press Enter when you are ready to start the pipeline...');
  //   await ask('');
  //   console.log('Starting pipeline...\n');
  // }
  
  markPipelineProgress('run-start');
  startPipelineProgressWatchdog();
  const translationCache = loadTranslationCache();
  let pendingCacheWrites = 0;
  if (GOOFISH_RESET_TERMS_ON_START) {
    resetRunProgressKeepTermMemory();
    clearBatchLinksQueue();
  }
  if (SILICONFLOW_API_KEY) {
    console.log('AI translation is enabled (using env key).');
  } else {
    console.warn('AI translation is disabled: missing SILICONFLOW_API_KEY.');
  }
  // Ensure we use the incognito context (usually the first one for --incognito launch)
  // or explicitly create incognito context if browser isn't already one.
  // With --incognito arg, browser.newPage() typically opens incognito tab.
  // But to be safe, let's close existing blank tabs and ensure one target page.
  
  const pages = await browser.pages();
  let page = pages[0];
  if (!page) page = await browser.newPage();
  
  // Randomize Viewport slightly
  const width = 1920 + Math.floor(Math.random() * 100) - 50;
  const height = 1080 + Math.floor(Math.random() * 100) - 50;
  await page.setViewport({ width, height });

  // Rotate User Agent
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);
  console.log(`Using User-Agent: ${ua}`);

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1'
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    window.chrome = { runtime: {} };
  });

  // Cookie management
  const cookiesPath = path.join(__dirname, 'goofish-cookies.json');
  try {
    if (fs.existsSync(cookiesPath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath));
      await page.setCookie(...cookies);
      console.log('Restored cookies from goofish-cookies.json');
    }
  } catch (e) {
    console.error('Failed to load cookies:', e.message);
  }

  try {
    console.log('Opening Goofish...');
    const entryUrls = String(process.env.GOOFISH_ENTRY_URLS || 'https://www.goofish.com/,https://2.taobao.com/')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    let opened = false;
    let openError = null;
    for (const entryUrl of entryUrls) {
      for (let attempt = 1; attempt <= 3 && !opened; attempt += 1) {
        try {
          markPipelineProgress(`open-entry ${entryUrl}`);
          await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
          opened = true;
          markPipelineProgress(`opened-entry ${entryUrl}`);
        } catch (error) {
          openError = error;
          const errorText = toErrorText(error);
          const errorCode = toErrorCode(error);
          console.warn(`Failed to open ${entryUrl} (attempt ${attempt}/3): ${errorText}${errorCode ? ` [${errorCode}]` : ''}`);
          if (attempt < 3) {
            await humanDelay(2000, 5000);
          }
        }
      }
      if (opened) break;
    }
    if (!opened) {
      throw openError || new Error('Failed to open Goofish');
    }

    // Handle login popup closer immediately if present
    try {
      const closeBtnSelector = '.closeIconBg--cubvOqVh, img.closeIcon--gwB7wNKs, .closeIcon--gwB7wNKs';
      const closeBtn = await page.$(closeBtnSelector);
      if (closeBtn) {
        console.log('Found login popup closer. Clicking...');
        await closeBtn.click();
        await humanDelay(1000, 2000);
      }
    } catch (e) {
      // Ignore if not found
    }

    // Save cookies after potential login
    try {
      const cookies = await page.cookies();
      fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
      console.log('Saved cookies to goofish-cookies.json');
    } catch (e) {
      console.error('Failed to save cookies:', e.message);
    }

    const ensureItemsLoaded = async (term) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await page.evaluate(() => {
          const cards = document.querySelectorAll('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]');
          const cardCount = cards ? cards.length : 0;
          const emptyEl = document.querySelector('div[class*="empty-text-notfound--"]');
          const emptyText = (emptyEl?.textContent || '').trim();
          const isExplicitEmpty = /no items|没有.*商品|暂无|没有找到|没有内容/i.test(emptyText);
          return { cardCount, emptyText, isExplicitEmpty };
        });
        if (state.cardCount > 0) return true;
        if (state.isExplicitEmpty) {
          console.log(`Empty state detected: ${state.emptyText}`);
        }
        if (attempt === 0) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
          await humanDelay(3000, 5000);
          continue;
        }
        if (attempt === 1 && term) {
          await openHomeAndSearch(page, term);
          continue;
        }
      }
      return false;
    };
    const goToNextSearchPage = async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await humanDelay(1000, 2000);
      const firstBefore = await page.evaluate(() => {
        const container = document.querySelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"]');
        if (!container) return '';
        const t = container.querySelector('div[class*="row1-wrap-title--"]');
        return t?.getAttribute('title') || t?.textContent || '';
      });
      const nextBtn = await page.evaluateHandle(() => {
        const arrows = Array.from(document.querySelectorAll('.search-pagination-arrow-right--CKU78u4z'));
        if (arrows.length === 0) return null;
        return arrows[0].closest('button');
      });
      if (!nextBtn || await nextBtn.evaluate(node => node.disabled)) return false;
      try {
        await nextBtn.hover();
        await humanDelay(200, 500);
        await nextBtn.click();
      } catch (err) {
        await page.evaluate(btn => btn.click(), nextBtn);
      }
      await humanDelay(3500, 5500);
      const firstAfter = await page.evaluate(() => {
        const container = document.querySelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"]');
        if (!container) return '';
        const t = container.querySelector('div[class*="row1-wrap-title--"]');
        return t?.getAttribute('title') || t?.textContent || '';
      });
      return (firstAfter && firstAfter.trim() && firstAfter.trim() !== String(firstBefore || '').trim());
    };

    const configuredMaxPages = parseInt(process.env.GOOFISH_MAX_PAGES || '5', 10);
    const estimatedItemsPerPage = Math.max(1, parseInt(process.env.GOOFISH_ESTIMATED_ITEMS_PER_PAGE || '30', 10) || 30);
    const requiredPagesForTermTarget = Math.max(1, Math.ceil(GOOFISH_LINKS_PER_TERM / estimatedItemsPerPage));
    const MAX_PAGES = Number.isFinite(configuredMaxPages) && configuredMaxPages > 0
      ? Math.max(configuredMaxPages, requiredPagesForTermTarget)
      : requiredPagesForTermTarget;
    console.log(`Items per search target: ${ITEMS_PER_SEARCH}. Max pages per term: ${MAX_PAGES}.`);
    let allItems = [];
    const extractItems = async () => {
      return await page.evaluate(() => {
        const toAbs = (src) => (src && src.startsWith('//') ? ('https:' + src) : (src || ''));
        const container = document.querySelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"]');
        if (!container) return [];
        const cards = Array.from(container.querySelectorAll('a[class*="feeds-item-wrap--"]'));
        const out = [];
        for (const card of cards) {
          const imgEl = card.querySelector('img[class*="feeds-image--"]');
          const titleWrap = card.querySelector('div[class*="row1-wrap-title--"]');
          const mainTitle = titleWrap?.getAttribute('title') || titleWrap?.innerText || '';
          const conditionText = Array.from(card.querySelectorAll('div[class*="row2-wrap-cpv--"] span[class*="cpv--"]'))
            .map((el) => (el?.textContent || '').trim())
            .filter(Boolean)
            .join(' ');
          const priceWrap = card.querySelector('div[class*="row3-wrap-price--"] div[class*="price-wrap--"]');
          const numEl = priceWrap?.querySelector('span[class*="number--"]');
          const decEl = priceWrap?.querySelector('span[class*="decimal--"]');
          let priceText = '';
          if (numEl) {
            priceText = numEl.textContent?.trim() || '';
            if (decEl && decEl.textContent) priceText += decEl.textContent.trim();
          } else if (priceWrap) {
            priceText = priceWrap.textContent?.trim() || '';
          }
          const url = card.getAttribute('href')?.startsWith('http')
            ? card.getAttribute('href')
            : (card.getAttribute('href') ? `https://www.goofish.com${card.getAttribute('href')}` : '');
          out.push({
            title: (mainTitle || '').trim(),
            conditionText: (conditionText || '').trim(),
            priceText: (priceText || '').trim(),
            image: toAbs(imgEl?.getAttribute('src') || ''),
            url,
          });
        }
        return out;
      });
    };
    const processCollectedLink = async (item) => {
      const goofishItemId = extractGoofishItemId(item?.url);
      console.log(`[ProcessCollectedLink] Starting for itemId=${goofishItemId || 'n/a'}`);
      if (!item?.url) {
        console.log(`[ProcessCollectedLink] Returning null - no URL`);
        return null;
      }
      let cny = parseCnyPrice(item.priceText);
      const detectedPrice = detectRealPriceFromTitle(item.title, cny);
      if (detectedPrice !== cny && detectedPrice > 0) cny = detectedPrice;
      const newOrOld = detectNewOrOldFromTexts(item.title, item.conditionText);
      const realBrand = detectRealBrandFromTexts(item.title, item.conditionText);
      // Keep original Chinese title - translation will happen in detail phase
      let titleEn = String(item.title || '').trim();
      let descriptionAr = titleEn;
      let keywords = [];
      const resolvedUrl = item.url || '';
      const resolveDetailTargetFromDbByUrl = async () => {
        try {
          await ensureDbReady();
          if (!dbReady) return null;
          const fromDb = await withTimeout(
            () => prisma.product.findFirst({
              where: { purchaseUrl: resolvedUrl },
              select: {
                id: true,
                name: true,
                purchaseUrl: true,
                image: true,
                imagesChecked: true,
                specs: true
              }
            }),
            `resolve detail by url ${extractGoofishItemId(resolvedUrl) || 'item'}`,
            8000
          );
          if (!fromDb?.id) return null;
          return {
            id: fromDb.id,
            url: fromDb.purchaseUrl || resolvedUrl,
            name: fromDb.name || titleEn || item.title,
            image: fromDb.image || item.image || '',
            imagesChecked: fromDb.imagesChecked || false,
            specs: fromDb.specs || null
          };
        } catch (resolveErr) {
          if (isRetryableDbError(resolveErr)) triggerDbReconnectNonBlocking(`resolve detail ${extractGoofishItemId(resolvedUrl) || 'item'}`);
          return null;
        }
      };
      const existingProduct = await findExistingProductByUrl(resolvedUrl);
      if (existingProduct) {
        titleEn = cleanAiText(String(existingProduct.name || titleEn).trim()) || titleEn;
        descriptionAr = cleanDescriptionText(String(existingProduct?.aiMetadata?.translatedDescription || titleEn).trim()) || titleEn;
        keywords = ensureKeywordList(existingProduct.keywords, titleEn || item.title);
      }
      // Skip AI translation in collection phase - translation will happen in detail phase
      // const translationDecision = shouldTranslateFromExistingProduct(existingProduct);
      // if (SILICONFLOW_API_KEY && translationDecision.shouldTranslate) {
      //   const cachedTranslation = getCachedTranslation(translationCache, item.title);
      //   const canUseCachedDescription = cachedTranslation
      //     && cachedTranslation.descriptionAr
      //     && cachedTranslation.descriptionAr.length >= 24
      //     && cachedTranslation.descriptionAr !== cachedTranslation.titleAr
      //     && hasArabic(cachedTranslation.descriptionAr);
      //   if (canUseCachedDescription) {
      //     titleEn = cachedTranslation.titleAr;
      //     descriptionAr = cachedTranslation.descriptionAr;
      //     keywords = cachedTranslation.keywords;
      //   } else {
      //     console.log(`[ProcessCollectedLink] Generating title and keywords for itemId=${goofishItemId || 'n/a'}`);
      //     const generated = await generateTitleAndKeywords(item.title);
      //     console.log(`[ProcessCollectedLink] Generated: translationSucceeded=${generated.translationSucceeded} titleAr=${generated.titleAr?.substring(0, 30)}... descriptionAr=${generated.descriptionAr?.substring(0, 30)}...`);
      //     if (GOOFISH_SKIP_ON_TRANSLATION_FAILURE && !generated.translationSucceeded) {
      //       console.log(`[ProcessCollectedLink] Translation failed, but continuing with generated content anyway`);
      //       titleEn = generated.titleAr || titleEn;
      //       descriptionAr = generated.descriptionAr || descriptionAr;
      //       keywords = generated.keywords || keywords;
      //     } else {
      //       titleEn = generated.titleAr;
      //       descriptionAr = generated.descriptionAr;
      //       keywords = generated.keywords;
      //     }
      //     if (generated.translationSucceeded) {
      //       setCachedTranslation(translationCache, item.title, generated);
      //       pendingCacheWrites += 1;
      //       if (pendingCacheWrites >= GOOFISH_TRANSLATION_CACHE_FLUSH_EVERY) {
      //         saveTranslationCache(translationCache);
      //         pendingCacheWrites = 0;
      //       }
      //     }
      //   }
      // }
      // titleEn = sanitizeTranslationText(titleEn);
      // descriptionAr = cleanDescriptionText(descriptionAr);
      // if (GOOFISH_ENABLE_TRANSLATION_RETRY && SILICONFLOW_API_KEY && (!descriptionAr || descriptionAr === item.title || isChineseTerm(descriptionAr))) {
      //   if (isChineseTerm(titleEn)) titleEn = await translateFullTitleToArabic(item.title, item.title);
      //   descriptionAr = cleanDescriptionText(await translateFullTitleToArabic(item.title, item.title));
      // }
      const itemData = {
        title: item.title || '',
        titleEn: titleEn || '',
        descriptionAr: descriptionAr || '',
        keywords,
        newOrOld,
        realBrand,
        priceCny: cny,
        image: item.image || '',
        url: resolvedUrl,
      };
      if (OUTPUT_JSON) allItems.push(itemData);
      
      // Skip DB insert if batch insert mode or accumulate per product mode is enabled
      if (BATCH_INSERT_FROM_JSON || GOOFISH_ACCUMULATE_PER_PRODUCT) {
        const mode = BATCH_INSERT_FROM_JSON ? 'Batch Mode' : 'Accumulate Mode';
        console.log(`[${mode}] Skipping DB insert for ${goofishItemId || 'n/a'} - will insert later`);
        return {
          id: null,
          url: resolvedUrl,
          name: titleEn || item.title,
          image: item.image || '',
          imagesChecked: existingProduct?.imagesChecked || false,
          specs: existingProduct?.specs || null
        };
      }
      
      if (DISABLE_DB_WRITE) {
        console.log(`[DB Write Disabled] Skipping DB save for ${goofishItemId || 'n/a'}`);
        return {
          id: existingProduct?.id || null,
          url: resolvedUrl,
          name: titleEn || item.title,
          image: item.image || '',
          imagesChecked: existingProduct?.imagesChecked || false,
          specs: existingProduct?.specs || null
        };
      }
      
      if (isDbCircuitOpen()) {
        const recovered = await waitForDbCircuitRecovery();
        if (recovered) {
          await ensureDbReady();
        }
      }
      if (isDbCircuitOpen()) {
        if (!existingProduct?.id) {
          throw makePipelineRestartError(`db circuit open before save ${goofishItemId || 'n/a'}`);
        }
        return {
          id: existingProduct.id,
          url: resolvedUrl,
          name: titleEn || item.title,
          image: existingProduct?.image || item.image || '',
          imagesChecked: existingProduct?.imagesChecked || false,
          specs: existingProduct?.specs || null
        };
      }
      let dbId = null;
      try {
        console.log(`[Process] Saving product to DB: ${goofishItemId || 'n/a'}`);
        dbId = await withRetry(
          () => saveProductToDb(itemData, existingProduct?.id || null),
          `save product ${item.title?.slice(0, 20) || 'item'}`,
          GOOFISH_DB_SAVE_RETRIES,
          GOOFISH_DB_SAVE_TIMEOUT_MS,
          GOOFISH_DB_SAVE_BACKOFF_MS
        );
        console.log(`[Process] Saved product to DB: dbId=${dbId} itemId=${goofishItemId || 'n/a'}`);
      } catch (saveErr) {
        console.error(`[Process] DB save error for itemId=${goofishItemId || 'n/a'}: ${toErrorText(saveErr)}`);
        if (GOOFISH_DB_SAVE_FATAL_ON_RETRY_EXHAUST && isRetryableDbError(saveErr)) {
          console.error(`[DB Save] Retry exhausted itemId=${goofishItemId || 'n/a'} url=${resolvedUrl} sourceTitle=${cleanAiText(String(item.title || '').slice(0, 50))} error=${toErrorText(saveErr)}`);
          const now = Date.now();
          const reconnectCooldownLeft = Math.max(0, GOOFISH_DB_FORCE_RECONNECT_MIN_INTERVAL_MS - (now - dbLastForceReconnectAt));
          if (isDbCircuitOpen()) {
            console.warn(`[DB Reconnect] Skipped force reconnect because DB circuit is open (${Math.max(1, Math.ceil((dbCircuitOpenUntil - now) / 1000))}s left).`);
          } else if (reconnectCooldownLeft > 0) {
            console.warn(`[DB Reconnect] Skipped force reconnect due to cooldown (${Math.ceil(reconnectCooldownLeft / 1000)}s left).`);
          } else {
            dbLastForceReconnectAt = now;
            try {
              await forceDbReconnectFromScratch(`save product ${item.title?.slice(0, 20) || 'item'}`);
            } catch (reconnectErr) {
              console.warn(`[DB Reconnect] Failed after save timeout: ${toErrorText(reconnectErr)}`);
            }
          }
        }
        if (existingProduct?.id) {
          return {
            id: existingProduct.id,
            url: resolvedUrl,
            name: titleEn || item.title,
            image: existingProduct?.image || item.image || '',
            imagesChecked: existingProduct?.imagesChecked || false,
            specs: existingProduct?.specs || null
          };
        }
        const recoveredTarget = await resolveDetailTargetFromDbByUrl();
        if (recoveredTarget) return recoveredTarget;
        console.warn(`[Process] Skipping item ${goofishItemId || 'n/a'} - database save failed after recovery attempt`);
        return null;
      }
      if (!dbId) {
        const recoveredTarget = await resolveDetailTargetFromDbByUrl();
        if (recoveredTarget) return recoveredTarget;
        console.warn(`[Process] Skipping item ${goofishItemId || 'n/a'} - database save failed and could not recover`);
        return null;
      }
      return {
        id: dbId,
        url: resolvedUrl,
        name: titleEn || item.title,
        image: item.image || '',
        imagesChecked: existingProduct?.imagesChecked || false,
        specs: existingProduct?.specs || null
      };
    };
    let cycleIndex = 0;
    while (true) {
      markPipelineProgress('cycle-start');
      cycleIndex += 1;
      let processedCount = 0;
      allItems = [];
      
      // Skip collection phase if flag is set, go directly to batch insert
      if (SKIP_COLLECT_ONLY_BATCH_INSERT) {
        console.log(`[Pipeline] SKIP_COLLECT flag is set, skipping collection phase and running batch insert only.`);
        if (BATCH_INSERT_FROM_JSON && OUTPUT_JSON) {
          await batchInsertDetailsFromJson();
          await batchInsertFromJson();
        } else {
          console.log(`[Pipeline] BATCH_INSERT_FROM_JSON or OUTPUT_JSON is not enabled, nothing to do.`);
        }
        console.log(`[Pipeline] Batch insert completed, exiting.`);
        break;
      }
      
      console.log(`[Pipeline] Starting term cycle ${cycleIndex}...`);
      const { terms: searchTerms, startIndex, batchId, source } = await getSearchTermsForRun();
      const safeStartIndex = Math.max(0, Math.min(searchTerms.length, Number(startIndex || 0) || 0));
      console.log(`Loaded ${searchTerms.length} search terms for this batch.`);
      console.log(`Batch source: ${source}.`);
      console.log(`Starting from term ${Math.min(searchTerms.length, safeStartIndex + 1)}/${searchTerms.length}.`);
      const existingQueue = loadBatchLinksQueue();
      const queueMatchesBatch = existingQueue
        && existingQueue.batchId === batchId
        && Array.isArray(existingQueue.termStates)
        && existingQueue.termStates.length === searchTerms.length;
      const queue = queueMatchesBatch
        ? existingQueue
        : {
            batchId,
            source,
            phase: 'collect',
            nextCollectTerm: safeStartIndex,
            nextProcessTerm: 0,
            termStates: searchTerms.map((term, termIndex) => ({
              term,
              termIndex,
              items: [],
              seenUrls: [],
              collectDone: false,
              processIndex: 0,
              updatedAt: null
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
      if (queue.phase === 'collect') {
        const termIndex = queue.nextCollectTerm;
        if (termIndex < searchTerms.length) {
          const term = searchTerms[termIndex];
          const state = queue.termStates[termIndex] || { term, termIndex, items: [], seenUrls: [], collectDone: false, processIndex: 0 };
          const seenUrls = new Set(Array.isArray(state.seenUrls) ? state.seenUrls : []);
          let termCollected = Array.isArray(state.items) ? state.items.length : 0;
          console.log(`[TermDebug] phase=collect batchId=${batchId} termIndex=${termIndex + 1}/${searchTerms.length} term="${term}"`);
          console.log(`[Collect] ${term} (${termCollected}/${GOOFISH_LINKS_PER_TERM})`);
          await openHomeAndSearch(page, term);
          const ok = await ensureItemsLoaded(term);
          if (ok) {
            let pageIndex = 0;
            while (pageIndex < MAX_PAGES && termCollected < GOOFISH_LINKS_PER_TERM) {
              markPipelineProgress(`collect ${term} page ${pageIndex + 1}`);
              pageIndex += 1;
              await closeLoginPopup(page);
              await page.waitForSelector('#content div[class^="search-container--"] div[class^="feeds-list-container--"] a[class*="feeds-item-wrap--"]', { timeout: 30000 });
              await humanDelay(1600, 2600);
              const items = await extractItems();
              console.log(`[Collect][${term}] Page ${pageIndex} -> ${items.length} raw items`);
              for (const it of items) {
                if (termCollected >= GOOFISH_LINKS_PER_TERM) break;
                const url = String(it?.url || '').trim();
                if (!url || seenUrls.has(url)) continue;
                if (isExcludedProduct(it.title)) continue;
                seenUrls.add(url);
                state.items = Array.isArray(state.items) ? state.items : [];
                state.items.push({
                  url,
                  title: String(it.title || '').trim(),
                  conditionText: String(it.conditionText || '').trim(),
                  priceText: String(it.priceText || '').trim(),
                  image: String(it.image || '').trim()
                });
                termCollected += 1;
                markPipelineProgress(`collect-hit ${term}`);
                console.log(`[Collect][${term}] ${termCollected}/${GOOFISH_LINKS_PER_TERM}`);
              }
              state.seenUrls = Array.from(seenUrls).slice(-Math.max(300, GOOFISH_LINKS_PER_TERM * 3));
              queue.termStates[termIndex] = state;
              queue.nextCollectTerm = termIndex;
              queue.updatedAt = new Date().toISOString();
              saveBatchLinksQueue(queue);
              updateActiveBatchTermCheckpoint(batchId, termIndex, termCollected, state.seenUrls, { collectPageIndex: pageIndex });
              if (termCollected >= GOOFISH_LINKS_PER_TERM) break;
              const changed = await goToNextSearchPage();
              if (!changed) break;
            }
          }
          state.collectDone = true;
          state.updatedAt = new Date().toISOString();
          queue.termStates[termIndex] = state;
          queue.nextCollectTerm = termIndex + 1;
          queue.updatedAt = new Date().toISOString();
          saveBatchLinksQueue(queue);
          updateActiveBatchProgress(batchId, termIndex + 1);
          queue.phase = 'process';
          queue.nextProcessTerm = termIndex;
          queue.updatedAt = new Date().toISOString();
          saveBatchLinksQueue(queue);
        } else {
          queue.phase = 'process';
          queue.nextProcessTerm = 0;
          queue.updatedAt = new Date().toISOString();
          saveBatchLinksQueue(queue);
        }
      }
      let reachedProcessLimit = false;
      if (queue.phase === 'process') {
        const termIndex = queue.nextProcessTerm;
        if (termIndex < searchTerms.length) {
          await ensureDbReady();
          console.log("DB ready.");
          // Clear detail JSON at start of each term if batch mode is enabled
          if (BATCH_INSERT_FROM_JSON) {
            const detailDataPath = path.join(process.cwd(), 'goofish-detail-results.json');
            try {
              fs.writeFileSync(detailDataPath, '[]');
              console.log(`[JSON] Cleared detail JSON file at start of term processing`);
            } catch (err) {
              console.warn(`[JSON] Failed to clear detail JSON: ${err.message}`);
            }
          }
          const state = queue.termStates[termIndex];
          if (state) {
            const term = state.term || searchTerms[termIndex];
            const termPosition = `${termIndex + 1}/${searchTerms.length}`;
            state.items = Array.isArray(state.items) ? state.items : [];
            const processedBeforeTerm = Math.max(0, Number(state.processIndex || 0));
            const totalKnownForTerm = Math.max(state.items.length + processedBeforeTerm, processedBeforeTerm);
            console.log(`[TermDebug] phase=process batchId=${batchId} termIndex=${termIndex + 1}/${searchTerms.length} term="${term}"`);
            console.log(`[Process] ${term}: ${processedBeforeTerm}/${totalKnownForTerm}`);
            while (state.items.length > 0) {
              markPipelineProgress(`process-start ${term}`);
              if (processedCount >= MAX_PRODUCTS_TO_PROCESS) {
                reachedProcessLimit = true;
                break;
              }
              const currentItem = state.items[0];
              const currentProgress = Math.max(0, Number(state.processIndex || 0)) + 1;
              const currentTotalForTerm = Math.max(state.items.length + Math.max(0, Number(state.processIndex || 0)), currentProgress);
              const currentItemId = extractGoofishItemId(currentItem?.url);
              const sourceTitle = cleanAiText(String(currentItem?.title || '').slice(0, 80));
              console.log(`[ProcessItem] termIndex=${termPosition} term="${term}" progress=${currentProgress}/${currentTotalForTerm} itemId=${currentItemId || 'n/a'} url=${currentItem?.url || ''}`);
              if (sourceTitle) {
                console.log(`[ProcessItem] sourceTitle=${sourceTitle}`);
              }
              try {
                markPipelineProgress(`process-link ${currentItemId || 'n/a'}`);
                const detailTarget = await withTimeout(
                  () => processCollectedLink(currentItem),
                  `process link ${currentItemId || 'n/a'}`,
                  GOOFISH_PROCESS_LINK_TIMEOUT_MS
                );
                if (detailTarget) {
                  await processProductDetails(page, detailTarget, {
                    current: currentProgress,
                    total: currentTotalForTerm
                  });
                } else {
                  console.warn(`[ProcessItem] detail phase skipped itemId=${currentItemId || 'n/a'} reason=no-db-target - deleting from database if exists`);
                  // Delete product from database if it exists
                  try {
                    await ensureDbReady();
                    if (dbReady) {
                      const goofishItemId = extractGoofishItemId(currentItem?.url);
                      if (goofishItemId) {
                        const deleted = await prisma.product.deleteMany({
                          where: {
                            aiMetadata: {
                              path: ['goofishItemId'],
                              equals: goofishItemId
                            }
                          }
                        });
                        if (deleted.count > 0) {
                          console.log(`[ProcessItem] Deleted ${deleted.count} product(s) from database for itemId=${currentItemId || 'n/a'}`);
                        }
                      }
                    }
                  } catch (deleteErr) {
                    console.warn(`[ProcessItem] Failed to delete product for itemId=${currentItemId || 'n/a'}: ${toErrorText(deleteErr)}`);
                  }
                }
                markPipelineProgress(`process-done ${currentItemId || 'n/a'}`);
              } catch (itemErr) {
                if (shouldRestartPipelineForItemError(itemErr)) {
                  queue.termStates[termIndex] = state;
                  queue.nextProcessTerm = termIndex;
                  queue.updatedAt = new Date().toISOString();
                  saveBatchLinksQueue(queue);
                  console.error(`[Process] Fatal processing failure. Restart required: ${toErrorText(itemErr)}`);
                  throw itemErr;
                }
                console.error(`[Process] Failed processing link, skipping to next: ${toErrorText(itemErr)}`);
              }
              processedCount += 1;
              state.items.shift();
              state.processIndex = Math.max(0, Number(state.processIndex || 0)) + 1;
              state.updatedAt = new Date().toISOString();
              queue.termStates[termIndex] = state;
              queue.nextProcessTerm = termIndex;
              queue.updatedAt = new Date().toISOString();
              saveBatchLinksQueue(queue);
              console.log(`[ProcessItem] completed termIndex=${termPosition} progress=${state.processIndex}/${Math.max(state.items.length + state.processIndex, state.processIndex)} itemId=${currentItemId || 'n/a'}`);
              markPipelineProgress(`item-committed ${currentItemId || 'n/a'}`);
            }
            if (reachedProcessLimit) {
              queue.termStates[termIndex] = state;
              queue.nextProcessTerm = termIndex;
              queue.updatedAt = new Date().toISOString();
              saveBatchLinksQueue(queue);
            } else {
              queue.nextProcessTerm = termIndex + 1;
              queue.phase = 'collect';
              queue.updatedAt = new Date().toISOString();
              saveBatchLinksQueue(queue);
            }
          }
        }
      }
      if (!reachedProcessLimit && queue.phase === 'process') {
        clearBatchLinksQueue();
        clearActiveBatch(batchId);
        if (pendingCacheWrites > 0) {
          saveTranslationCache(translationCache);
          pendingCacheWrites = 0;
        }
      }
      if (OUTPUT_JSON) {
        const outputPath = path.join(process.cwd(), 'goofish-results.json');
        fs.writeFileSync(outputPath, JSON.stringify(allItems, null, 2));
        console.log(`Cycle ${cycleIndex} saved ${allItems.length} items to ${outputPath}`);
      } else {
        console.log(`Cycle ${cycleIndex} finished in database mode.`);
      }
      
      // Batch insert from JSON if enabled
      if (BATCH_INSERT_FROM_JSON && OUTPUT_JSON) {
        await batchInsertDetailsFromJson();
        await batchInsertFromJson();
      }
      
      if (pendingCacheWrites > 0) {
        saveTranslationCache(translationCache);
        pendingCacheWrites = 0;
      }
      if (reachedProcessLimit) {
        console.log(`[Pipeline] Hit MAX_PRODUCTS_TO_PROCESS=${MAX_PRODUCTS_TO_PROCESS}. Continuing with current batch progress.`);
      } else {
        console.log('[Pipeline] Batch completed. Generating a fresh term batch and continuing...');
      }
      await humanDelay(1000, 2500);
      markPipelineProgress('cycle-sleep-done');
    }
    if (pendingCacheWrites > 0) {
      saveTranslationCache(translationCache);
      pendingCacheWrites = 0;
    }
  } catch (e) {
    console.error('Scraper error:', e);
    process.exit(1);
  } finally {
    stopPipelineProgressWatchdog();
    await browser.close();
  }
}

async function updateExistingGoofishProducts() {
  await ensureDbReady();
  if (UPDATE_RESET_PROGRESS) {
    clearUpdateExistingProgress();
  }
  const resumeProgress = loadUpdateExistingProgress();
  const limit = Number.isFinite(UPDATE_LIMIT) && UPDATE_LIMIT > 0 ? UPDATE_LIMIT : Number.POSITIVE_INFINITY;
  let updatedCount = resumeProgress ? resumeProgress.updatedCount : 0;
  let scanned = resumeProgress ? resumeProgress.scanned : 0;
  let lastId = Math.max(UPDATE_START_ID, resumeProgress ? resumeProgress.lastId : 0);
  let batchIndex = 0;
  const updatedLog = [];
  console.log('Starting Goofish keyword update for existing products...');
  console.log('Update settings:', {
    startId: lastId,
    limit: Number.isFinite(limit) ? limit : 'all',
    batchSize: UPDATE_BATCH_SIZE,
    delayMin: UPDATE_DELAY_MIN,
    delayMax: UPDATE_DELAY_MAX,
    progressEvery: UPDATE_PROGRESS_EVERY,
    forceRegenerate: UPDATE_FORCE_REGENERATE,
    clearKeywordsFirst: UPDATE_CLEAR_KEYWORDS_FIRST,
    printBatchSample: UPDATE_PRINT_BATCH_SAMPLE
  });
  if (resumeProgress) {
    console.log('Resuming update progress:', {
      lastId: resumeProgress.lastId,
      scanned: resumeProgress.scanned,
      updatedCount: resumeProgress.updatedCount,
      updatedAt: resumeProgress.updatedAt
    });
  }

  const safeReconnect = async () => {
    const recovered = await recoverDbConnection('update-existing reconnect', GOOFISH_DB_CONNECT_RETRY_DELAY_MS, 1);
    if (!recovered) {
      throw new Error(`db recovery failed for update-existing reconnect after ${GOOFISH_DB_RECOVER_WAIT_MS}ms`);
    }
  };

  while (scanned < limit) {
    const take = Math.min(UPDATE_BATCH_SIZE, limit - scanned);
    let batchSamplePrinted = false;
    let products = [];
    try {
      console.log(`[UpdateExisting] loading batch ${batchIndex + 1} from id>${lastId} (take=${take})...`);
      products = await withTimeout(
        () => prisma.$queryRaw`
          SELECT id, name, "purchaseUrl", "aiMetadata", "keywords"
          FROM "Product"
          WHERE id > ${lastId}
            AND ("purchaseUrl" ILIKE ${'%goofish.com%'} OR "purchaseUrl" ILIKE ${'%xianyu.com%'})
          ORDER BY id ASC
          LIMIT ${take}
        `,
        `load update batch ${batchIndex + 1}`,
        UPDATE_QUERY_TIMEOUT_MS
      );
    } catch (error) {
      const errMsg = String(error?.message || '');
      if (
        error?.code === 'P1017'
        || error?.code === 'P1001'
        || errMsg.includes('Engine is not yet connected')
        || errMsg.includes('timed out after')
      ) {
        console.warn(`DB/query issue while loading batch ${batchIndex + 1}. Reconnecting...`);
        await safeReconnect();
        continue;
      }
      throw error;
    }
    console.log(`Batch ${batchIndex + 1}: loaded ${products.length} products`);
    if (products.length === 0) break;

    for (const product of products) {
      lastId = product.id;
      scanned += 1;
      if (scanned > limit) break;

      const aiMetadata = product.aiMetadata && typeof product.aiMetadata === 'object' ? product.aiMetadata : {};
      const originalTitle = typeof aiMetadata?.originalTitle === 'string' ? aiMetadata.originalTitle : '';
      const baseTitle = originalTitle || product.name || '';
      if (!baseTitle) continue;
      console.log(`[UpdateExisting] batch=${batchIndex + 1} productId=${product.id} scanned=${scanned} updated=${updatedCount} title=${cleanAiText(String(baseTitle).slice(0, 80))}`);

      let titleAr = '';
      let descriptionAr = '';
      let keywords = [];
      const existingDescription = cleanAiText(sanitizeTranslationText(String(aiMetadata?.translatedDescription || '').trim()));
      const normalizedName = cleanAiText(sanitizeTranslationText(String(product.name || '').trim()));
      const hasGoodExistingDescription = existingDescription.length >= 24;
      const hasGoodExistingName = normalizedName && hasArabic(normalizedName);
      const hasStrongExistingKeywords = Array.isArray(product.keywords) && product.keywords.length >= Math.max(10, Math.floor(KEYWORDS_PER_PRODUCT * 0.7));

      if (SILICONFLOW_API_KEY) {
        if (UPDATE_FORCE_REGENERATE) {
          console.log(`Force regenerating keywords for product ${product.id}...`);
          const generated = await generateTitleAndKeywords(baseTitle);
          titleAr = generated.titleAr;
          descriptionAr = generated.descriptionAr;
          keywords = generated.keywords;
        } else if (hasGoodExistingName && hasGoodExistingDescription && hasStrongExistingKeywords) {
          titleAr = normalizedName;
          descriptionAr = existingDescription;
          keywords = ensureKeywordList(product.keywords, `${titleAr} ${descriptionAr}`.trim());
        } else {
          if (scanned % UPDATE_PROGRESS_EVERY === 0) {
            console.log(`Generating keywords for product ${product.id}...`);
          }
          const generated = await generateTitleAndKeywords(baseTitle);
          titleAr = generated.titleAr;
          descriptionAr = generated.descriptionAr;
          keywords = generated.keywords;
        }
      }

      const fallbackDescription = typeof aiMetadata?.translatedDescription === 'string' ? aiMetadata.translatedDescription : '';
      const seedText = `${titleAr || product.name} ${descriptionAr || fallbackDescription}`.trim();
      const beforeKeywords = Array.isArray(product.keywords) ? product.keywords : [];
      const finalKeywords = ensureKeywordList(
        Array.isArray(keywords) && keywords.length > 0 ? keywords : [],
        seedText
      );
      const fallbackKeywordsFromExisting = ensureKeywordList(
        beforeKeywords,
        `${product.name || ''} ${fallbackDescription || ''}`.trim()
      );
      const keywordsToPersist = finalKeywords.length > 0 ? finalKeywords : fallbackKeywordsFromExisting;
      if (finalKeywords.length === 0) {
        console.warn(`Product ${product.id}: AI/seed produced no keywords, falling back to existing-derived keywords (${keywordsToPersist.length}).`);
      }
      const nextMetadata = {
        ...aiMetadata,
        translatedDescription: descriptionAr || fallbackDescription || seedText
      };
      const shouldUpdateName = titleAr && (isChineseTerm(product.name) || !hasArabic(product.name));
      const keywordsSql = keywordsToPersist.length > 0 ? Prisma.join(keywordsToPersist) : null;
      try {
        if (UPDATE_CLEAR_KEYWORDS_FIRST) {
          await prisma.$executeRaw`
            UPDATE "Product"
            SET "keywords" = ARRAY[]::text[],
                "updatedAt" = NOW()
            WHERE "id" = ${product.id}
          `;
        }
        if (shouldUpdateName) {
          if (keywordsSql) {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "name" = ${titleAr},
                  "keywords" = ARRAY[${keywordsSql}],
                  "aiMetadata" = ${JSON.stringify(nextMetadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${product.id}
            `;
          } else {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "name" = ${titleAr},
                  "keywords" = ARRAY[]::text[],
                  "aiMetadata" = ${JSON.stringify(nextMetadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${product.id}
            `;
          }
        } else {
          if (keywordsSql) {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "keywords" = ARRAY[${keywordsSql}],
                  "aiMetadata" = ${JSON.stringify(nextMetadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${product.id}
            `;
          } else {
            await prisma.$executeRaw`
              UPDATE "Product"
              SET "keywords" = ARRAY[]::text[],
                  "aiMetadata" = ${JSON.stringify(nextMetadata)}::jsonb,
                  "updatedAt" = NOW()
              WHERE "id" = ${product.id}
            `;
          }
        }
      } catch (error) {
        const errMsg = String(error?.message || '');
        if (
          error?.code === 'P1017'
          || error?.code === 'P1001'
          || error?.code === 'P2028'
          || errMsg.includes('Engine is not yet connected')
          || errMsg.includes('Unable to start a transaction in the given time')
        ) {
          console.warn(`DB connection issue while updating product ${product.id}. Reconnecting...`);
          await safeReconnect();
          continue;
        }
        throw error;
      }
      updatedCount += 1;
      if (updatedLog.length < 120) {
        const beforePreview = beforeKeywords.slice(0, 12);
        const afterPreview = keywordsToPersist.slice(0, 12);
        updatedLog.push({
          id: product.id,
          name: product.name,
          beforeCount: beforeKeywords.length,
          afterCount: keywordsToPersist.length,
          beforePreview,
          afterPreview
        });
      }
      if (UPDATE_PRINT_BATCH_SAMPLE && !batchSamplePrinted) {
        batchSamplePrinted = true;
        console.log('[KeywordSample]', {
          id: product.id,
          name: shouldUpdateName ? titleAr : product.name,
          keywords: keywordsToPersist
        });
      }
      if (updatedCount % UPDATE_PROGRESS_EVERY === 0) {
        console.log(`Progress: updated ${updatedCount}, scanned ${scanned}`);
      }
      saveUpdateExistingProgress({ lastId, scanned, updatedCount });
      await humanDelay(UPDATE_DELAY_MIN, UPDATE_DELAY_MAX);
    }
    batchIndex += 1;
    saveUpdateExistingProgress({ lastId, scanned, updatedCount });
    if (batchIndex % 4 === 0) {
      await safeReconnect();
    }
  }

  clearUpdateExistingProgress();
  console.log(`Existing Goofish products update completed. Updated: ${updatedCount}, Scanned: ${scanned}`);
  if (updatedLog.length > 0) {
    console.log('Updated keyword samples:', updatedLog.slice(0, 20));
  }
}

async function runDetailsOnly() {
  console.log('Starting goofish details-only mode...');
  await ensureDbReady();
  const browser = await createBrowser();
  console.log(`Browser launched in ${GOOFISH_HEADLESS ? 'hidden/headless' : 'visible'} mode.`);
  
  // Login wait - wait for user to manually log in / solve CAPTCHA before starting
  // Disabled - auto-start
  // if (!GOOFISH_HEADLESS) {
  //   console.log('\n========================================');
  //   console.log('  LOGIN / CAPTCHA WAIT');
  //   console.log('========================================');
  //   console.log('Browser is visible. Please log in to Goofish/Xianyu or solve the CAPTCHA if present.');
  //   console.log('Press Enter when you are ready to start...');
  //   await ask('');
  //   console.log('Starting details-only mode...\n');
  // }
  
  const pages = await browser.pages();
  let page = pages[0];
  if (!page) page = await browser.newPage();
  const width = 1920 + Math.floor(Math.random() * 100) - 50;
  const height = 1080 + Math.floor(Math.random() * 100) - 50;
  await page.setViewport({ width, height });
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1'
  });
  const cookiesPath = path.join(__dirname, 'goofish-cookies.json');
  if (fs.existsSync(cookiesPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    } catch {}
  }
  const detailsWhere = GOOFISH_DETAILS_IDS.length > 0
    ? { id: { in: GOOFISH_DETAILS_IDS } }
    : {
      purchaseUrl: { contains: 'goofish.com' },
      isActive: true
    };
  const products = await withRetry(
    () => prisma.product.findMany({
      where: detailsWhere,
      select: {
        id: true,
        name: true,
        purchaseUrl: true,
        image: true,
        imagesChecked: true,
        specs: true
      },
      orderBy: { updatedAt: 'desc' },
      take: GOOFISH_DETAILS_IDS.length > 0 ? undefined : GOOFISH_DETAILS_LIMIT
    }),
    'load details-only products',
    3,
    20000,
    800
  );
  console.log(`Details-only picked ${products.length} products.`);
  for (const p of products) {
    await processProductDetails(page, {
      id: p.id,
      url: p.purchaseUrl,
      name: p.name,
      image: p.image,
      imagesChecked: p.imagesChecked,
      specs: p.specs
    });
  }
  await browser.close();
  console.log('Details-only mode finished.');
}

if (UPDATE_EXISTING) {
  updateExistingGoofishProducts()
    .catch((error) => {
      console.error('Goofish existing update error:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
} else if (GOOFISH_DETAILS_ONLY) {
  runDetailsOnly()
    .catch((error) => {
      console.error('Goofish details-only error:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
} else {
  run().catch(e => {
    console.error("Pipeline failed with error:", e);
    process.exit(1);
  });
}
