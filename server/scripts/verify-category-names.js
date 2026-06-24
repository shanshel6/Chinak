import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const prisma = new PrismaClient();
const SEED_PATH = path.join(__dirname, 'canonical-categories.seed.json');
const REPORT_PATH = path.join(__dirname, 'category-name-verification-report.json');
const PROGRESS_PATH = path.join(__dirname, 'category-verification-progress.json');
const API_KEY = process.env.SILICONFLOW_API_KEY;
const MODEL = process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V4-Flash';
const PRODUCTS_PER_CATEGORY = 20;

// Load categories
function loadCategories() {
  try {
    const data = fs.readFileSync(SEED_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save categories
function saveCategories(categories) {
  fs.writeFileSync(SEED_PATH, JSON.stringify(categories, null, 2));
}

// Load report
function loadReport() {
  try {
    const data = fs.readFileSync(REPORT_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save report
function saveReport(report) {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

// Load progress
function loadProgress() {
  try {
    const data = fs.readFileSync(PROGRESS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return { lastIndex: 0 };
  }
}

// Save progress
function saveProgress(lastIndex) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ lastIndex }, null, 2));
}

// Get products for a category
async function getProductsForCategory(categorySlug, limit = PRODUCTS_PER_CATEGORY) {
  try {
    return await withRetry(
      () => prisma.$queryRawUnsafe(`
        SELECT 
          id,
          name,
          "purchaseUrl",
          "aiMetadata"
        FROM "Product"
        WHERE "isActive" = true
          AND status = 'PUBLISHED'
          AND "aiMetadata"->>'categorySlug' = $1
        ORDER BY id DESC
        LIMIT $2
      `, categorySlug, limit),
      `fetch products for category ${categorySlug}`,
      1,
      3000,
      0
    );
  } catch (error) {
    console.error(`Error fetching products for category ${categorySlug}:`, error.message);
    throw error;
  }
}

// Update category in all products
async function updateCategoryInProducts(oldSlug, newSlug, newNameAr, newNameEn) {
  try {
    const timestamp = new Date().toISOString();

    // If slug changed, update categorySlug
    if (oldSlug !== newSlug) {
      const result = await withRetry(
        () => prisma.$executeRawUnsafe(`
          UPDATE "Product"
          SET "aiMetadata" = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE("aiMetadata", '{}'::jsonb),
                  '{categorySlug}',
              $1::jsonb
                ),
                '{categoryNameAr}',
                $2::jsonb
              ),
              '{categoryNameEn}',
              $3::jsonb
            ),
            '{categoryUpdatedAt}',
            $4::jsonb
          )
          WHERE "isActive" = true
            AND status = 'PUBLISHED'
            AND "aiMetadata"->>'categorySlug' = $5
        `, JSON.stringify(newSlug), JSON.stringify(newNameAr), JSON.stringify(newNameEn), JSON.stringify(timestamp), oldSlug),
        `update products category ${oldSlug} -> ${newSlug}`,
        3,
        10000,
        1000
      );

      console.log(`  Updated ${result} products with new slug and name`);
      return result;
    } else {
      // If only name changed, update just the names
      const result = await withRetry(
        () => prisma.$executeRawUnsafe(`
          UPDATE "Product"
          SET "aiMetadata" = jsonb_set(
            jsonb_set(
              jsonb_set(
                COALESCE("aiMetadata", '{}'::jsonb),
                '{categoryNameAr}',
                $1::jsonb
              ),
              '{categoryNameEn}',
                $2::jsonb
            ),
            '{categoryUpdatedAt}',
            $3::jsonb
          )
          WHERE "isActive" = true
            AND status = 'PUBLISHED'
            AND "aiMetadata"->>'categorySlug' = $4
        `, JSON.stringify(newNameAr), JSON.stringify(newNameEn), JSON.stringify(timestamp), oldSlug),
        `update products name for ${oldSlug}`,
        3,
        10000,
        1000
      );

      console.log(`  Updated ${result} products with new name (slug unchanged)`);
      return result;
    }
  } catch (error) {
    console.error(`Error updating products for category ${oldSlug}:`, error.message);
    throw error;
  }
}

// Call AI to verify category name
async function verifyCategoryNameWithAI(category, products) {
  if (!API_KEY) {
    console.warn('[AI] No SILICONFLOW_API_KEY found, skipping AI verification');
    return null;
  }

  if (products.length === 0) {
    console.warn(`[AI] No products found for category ${category.slug}, skipping`);
    return null;
  }

  // Build product context
  const productContext = products.slice(0, PRODUCTS_PER_CATEGORY).map((p, i) => {
    const aiMetadata = typeof p.aiMetadata === 'string' ? JSON.parse(p.aiMetadata) : (p.aiMetadata || {});
    return `Product ${i + 1}:
  Name: ${p.name}
  Description: ${aiMetadata.translatedDescription || aiMetadata.description || 'N/A'}
  Original Title: ${aiMetadata.originalTitle || 'N/A'}`;
  }).join('\n\n');

  const prompt = `You are a category expert for an e-commerce platform. I need you to verify if the current category name is correct based on the products in this category.

Current Category:
- Slug: ${category.slug}
- Arabic Name: ${category.name_ar}
- English Name: ${category.name_en}

Products in this category (${products.length} products):
${productContext}

Analyze these products and determine:
1. Is the current category name accurate for these products? (yes/no)
2. If not, what would be a BETTER category name?
3. Provide your answer in this exact JSON format:
{
  "is_accurate": true/false,
  "confidence": "high/medium/low",
  "suggested_slug": "snake_case_english_name" (only if not accurate),
  "suggested_name_ar": "Arabic translation" (only if not accurate),
  "suggested_name_en": "English name" (only if not accurate),
  "reason": "brief explanation"
}

If the current name is accurate, set "is_accurate" to true and leave the suggested fields empty.
Respond ONLY with the JSON object, no other text.`;

  try {
    const response = await fetch('https://api.siliconflow.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are an e-commerce category expert. Always respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI did not return valid JSON');
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error(`[AI] Error verifying category ${category.slug}:`, error.message);
    return null;
  }
}

// Database connection check with retry
async function checkDatabaseConnection(maxRetries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await prisma.$connect();
      await prisma.$queryRawUnsafe('SELECT 1');
      console.log('Database connection successful');
      await prisma.$disconnect();
      return true;
    } catch (error) {
      console.error(`Database connection attempt ${attempt}/${maxRetries} failed: ${error.message}`);
      if (attempt < maxRetries) {
        console.log(`Retrying in ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
}

// Check if error is retryable
function isRetryableDbError(error) {
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  return msg.includes('Timed out fetching a new connection from the connection pool')
    || msg.includes("Can't reach database server")
    || msg.includes('timed out after')
    || msg.includes('Server has closed the connection')
    || msg.includes('Engine is not yet connected')
    || code === 'P2024'
    || code === 'P2028'
    || code === 'P1017'
    || code === 'P1001';
}

// Quick database recovery
async function recoverDbConnectionQuick(label) {
  try {
    await prisma.$disconnect();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await prisma.$connect();
    await prisma.$queryRawUnsafe('SELECT 1');
    console.warn(`[DB Recovery] Reconnected successfully for ${label}`);
    return true;
  } catch (error) {
    console.warn(`[DB Recovery] Failed to reconnect for ${label}: ${error.message}`);
    return false;
  }
}

// Wrapper with retry logic
async function withRetry(run, label, retries = 5, timeoutMs = 60000, backoffMs = 1500) {
  let lastError;
  for (let i = 1; i <= retries; i++) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      );
      return await Promise.race([run(), timeoutPromise]);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableDbError(error);
      if (!retryable || i === retries) break;
      console.warn(`${label} failed (attempt ${i}/${retries}), retrying... ${error.message}`);
      const recovered = await recoverDbConnectionQuick(label);
      if (!recovered) {
        lastError = new Error(`db recovery failed for ${label}`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

// Main function
async function main() {
  console.log('========================================');
  console.log('  CATEGORY NAME VERIFICATION');
  console.log('========================================\n');

  // Check database connection first
  console.log('Checking database connection...');
  const dbConnected = await checkDatabaseConnection(3, 2000);
  if (!dbConnected) {
    console.error('ERROR: Cannot connect to database. Please check your connection and try again.');
    process.exit(99);
  }
  console.log();

  const categories = loadCategories();
  console.log(`Loaded ${categories.length} categories from seed file\n`);

  if (!API_KEY) {
    console.error('ERROR: SILICONFLOW_API_KEY not set in .env file');
    console.log('Please add your API key to .env file before running this script');
    process.exit(99);
  }

  const report = loadReport();
  const progress = loadProgress();
  let verifiedCount = progress.lastIndex;
  let updatedCount = 0;
  let skippedCount = 0;

  // Resume from last verified category
  console.log(`Resuming from category ${verifiedCount + 1}/${categories.length}\n`);

  for (let i = verifiedCount; i < categories.length; i++) {
    const category = categories[i];
    verifiedCount = i + 1;
    console.log(`[${verifiedCount}/${categories.length}] Verifying category: ${category.slug} (${category.name_ar})`);

    try {
      // Get products for this category
      const products = await getProductsForCategory(category.slug);
      console.log(`  Found ${products.length} products with this category`);

      if (products.length === 0) {
        console.log(`  Skipping - no products found\n`);
        skippedCount++;
        saveProgress(i);
        continue;
      }

      // Verify with AI
      console.log(`  Running AI verification...`);
      const aiResult = await verifyCategoryNameWithAI(category, products);

      if (!aiResult) {
        console.log(`  AI verification failed, skipping\n`);
        skippedCount++;
        saveProgress(i);
        continue;
      }

      console.log(`  AI Result: is_accurate=${aiResult.is_accurate}, confidence=${aiResult.confidence}`);
      console.log(`  AI suggested slug: ${aiResult.suggested_slug}`);
      console.log(`  AI suggested name_ar: ${aiResult.suggested_name_ar}`);
      console.log(`  AI suggested name_en: ${aiResult.suggested_name_en}`);

      if (aiResult.is_accurate) {
        console.log(`  Category name is accurate, no change needed\n`);
        report.push({
          slug: category.slug,
          old_name_ar: category.name_ar,
          old_name_en: category.name_en,
          new_name_ar: category.name_ar,
          new_name_en: category.name_en,
          changed: false,
          confidence: aiResult.confidence,
          reason: aiResult.reason,
          products_analyzed: products.length,
          products_updated: 0
        });
      } else {
        console.log(`  Suggested new name: ${aiResult.suggested_name_en} (${aiResult.suggested_name_ar})`);
        console.log(`  Reason: ${aiResult.reason}`);

        const oldSlug = category.slug;
        const oldNameAr = category.name_ar;
        const oldNameEn = category.name_en;

        // Update category
        console.log(`  Updating category in memory...`);
        category.slug = aiResult.suggested_slug || category.slug;
        category.name_ar = aiResult.suggested_name_ar || category.name_ar;
        category.name_en = aiResult.suggested_name_en || category.name_en;
        category.verified_at = new Date().toISOString();
        console.log(`  Updated category: slug=${category.slug}, name_ar=${category.name_ar}, name_en=${category.name_en}`);

        // Skip database updates during verification (will be done in bulk later)
        updatedCount++;
        console.log(`  Category updated in seed file (database update skipped - will be done in bulk later)\n`);

        report.push({
          slug: category.slug,
          old_name_ar: oldNameAr,
          old_name_en: oldNameEn,
          new_name_ar: category.name_ar,
          new_name_en: category.name_en,
          changed: true,
          confidence: aiResult.confidence,
          reason: aiResult.reason,
          products_analyzed: products.length,
          products_updated: 0
        });
      }

      // Save report, categories, and progress periodically
      if (verifiedCount % 10 === 0) {
        saveReport(report);
        saveCategories(categories);
        saveProgress(i);
        console.log(`[Progress] Report, categories, and progress saved (${verifiedCount}/${categories.length} verified)\n`);
      }
    } catch (error) {
      console.error(`Error processing category ${category.slug}:`, error.message);
      console.error(`  Saving progress and restarting from category ${verifiedCount}...\n`);
      saveReport(report);
      saveCategories(categories);
      saveProgress(i);
      process.exit(99);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Save final results
  saveCategories(categories);
  saveReport(report);
  saveProgress(categories.length); // Mark as complete

  console.log('\n========================================');
  console.log('  VERIFICATION COMPLETE');
  console.log('========================================');
  console.log(`Total categories: ${categories.length}`);
  console.log(`Verified: ${verifiedCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Report saved to: ${REPORT_PATH}`);
  console.log(`Categories saved to: ${SEED_PATH}\n`);

  await prisma.$disconnect();
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error('Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
})();
