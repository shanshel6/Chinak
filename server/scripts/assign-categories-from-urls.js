/**
 * Assign categories to products by:
 * 1. Checking product URL for categoryId (Goofish/Xianyu)
 * 2. If categoryId exists in mapping → assign directly
 * 3. If categoryId exists but not in mapping → use AI to discover category
 * 4. If no categoryId → use AI based on product title
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments for resume offset
const resumeOffsetArg = process.argv.find(arg => arg.startsWith('--resume-offset='));
const cmdLineOffset = resumeOffsetArg ? parseInt(resumeOffsetArg.split('=')[1], 10) : null;
const envOffset = process.env.CATEGORY_RESUME_OFFSET ? parseInt(process.env.CATEGORY_RESUME_OFFSET, 10) : null;

// Load .env file from server directory
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`[Setup] Loaded .env from: ${envPath}`);
  console.log(`[Setup] DATABASE_URL is ${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`);
} else {
  console.warn(`[Setup] No .env file found at: ${envPath}`);
}

const prisma = new PrismaClient();

// Retry connection logic
async function connectWithRetry(maxRetries = 2, initialDelay = 500) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await Promise.race([
        prisma.$connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
      ]);
      console.log(`[Setup] Database connected successfully (attempt ${attempt})`);
      return true;
    } catch (err) {
      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.log(`[Setup] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      console.log(`[Setup] Retrying in ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`Failed to connect after ${maxRetries} attempts`);
}

// Reconnect on connection errors
async function ensureConnected() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.log(`[Reconnect] Connection lost: ${err.message}`);
    console.log(`[Reconnect] Disconnecting and reconnecting...`);
    await prisma.$disconnect();
    try {
      await Promise.race([
        connectWithRetry(1, 500),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Reconnect timeout')), 5000))
      ]);
    } catch (reconnectErr) {
      console.error(`[Reconnect] Failed to reconnect: ${reconnectErr.message}`);
      throw reconnectErr;
    }
  }
}

// Wrapper for database queries with reconnection and timeout
async function withReconnection(fn, maxRetries = 3, queryTimeoutMs = 30000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Race the query against a hard timeout to prevent indefinite hangs
      return await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), queryTimeoutMs))
      ]);
    } catch (err) {
      const isConnectionError = err.code === 'P1017' || err.code === 'P1001' || err.message?.includes('closed') || err.message?.includes('connection');
      const isTimeout = err.message === 'Query timeout';
      if ((isConnectionError || isTimeout) && attempt < maxRetries) {
        console.log(`[Reconnect] Query failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
        // Skip reconnection - just wait and retry directly
        console.log(`[Reconnect] Waiting 2s before retry...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
}

// Paths
const SEED_PATH = path.join(__dirname, '..', 'scripts', 'canonical-categories.seed.json');
const MAPPINGS_PATH = path.join(__dirname, '..', 'scripts', 'goofish-category-mappings.json');
const PROGRESS_PATH = path.join(__dirname, '..', 'scripts', 'assign-categories-progress.json');

// Config
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V4-Flash';
const BATCH_SIZE = parseInt(process.env.CATEGORY_BATCH_SIZE || '50', 10);
const DELAY_MS = parseInt(process.env.CATEGORY_DELAY_MS || '1000', 10);
const API_TIMEOUT_MS = parseInt(process.env.CATEGORY_API_TIMEOUT_MS || '120000', 10);
const AI_RATE_LIMIT_DELAY_MS = Math.max(0, parseInt(process.env.CATEGORY_AI_RATE_LIMIT_DELAY_MS || '200', 10) || 200);
const FORCE_ALL = process.env.CATEGORY_FORCE_ALL === '1';

// Load existing data
function loadJson(filePath, defaultValue = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.log(`[Load] Warning: Could not load ${filePath}: ${err.message}`);
  }
  return defaultValue;
}

function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`[Save] Error saving ${filePath}: ${err.message}`);
    return false;
  }
}

// Load progress from file (resume capability)
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
      console.log(`[Resume] Found progress file. Resuming from offset: ${data.lastOffset || 0}`);
      return data;
    }
  } catch (err) {
    console.warn(`[Resume] Error loading progress: ${err.message}`);
  }
  return { lastOffset: 0, totalProcessed: 0, totalAssigned: 0, totalCreated: 0, totalFailed: 0 };
}

// Save progress to file
function saveProgress(state) {
  try {
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[Resume] Error saving progress: ${err.message}`);
  }
}

// Extract categoryId from Goofish/Xianyu URLs
function extractCategoryId(url) {
  if (!url) return null;
  try {
    const urlObj = new URL(url);
    const categoryId = urlObj.searchParams.get('categoryId');
    return categoryId || null;
  } catch {
    // Try regex fallback for malformed URLs
    const match = url.match(/[?&]categoryId=([^&]+)/);
    return match ? match[1] : null;
  }
}

// Call SiliconFlow API
async function callSiliconFlow(prompt, maxRetries = 3) {
  const apiKey = SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error('SILICONFLOW_API_KEY not set');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await axios.post(
        'https://api.siliconflow.com/v1/chat/completions',
        {
          model: SILICONFLOW_MODEL,
          messages: [
            { role: 'system', content: 'You are a helpful assistant that categorizes products. Always respond with valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 500,
          temperature: 0.3
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from API');
      
      // Try to parse JSON from response
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        let result;
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          result = JSON.parse(content);
        }
        // Rate limit delay to respect tier limits (L0: 1,000 RPM, 40,000 TPM)
        if (AI_RATE_LIMIT_DELAY_MS > 0) {
          await new Promise(r => setTimeout(r, AI_RATE_LIMIT_DELAY_MS));
        }
        return result;
      } catch {
        if (AI_RATE_LIMIT_DELAY_MS > 0) {
          await new Promise(r => setTimeout(r, AI_RATE_LIMIT_DELAY_MS));
        }
        return { rawResponse: content };
      }
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || err.code === 'ECONNABORTED';
      console.log(`[AI] Attempt ${attempt} failed: ${isTimeout ? 'timed out' : err.message}`);
      if (attempt === maxRetries) throw err;
      const delay = isTimeout ? 5000 * attempt : 2000 * attempt;
      console.log(`[AI] Retrying in ${delay}ms...`);
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

Example output for "iPhone 15 Pro Max":
{
  "slug": "smartphones",
  "name_ar": "الهواتف الذكية",
  "name_en": "Smartphones",
  "confidence": 0.98
}`;

  console.log(`  → Calling AI for category discovery...`);
  return await callSiliconFlow(prompt);
}

// Main function
async function main() {
  console.log('========== CATEGORY ASSIGNMENT FROM URLS ==========\n');

  if (!SILICONFLOW_API_KEY) {
    console.error('ERROR: SILICONFLOW_API_KEY environment variable not set');
    process.exit(1);
  }

  // Load existing data
  const categories = loadJson(SEED_PATH, []);
  const goofishMappings = loadJson(MAPPINGS_PATH, {});
  
  console.log(`[Setup] Loaded ${categories.length} existing categories`);
  console.log(`[Setup] Loaded ${Object.keys(goofishMappings).length} Goofish mappings`);
  console.log(`[Setup] Batch size: ${BATCH_SIZE}, Delay: ${DELAY_MS}ms`);
  if (FORCE_ALL) {
    console.log(`[Setup] FORCE_ALL mode: Will re-process ALL products and discover new categories\n`);
  } else {
    console.log(`[Setup] Normal mode: Only processing uncategorized products\n`);
  }

  // Connect to database with retry logic
  console.log(`[Setup] Connecting to database with retry logic...`);
  try {
    await connectWithRetry(3, 2000);
  } catch (connectErr) {
    console.error(`[Setup] Failed to connect after 3 attempts. Exiting for restart...`);
    process.exit(99);
  }

  // Load progress (resume capability)
  const savedProgress = loadProgress();
  let totalAssigned = savedProgress.totalAssigned || 0;
  let totalCreated = savedProgress.totalCreated || 0;
  let totalFailed = savedProgress.totalFailed || 0;
  let totalProcessed = savedProgress.totalProcessed || 0;
  let batchNum = 0;
  let consecutiveQueryFailures = 0;
  // Priority: command line > env variable > progress file
  let offset = (cmdLineOffset !== null && !isNaN(cmdLineOffset)) ? cmdLineOffset : (envOffset !== null && !isNaN(envOffset)) ? envOffset : (savedProgress.lastOffset || 0);
  if (cmdLineOffset !== null && !isNaN(cmdLineOffset)) {
    console.log(`[Resume] Using forced resume offset: ${offset} (from command line)`);
  } else if (envOffset !== null && !isNaN(envOffset)) {
    console.log(`[Resume] Using forced resume offset: ${offset} (from env variable)`);
  }

  while (true) {
    try {
      batchNum++;

      // Build query based on mode
    const whereClause = FORCE_ALL
      ? `WHERE "isActive" = true AND status = 'PUBLISHED'`
      : `WHERE "isActive" = true
        AND status = 'PUBLISHED'
        AND (
          "aiMetadata" IS NULL
          OR "aiMetadata" = '{}'::jsonb
          OR "aiMetadata"->>'categorySlug' IS NULL
          OR "aiMetadata"->>'categorySlug' = ''
        )`;
    
    // Get next batch of products with reconnection
    const products = await withReconnection(async () => {
      return await prisma.$queryRawUnsafe(`
        SELECT
          id,
          name,
          "purchaseUrl",
          "aiMetadata"
        FROM "Product"
        ${whereClause}
        ORDER BY id ASC
        LIMIT $1
        OFFSET $2
      `, BATCH_SIZE, offset);
    });

    if (products.length === 0) {
      console.log(`\n[Batch ${batchNum}] No more products need category assignment!`);
      break;
    }

    console.log(`\n========== BATCH ${batchNum} ==========`);
    console.log(`[Fetch] Found ${products.length} products needing categories\n`);

    let batchAssigned = 0;
    let batchFailed = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const label = `${product.name?.slice(0, 40) || 'Unknown'} (ID:${product.id})`;
      
      console.log(`[${i + 1}/${products.length}] Processing: ${label}`);

      try {
        // Step 1: Check URL for categoryId
        const categoryId = extractCategoryId(product.purchaseUrl);
        let categorySlug = null;
        let categoryNameAr = null;
        let categorySource = 'unknown';

        if (categoryId) {
          console.log(`  → Found categoryId in URL: ${categoryId}`);
          
          // Check if we have a mapping
          if (goofishMappings[categoryId]) {
            categorySlug = goofishMappings[categoryId];
            const existingCat = categories.find(c => c.slug === categorySlug);
            categoryNameAr = existingCat?.name_ar || categorySlug;
            categorySource = 'goofish_mapped';
            console.log(`  → Using existing mapping: ${categorySlug}`);
          } else {
            // Need to discover this category using AI
            console.log(`  → New categoryId discovered, using AI...`);
            const discovered = await discoverCategory(product.name, categoryId);
            
            if (discovered?.slug && discovered?.name_ar) {
              categorySlug = discovered.slug;
              categoryNameAr = discovered.name_ar;
              
              // Check if category already exists
              const existingIndex = categories.findIndex(c => c.slug === categorySlug);
              if (existingIndex === -1) {
                // Add new category
                categories.push({
                  slug: categorySlug,
                  name_ar: discovered.name_ar,
                  name_en: discovered.name_en || discovered.slug,
                  aliases: [discovered.name_ar, discovered.name_en].filter(Boolean),
                  source: 'auto_discovered',
                  discovered_from: categoryId,
                  created_at: new Date().toISOString()
                });
                totalCreated++;
                console.log(`  → Created new category: ${categorySlug} (${discovered.name_ar})`);
              } else {
                console.log(`  → Using existing category: ${categorySlug}`);
              }
              
              // Save mapping
              goofishMappings[categoryId] = categorySlug;
              categorySource = 'goofish_auto_discovered';
            }
          }
        }

        // Step 2: No categoryId or discovery failed, use AI on title only
        if (!categorySlug) {
          console.log(`  → No categoryId, using AI on product title...`);
          const discovered = await discoverCategory(product.name);
          
          if (discovered?.slug && discovered?.name_ar) {
            categorySlug = discovered.slug;
            categoryNameAr = discovered.name_ar;
            
            // Check if category already exists
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
              totalCreated++;
              console.log(`  → Created new category: ${categorySlug} (${discovered.name_ar})`);
            } else {
              console.log(`  → Using existing category: ${categorySlug}`);
            }
            
            categorySource = 'ai_title_based';
          }
        }

        // Step 3: Assign category to product using raw SQL
        if (categorySlug && categoryNameAr) {
          const metadataPatch = {
            categorySlug,
            categoryNameAr: categoryNameAr,
            categoryScore: 100,
            categoryConfidence: 'high',
            categorySource,
            ...(categoryId ? { goofishCategoryId: categoryId } : {}),
            categoryAssignedAt: new Date().toISOString()
          };

          // Merge with existing aiMetadata if present
          const existingMetadata = product.aiMetadata || {};
          const mergedMetadata = { ...existingMetadata, ...metadataPatch };

          await withReconnection(async () => {
            await prisma.$executeRawUnsafe(`
              UPDATE "Product"
              SET "aiMetadata" = $1::jsonb
              WHERE id = $2
            `, JSON.stringify(mergedMetadata), product.id);
          });

          batchAssigned++;
          totalAssigned++;
          console.log(`  ✓ Assigned to: ${categorySlug} (${categoryNameAr})`);
        } else {
          batchFailed++;
          totalFailed++;
          console.log(`  ✗ Failed to assign category`);
        }

        // Save progress periodically
        if (i % 5 === 0) {
          saveJson(SEED_PATH, categories);
          saveJson(MAPPINGS_PATH, goofishMappings);
        }

        // Delay to avoid rate limiting
        if (i < products.length - 1) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }

      } catch (err) {
        if (err.message === 'Query timeout') {
          consecutiveQueryFailures++;
          if (consecutiveQueryFailures >= 2) {
            console.error(`[Restart] ${consecutiveQueryFailures} consecutive query timeouts. Exiting for restart.`);
            saveJson(SEED_PATH, categories);
            saveJson(MAPPINGS_PATH, goofishMappings);
            saveProgress({ lastOffset: offset, totalProcessed, totalAssigned, totalCreated, totalFailed });
            process.exit(99);
          }
        } else {
          consecutiveQueryFailures = 0;
        }
        batchFailed++;
        totalFailed++;
        console.error(`  ✗ Error: ${err.message}`);
      }
    }

    totalProcessed += products.length;
    offset += products.length;
    
    // Batch summary
    console.log(`\n----- Batch ${batchNum} Complete -----`);
    console.log(`Assigned: ${batchAssigned}, Failed: ${batchFailed}`);
    
    // Save after each batch
    saveJson(SEED_PATH, categories);
    saveJson(MAPPINGS_PATH, goofishMappings);
    saveProgress({ lastOffset: offset, totalProcessed, totalAssigned, totalCreated, totalFailed });
    console.log(`[Resume] Progress saved. Offset: ${offset}`);
    } catch (batchError) {
      console.error(`[Batch ${batchNum}] Error processing batch: ${batchError.message}`);
      console.error(`[Batch ${batchNum}] Saving progress and restarting script...`);
      saveJson(SEED_PATH, categories);
      saveJson(MAPPINGS_PATH, goofishMappings);
      saveProgress({ lastOffset: offset, totalProcessed, totalAssigned, totalCreated, totalFailed });
      console.log(`[Batch ${batchNum}] Progress saved. Offset: ${offset}`);
      console.log(`[Batch ${batchNum}] Exiting with restart code...`);
      process.exit(99);
    }
  }

  // Final save
  saveJson(SEED_PATH, categories);
  saveJson(MAPPINGS_PATH, goofishMappings);
  // Delete progress file when complete
  if (fs.existsSync(PROGRESS_PATH)) {
    fs.unlinkSync(PROGRESS_PATH);
    console.log('[Resume] Progress file deleted — all products processed');
  }

  console.log('\n========== FINAL SUMMARY ==========');
  console.log(`Total batches: ${batchNum - 1}`);
  console.log(`Total products processed: ${totalProcessed}`);
  console.log(`Total categories assigned: ${totalAssigned}`);
  console.log(`Total new categories created: ${totalCreated}`);
  console.log(`Total failed: ${totalFailed}`);
  console.log(`Total categories now: ${categories.length}`);
  console.log(`Total Goofish mappings: ${Object.keys(goofishMappings).length}`);
  console.log('\nFiles saved:');
  console.log(`  - ${SEED_PATH}`);
  console.log(`  - ${MAPPINGS_PATH}`);

  await prisma.$disconnect();
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('Stack:', reason?.stack || 'No stack');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

main().catch(async (err) => {
  console.error('Fatal error:', err);
  console.error('Stack:', err.stack);
  await prisma.$disconnect();
  process.exit(1);
});
