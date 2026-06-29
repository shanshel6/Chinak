import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { normalizeArabic } from '../services/arabicNormalize.js';

// Helper function to check if text is more than 50% Chinese characters
function isMostlyChinese(text) {
  if (!text || text.length < 3) return false; // Allow very short strings
  const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
  const chineseRatio = chineseChars.length / text.length;
  return chineseRatio > 0.5;
}

// Helper function to calculate price multiplier (copied to avoid importing from goofish-pipeline.js)
function calculatePriceMultiplier(basePriceIQD) {
  return 1.2;
}

// Helper function to extract categoryId (copied to avoid importing from goofish-pipeline.js)
function extractCategoryId(url) {
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

// Helper function to check if error is retryable (copied to avoid importing from goofish-pipeline.js)
function isRetryableDbError(error) {
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
}

// Helper function to ensure DB is ready (simplified version for queue processor)
async function ensureDbReady() {
  let attempt = 1;
  while (true) {
    try {
      console.log(`[Queue] Database connection attempt ${attempt}...`);
      const connectPromise = prisma.$connect();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database connection timeout')), 30000)
      );
      await Promise.race([connectPromise, timeoutPromise]);
      console.log('[Queue] Database connected successfully');
      return true;
    } catch (error) {
      console.error(`[Queue] Connection attempt ${attempt} failed:`, error.message);
      attempt++;
      console.log(`[Queue] Retrying in 5 seconds...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Helper function to recover DB connection (simplified version for queue processor)
async function recoverDbConnectionQuick(label) {
  try {
    await prisma.$disconnect();
    await prisma.$connect();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[Queue] Failed to recover DB connection: ${error.message}`);
    return false;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env'), override: false });

const prisma = new PrismaClient();

// Support multiple queue directories (comma-separated in GOOFISH_QUEUE_DIR, or default to both)
const queueDirEnv = process.env.GOOFISH_QUEUE_DIR || 'product-queue,product-queue-2';
const QUEUE_DIRS = queueDirEnv.split(',').map(d => join(__dirname, '../../' + d.trim()));

function getQueueDirs() {
  return QUEUE_DIRS.map(dir => ({
    queueDir: dir,
    processedDir: join(dir, 'processed'),
    failedDir: join(dir, 'failed'),
  }));
}

const CNY_TO_IQD_RATE = 200;
const MAX_RETRIES = 10;
const EMBEDDING_RETRIES = 5;

// AI Configuration
const SILICONFLOW_API_KEY = String(process.env.SILICONFLOW_API_KEY || '').trim();
const CATEGORY_MODEL = process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V4-Flash';
const CATEGORY_API_TIMEOUT_MS = 120000;

// Helper function to call SiliconFlow API for category generation
async function callSiliconFlowForCategory(prompt, maxRetries = 3) {
  if (!SILICONFLOW_API_KEY) {
    throw new Error('SILICONFLOW_API_KEY not set');
  }

  const API_TIMEOUT_MS = 60000; // 60 second timeout per API call

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await Promise.race([
        fetch('https://api.siliconflow.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
          },
          body: JSON.stringify({
            model: CATEGORY_MODEL,
            messages: [
              { role: 'system', content: 'You are a helpful assistant that categorizes products. Always respond with valid JSON only.' },
              { role: 'user', content: prompt }
            ],
            max_tokens: 200,
            temperature: 0.3
          })
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI category API timeout')), API_TIMEOUT_MS)
        )
      ]);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content in response');
      }

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error(`[AI Category] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else {
        throw err;
      }
    }
  }
}

// Helper function to generate category name using AI
async function generateCategoryNameFromTitle(title) {
  const prompt = `Analyze this product title and generate an appropriate e-commerce category in JSON format.

Product title: ${title}

Respond with valid JSON only, no explanation:
{
  "slug": "category_slug_in_english",
  "name_ar": "Arabic category name",
  "name_en": "English category name",
  "confidence": 0.95
}

Example output for "睡袍" (robe):
{
  "slug": "sleepwear_robes",
  "name_ar": "روب نوم",
  "name_en": "Sleepwear Robes",
  "confidence": 0.98
}`;

  console.log(`  → Calling AI for category discovery...`);
  return await callSiliconFlowForCategory(prompt);
}

// Helper function to convert vector to SQL literal
function vectorToSqlLiteral(vector) {
  return `[${vector.join(',')}]`;
}

// Update image embeddings from JSON file (no CLIP service needed)
async function updateImageEmbeddingsFromJson(productId, imageEmbeddings, textEmbedding = null) {
  const EMBEDDING_RETRIES = 5;
  const EMBEDDING_TIMEOUT_MS = 30000; // 30 second timeout per update
  let retryCount = 0;

  while (retryCount < EMBEDDING_RETRIES) {
    try {
      for (const imgEmbed of imageEmbeddings) {
        if (!imgEmbed.embedding || !Array.isArray(imgEmbed.embedding) || imgEmbed.embedding.length === 0) {
          console.warn(`[Queue] Skipping empty embedding for image ${imgEmbed.url}`);
          continue;
        }

        const vectorLiteral = vectorToSqlLiteral(imgEmbed.embedding);
        const imageOrder = imgEmbed.order != null ? imgEmbed.order : imageEmbeddings.indexOf(imgEmbed);
        console.log(`[Queue] Embedding URL: ${imgEmbed.url}  order=${imageOrder}  vector_len=${imgEmbed.embedding.length}`);

        // SKIP: ProductImage.imageEmbedding update - column doesn't exist and not needed for search
        console.log(`[Queue] Skipping ProductImage update for order ${imageOrder} - not needed`);
      }

      // Prepare update data for both image and text embeddings
      const updates = [];
      const params = [];
      let paramIndex = 1;

      // Update product's main image embedding
      if (imageEmbeddings.length > 0 && imageEmbeddings[0].embedding) {
        const mainVector = vectorToSqlLiteral(imageEmbeddings[0].embedding);
        updates.push(`"imageEmbedding" = $${paramIndex}::vector`);
        params.push(mainVector);
        paramIndex++;
      }

      // Update text embedding if available
      if (textEmbedding && Array.isArray(textEmbedding) && textEmbedding.length > 0 && !textEmbedding.every(v => v === 0)) {
        const textVector = vectorToSqlLiteral(textEmbedding);
        updates.push(`"textEmbedding" = $${paramIndex}::vector`);
        params.push(textVector);
        paramIndex++;
        console.log(`[Queue] Will update text embedding (${textEmbedding.length} dimensions) for product ${productId}`);
      }

      // Execute update if there are any embeddings to update
      if (updates.length > 0) {
        const updateQuery = `UPDATE "Product" SET ${updates.join(', ')} WHERE "id" = $${paramIndex}`;
        params.push(productId);

        await Promise.race([
          prisma.$executeRawUnsafe(updateQuery, ...params),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Embedding update timeout')), EMBEDDING_TIMEOUT_MS)
          )
        ]);
        console.log(`[Queue] Updated embeddings for product ${productId}: ${updates.map(u => u.split('=')[0].trim().replace(/"/g, '')).join(', ')}`);

        // Verify embeddings
        const verifyQuery = `SELECT ("imageEmbedding" IS NOT NULL) as has_image_emb, ("textEmbedding" IS NOT NULL) as has_text_emb FROM "Product" WHERE "id" = $1`;
        const verifyResult = await prisma.$queryRawUnsafe(verifyQuery, productId);
        if (verifyResult.length > 0) {
          console.log(`[Queue] VERIFY embeddings: has_image_embedding=${verifyResult[0].has_image_emb}, has_text_embedding=${verifyResult[0].has_text_emb}`);
        }
      } else {
        console.log(`[Queue] No embeddings to update for product ${productId}`);
      }

      console.log(`[Queue] Successfully processed embeddings for product ${productId}`);
      return;
    } catch (err) {
      retryCount++;
      console.error(`[Queue] Image embedding update attempt ${retryCount}/${EMBEDDING_RETRIES} failed: ${toErrorText(err)}`);
      if (retryCount < EMBEDDING_RETRIES) {
        await new Promise(r => setTimeout(r, 2000 * retryCount));
      } else {
        console.error(`[Queue] Failed to update image embeddings after ${EMBEDDING_RETRIES} retries, continuing...`);
        // Don't throw - continue processing
        return;
      }
    }
  }
}

// Helper function to extract error message
function toErrorText(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

// Sanitize image URL - convert HEIC and other problematic formats to JPEG
function sanitizeImageUrlForDb(url) {
  if (!url || typeof url !== 'string') return url;
  let sanitized = url.trim();
  // Remove .webp suffix
  sanitized = sanitized.replace(/\.webp$/i, '');
  // Convert .heic (Apple format) to .jpg - Goofish serves HEIC images that are actually JPEG-compatible
  // Pattern: .heic_450x10000Q90.jpg -> .jpg
  sanitized = sanitized.replace(/\.heic.*$/i, '.jpg');
  // Strip AliCDN resize suffixes like _450x10000Q90.jpg or _200x200.jpg
  sanitized = sanitized.replace(/_\d+x\d+.*$/, '');
  return sanitized;
}

// Initialize queue directories
async function initQueueDirs() {
  try {
    for (const { queueDir, processedDir, failedDir } of getQueueDirs()) {
      await fs.mkdir(queueDir, { recursive: true });
      await fs.mkdir(processedDir, { recursive: true });
      await fs.mkdir(failedDir, { recursive: true });
      console.log(`[Queue] Initialized: ${queueDir}`);
    }
  } catch (err) {
    console.error('[Queue] Failed to initialize queue directories:', err);
    throw err;
  }
}

// Move file to processed directory
async function moveToProcessed(filePath, itemId, processedDir) {
  const destPath = join(processedDir, `${itemId}.json`);
  await Promise.race([
    fs.rename(filePath, destPath),
    new Promise((_, reject) => setTimeout(() => reject(new Error('File move timeout')), 10000))
  ]);
  console.log(`[Queue] Moved ${itemId} to processed`);
}

// Move file to failed directory
async function moveToFailed(filePath, itemId, failedDir) {
  try {
    const destPath = join(failedDir, `${itemId}.json`);
    await Promise.race([
      fs.rename(filePath, destPath),
      new Promise((_, reject) => setTimeout(() => reject(new Error('File move timeout')), 10000))
    ]);
    console.log(`[Queue] Moved ${itemId} to failed`);
  } catch (error) {
    console.log(`[Queue] Failed to move ${itemId} to failed (file may not exist): ${error.message}`);
  }
}

// Insert product to database
async function insertProduct(productData, goofishMappings, categories) {
  let dbRetryCount = 0;
  
  while (dbRetryCount < MAX_RETRIES) {
    try {
      const createdProduct = await prisma.$transaction(async (tx) => {
        console.log(`[Queue] Transaction started for product ${productData.itemId} (attempt ${dbRetryCount + 1}/${MAX_RETRIES})`);
        
        const basePriceIQD = Math.max(0, Number(productData.priceCny || 0) * CNY_TO_IQD_RATE);
        const multiplier = calculatePriceMultiplier(basePriceIQD);
        const priceIQD = Math.round(basePriceIQD * multiplier);
        console.log(`[Queue] Calculated price: ${productData.priceCny || 0} CNY -> ${priceIQD} IQD`);

        // Skip products without images (database constraint until migration is applied)
        if (!productData.images || productData.images.length === 0) {
          console.log(`[Queue] Skipping product ${productData.itemId} - no images available`);
          throw new Error('Product has no images, skipping');
        }

        // Skip products with mostly Chinese names
        if (isMostlyChinese(productData.name)) {
          console.log(`[Queue] Skipping product ${productData.itemId} - name is mostly Chinese: ${productData.name.substring(0, 50)}...`);
          throw new Error('Product name is mostly Chinese, skipping');
        }

        console.log(`[Queue] Creating product in database...`);
        const newProduct = await tx.product.create({
          data: {
            purchaseUrl: productData.url,
            name: productData.name,
            image: productData.images && productData.images.length > 0 ? sanitizeImageUrlForDb(productData.images[0]) : null,
            price: priceIQD,
            basePriceIQD,
            neworold: productData.newOrOld,
            specs: productData.specs ? JSON.stringify(productData.specs) : null,
            aiMetadata: {
              source: "goofish",
              scrapedAt: productData.scrapedAt,
              soldCount: productData.soldCount || null,
              isRealBrand: null,
              goofishItemId: productData.itemId,
              goofishCategoryId: productData.categoryId || null,
              originalTitle: productData.originalTitle,
              originalTitleEnglish: productData.titleEn || null,
              isOriginal: typeof productData.isOriginal !== 'undefined' ? productData.isOriginal : null,
              brandName: productData.brandName || null,
              translatedDescription: productData.description || null,
              detailTranslationUpdatedAt: productData.description ? productData.scrapedAt : null
            },
            isActive: productData.isActive,
            keywords: [],
            imagesChecked: true
          }
        });
        
        console.log(`[Queue] Created product with ID: ${newProduct.id}`);
        
        // Insert images without embeddings first
        if (productData.images && productData.images.length > 0) {
          for (const imageUrl of productData.images) {
            try {
              const cleanUrl = sanitizeImageUrlForDb(imageUrl);
              await tx.productImage.create({
                data: {
                  productId: newProduct.id,
                  url: cleanUrl,
                  order: productData.images.indexOf(imageUrl),
                  type: 'GALLERY'
                }
              });
            } catch (imageErr) {
              console.error(`[Queue] Failed to insert image ${imageUrl}: ${toErrorText(imageErr)}`);
              throw imageErr;
            }
          }
        }
        
        return newProduct;
      }, {
        timeout: 60000
      });
      
      console.log(`[Queue] Transaction committed successfully for product ${createdProduct.id}`);
      
      // Assign category AFTER transaction (to avoid timeout)
      if (productData.categoryId) {
        console.log(`[Queue] Assigning category after transaction for Product ${createdProduct.id}...`);
        try {
          // First, check if a category with this goofishCategoryId already exists in the database
          let categoryRecord = await prisma.category.findFirst({
            where: { goofishCategoryId: productData.categoryId }
          });

          if (categoryRecord) {
            console.log(`  → Found existing category with goofishCategoryId ${productData.categoryId}: ${categoryRecord.slug} (${categoryRecord.id})`);
          } else {
            // Category doesn't exist, try to generate AI category name from product title
            let categorySlug = null;
            let categoryNameAr = null;
            let categoryNameEn = null;

            try {
              if (SILICONFLOW_API_KEY && productData.name) {
                console.log(`  → Generating category name from AI for: ${productData.name.substring(0, 30)}...`);
                const aiCategory = await generateCategoryNameFromTitle(productData.name);
                if (aiCategory && aiCategory.slug && aiCategory.name_ar) {
                  categorySlug = aiCategory.slug;
                  categoryNameAr = aiCategory.name_ar;
                  categoryNameEn = aiCategory.name_en || aiCategory.name_ar;
                  console.log(`  → AI generated category: ${categorySlug} (${categoryNameAr})`);
                }
              }
            } catch (aiErr) {
              console.warn(`  → AI category generation failed: ${aiErr.message}, using fallback`);
            }

            // Fallback if AI fails or no API key
            if (!categorySlug) {
              if (productData.categoryId && goofishMappings[productData.categoryId]) {
                categorySlug = goofishMappings[productData.categoryId];
                const existingCat = categories.find(c => c.slug === categorySlug);
                categoryNameAr = existingCat?.name_ar || categorySlug;
                categoryNameEn = existingCat?.name_en || categoryNameAr;
                console.log(`  → Using existing mapping: ${categorySlug}`);
              } else {
                // Fallback: use raw categoryId as slug
                categorySlug = `goofish-${productData.categoryId}`;
                categoryNameAr = `Goofish Category ${productData.categoryId}`;
                categoryNameEn = categoryNameAr;
                console.log(`  → No mapping found, using fallback: ${categorySlug}`);
              }
            }

            if (categorySlug && categoryNameAr) {
              // Check if category exists by slug
              categoryRecord = await prisma.category.findUnique({
                where: { slug: categorySlug }
              });

              if (!categoryRecord) {
                console.log(`  → Category not found in database, creating: ${categorySlug}`);
                categoryRecord = await prisma.category.create({
                  data: {
                    slug: categorySlug,
                    nameAr: categoryNameAr,
                    nameEn: categoryNameEn || categoryNameAr,
                    goofishCategoryId: productData.categoryId || null
                  }
                });
                console.log(`  → Created category in database with ID: ${categoryRecord.id}`);
              } else {
                console.log(`  → Found category in database with ID: ${categoryRecord.id}`);
              }
            }
          }

          if (categoryRecord) {
            // Update product with categoryId
            await prisma.product.update({
              where: { id: createdProduct.id },
              data: { categoryId: categoryRecord.id }
            });
            console.log(`✅ Assigned category after transaction: ${categoryRecord.slug} (${categoryRecord.id})`);
          }
        } catch (catErr) {
          console.warn(`⚠️ Failed to assign category after transaction: ${toErrorText(catErr)}`);
        }
      }
      
      return createdProduct;
    } catch (txErr) {
      dbRetryCount++;
      const errorMsg = toErrorText(txErr);
      console.error(`[Queue] Transaction failed for product ${productData.itemId} (attempt ${dbRetryCount}/${MAX_RETRIES}): ${errorMsg}`);
      
      const isRetryable = isRetryableDbError(txErr) || errorMsg.includes('Server has closed the connection');
      
      if (!isRetryable || dbRetryCount >= MAX_RETRIES) {
        console.error(`[Queue] Transaction failed after ${dbRetryCount} attempts, giving up`);
        throw txErr;
      }
      
      const backoffMs = Math.min(5000, 1000 * dbRetryCount);
      console.log(`[Queue] Waiting ${backoffMs}ms before retry...`);
      await new Promise(r => setTimeout(r, backoffMs));
      
      try {
        await recoverDbConnectionQuick(`queue retry ${dbRetryCount}`);
        console.log(`[Queue] Reconnected to database, retrying transaction...`);
      } catch (reconnectErr) {
        console.warn(`[Queue] Reconnect failed, will retry anyway: ${toErrorText(reconnectErr)}`);
      }
    }
  }
}

// Update image embeddings
async function updateImageEmbeddings(product, imageCount) {
  let embeddingRetryCount = 0;
  
  while (embeddingRetryCount < EMBEDDING_RETRIES) {
    try {
      const result = await ensureProductImageEmbeddings({
        prisma,
        productId: product.id,
        productName: product.name,
        maxImages: imageCount
      });
      console.log(`[Queue] ensureProductImageEmbeddings completed: ${result.embeddedCount} images embedded`);
      break;
    } catch (embErr) {
      embeddingRetryCount++;
      const errorMsg = toErrorText(embErr);
      console.error(`[Queue] ensureProductImageEmbeddings failed for product ${product.id} (attempt ${embeddingRetryCount}/${EMBEDDING_RETRIES}): ${errorMsg}`);
      
      const isRetryable = isRetryableDbError(embErr) || errorMsg.includes('Server has closed the connection');
      
      if (!isRetryable || embeddingRetryCount >= EMBEDDING_RETRIES) {
        console.warn(`⚠️ ensureProductImageEmbeddings failed after ${embeddingRetryCount} attempts, skipping embeddings for product ${product.id}`);
        break;
      }
      
      const backoffMs = Math.min(3000, 500 * embeddingRetryCount);
      console.log(`[Queue] Waiting ${backoffMs}ms before retrying embeddings...`);
      await new Promise(r => setTimeout(r, backoffMs));
      
      try {
        await recoverDbConnectionQuick(`embedding retry ${embeddingRetryCount}`);
        console.log(`[Queue] Reconnected to database, retrying embeddings...`);
      } catch (reconnectErr) {
        console.warn(`[Queue] Reconnect failed, will retry anyway: ${toErrorText(reconnectErr)}`);
      }
    }
  }
}

// Process a single product file
async function processProductFile(filePath, goofishMappings, categories, processedDir, failedDir) {
  const PROCESS_TIMEOUT_MS = 600000; // 10 minute timeout per product

  try {
    // Add timeout to entire product processing
    await Promise.race([
      (async () => {
        const content = await Promise.race([
          fs.readFile(filePath, 'utf-8'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('File read timeout')), 10000))
        ]);
        const productData = JSON.parse(content);
        
        console.log(`\n[Queue] Processing product: ${productData.itemId} - ${productData.name}`);
        
        await ensureDbReady();
        
        // Insert product to database
        const createdProduct = await insertProduct(productData, goofishMappings, categories);

        // Populate nameNormalized for hybrid lexical search (column managed via
        // raw SQL, not Prisma schema). Keep it in sync with the product name.
        try {
          const nameNormalized = normalizeArabic(productData.name);
          await prisma.$executeRawUnsafe(
            `UPDATE "Product" SET "nameNormalized" = $1 WHERE "id" = $2`,
            nameNormalized,
            createdProduct.id
          );
        } catch (normErr) {
          console.warn(`[Queue] Failed to set nameNormalized for ${createdProduct.id}: ${toErrorText(normErr)}`);
        }

        // Verify product exists
        try {
          const verification = await Promise.race([
            prisma.product.findUnique({
              where: { id: createdProduct.id }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Product verification timeout')), 10000))
          ]);
          if (verification) {
            console.log(`✅ Verified product ${createdProduct.id} exists in database`);
          } else {
            console.error(`❌ Product ${createdProduct.id} NOT FOUND in database after transaction commit!`);
          }
        } catch (verifyErr) {
          console.error(`❌ Failed to verify product ${createdProduct.id}: ${toErrorText(verifyErr)}`);
        }
        
        // Update image embeddings from JSON file (no CLIP service needed)
        if (productData.imageEmbeddings && productData.imageEmbeddings.length > 0) {
          console.log(`[Queue] Updating ${productData.imageEmbeddings.length} image embeddings from JSON file...`);
          await updateImageEmbeddingsFromJson(createdProduct.id, productData.imageEmbeddings, productData.textEmbedding);
        } else if (productData.textEmbedding) {
          // If only text embedding exists, update it
          console.log(`[Queue] Updating text embedding only...`);
          await updateImageEmbeddingsFromJson(createdProduct.id, [], productData.textEmbedding);
        }
        
        // Move to processed
        await moveToProcessed(filePath, productData.itemId, processedDir);
        console.log(`✅ Successfully processed product ${productData.itemId}`);
      })(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Product processing timeout')), PROCESS_TIMEOUT_MS)
      )
    ]);
    
  } catch (err) {
    console.error(`[Queue] Failed to process product file ${filePath}: ${toErrorText(err)}`);
    await moveToFailed(filePath, filePath.split(/[\\/]/).pop().replace('.json', ''), failedDir);
    throw err;
  }
}

// Main queue processor loop
async function processQueue() {
  try {
    await initQueueDirs();
    console.log('[Queue] Connecting to database...');
    await ensureDbReady();
    console.log('[Queue] Database connected');
    
    // Load categories (required for category assignment)
    console.log('[Queue] Loading categories from database...');
    let categories = [];
    try {
      categories = await Promise.race([
        prisma.category.findMany(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Categories loading timeout')), 60000))
      ]);
      console.log(`[Queue] Loaded ${categories.length} categories`);
    } catch (err) {
      console.warn('[Queue] Failed to load categories, category assignment will be skipped:', err.message);
    }
    
    // Load Goofish mappings (optional)
    let goofishMappings = {};
    try {
      console.log('[Queue] Loading Goofish mappings from database...');
      const mappings = await Promise.race([
        prisma.$queryRaw`SELECT * FROM "GoofishCategoryMapping"`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Mappings loading timeout')), 30000))
      ]);
      mappings.forEach(m => {
        goofishMappings[m.goofishCategoryId] = m.categorySlug;
      });
      console.log(`[Queue] Loaded ${mappings.length} Goofish mappings`);
    } catch (err) {
      console.warn('[Queue] Failed to load mappings (table may not exist), will use direct categoryId:', err.message);
    }
    
    console.log('[Queue] Starting queue processor loop...');
    console.log(`[Queue] Watching directories: ${getQueueDirs().map(d => d.queueDir).join(', ')}`);
    
    while (true) {
      try {
        // Collect files from all queue directories
        let allFiles = [];
        for (const { queueDir, processedDir, failedDir } of getQueueDirs()) {
          try {
            const files = await fs.readdir(queueDir);
            const queueFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));
            for (const file of queueFiles) {
              allFiles.push({
                filePath: join(queueDir, file),
                processedDir,
                failedDir,
                queueDir,
              });
            }
          } catch (dirErr) {
            console.warn(`[Queue] Could not read directory ${queueDir}: ${dirErr.message}`);
          }
        }
        
        const totalFiles = allFiles.length;
        console.log(`[Queue] Checking queues... Found ${totalFiles} files waiting across ${getQueueDirs().length} directories`);
        
        if (totalFiles === 0) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        
        console.log(`[Queue] Processing ${totalFiles} files`);
        
        for (const { filePath, processedDir, failedDir, queueDir } of allFiles) {
          const dirName = queueDir.split(/[\\/]/).pop();
          console.log(`[Queue] [${dirName}] Processing: ${filePath.split(/[\\/]/).pop()}`);
          await processProductFile(filePath, goofishMappings, categories, processedDir, failedDir);
        }
        
      } catch (err) {
        console.error('[Queue] Error in queue processor loop:', err);
        await new Promise(r => setTimeout(r, 10000));
      }
    }
  } catch (err) {
    console.error('[Queue] Fatal error starting queue processor:', err);
    throw err;
  }
}

// Start the queue processor
processQueue().catch(err => {
  console.error('[Queue] Fatal error:', err);
  process.exit(1);
});
