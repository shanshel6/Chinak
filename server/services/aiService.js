import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { HfInference } from '@huggingface/inference';
import OpenAI from 'openai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import prisma from '../prismaClient.js';

// Setup the proxy dispatcher globally for undici (used by native fetch in Node 18+)
// Only use proxy in local development if explicitly requested via environment variable
if (process.env.USE_AI_PROXY === 'true' || (process.env.NODE_ENV !== 'production' && !process.env.RENDER)) {
  const proxyUrl = process.env.AI_PROXY_URL || 'http://127.0.0.1:7890';
  console.log(`[AI Debug] Using proxy for AI services: ${proxyUrl}`);
  const agent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(agent);
} else {
  console.log('[AI Debug] Connecting to AI services directly (no proxy)');
}

// Initialize clients lazily
let hf = null;
let siliconflow = null;

function getClients() {
  if (!hf) {
    if (!process.env.HUGGINGFACE_API_KEY) {
      throw new Error('HUGGINGFACE_API_KEY is not defined in environment variables');
    }
    hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
  }
  
  if (!siliconflow) {
    if (!process.env.SILICONFLOW_API_KEY) {
        // Fallback or warning if key is missing
        console.warn('[AI Debug] SILICONFLOW_API_KEY is missing. AI features will fail.');
    }
    siliconflow = new OpenAI({
      baseURL: "https://api.siliconflow.cn/v1",
      apiKey: process.env.SILICONFLOW_API_KEY,
      // No proxy needed for SiliconFlow in China, but OpenAI SDK uses global fetch
    });
    console.log(`[AI Debug] SiliconFlow initialized (OpenAI-compatible)`);
  }
  
  return { hf, siliconflow };
}

/**
 * Generate Embeddings using Hugging Face (Free Tier)
 * Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (384 dimensions)
 * This model is optimized for 50+ languages including Arabic.
 */
async function generateEmbedding(text) {
  try {
    const { hf } = getClients();
    const response = await hf.featureExtraction({
      model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      inputs: text,
    });
    // MiniLM returns a 1D array of 384 floats, but sometimes it's nested
    let result = response;
    if (Array.isArray(result) && Array.isArray(result[0])) {
      result = result[0];
    }
    return result;
  } catch (error) {
    console.error('Hugging Face embedding failed:', error);
    throw error;
  }
}

/**
 * Auto-Tagging Pipeline using SiliconFlow (Free/Low-cost Tier)
 * Triggers when a product is added or updated.
 */
export async function processProductAI(productId) {
  try {
    console.log(`[AI Debug] Starting processing for product ${productId}`);
    const { hf, siliconflow } = getClients();
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      console.error(`[AI Debug] Product ${productId} not found`);
      return;
    }

    const content = `Title: ${product.name}\nDescription: ${product.description || ''}\nSpecs: ${product.specs || ''}\nMain Image URL: ${product.image || ''}`;
    
    // 1. Extract Tags and Synonyms using SiliconFlow (DeepSeek-V3)
    const prompt = `You are an AI specialized in e-commerce product analysis for the Middle Eastern market, specifically Iraq. 
    Analyze the product details and image to extract 'Invisible Tags' and search synonyms.
    
    Product Details:
    Title: ${product.name}
    Description: ${product.description || ''}
    Specs: ${product.specs || ''}
    
    Return ONLY a valid JSON object with:
    1. 'extracted_tags': Array of strings representing style (e.g., modern, classic), occasion (e.g., wedding, office), material (e.g., silk, cotton), and target audience (e.g., kids, professionals).
    2. 'synonyms': Array of strings representing how users might search for this in Arabic, English, and Iraqi dialect (e.g., if it's a 'refrigerator', include 'ثلاجة', 'مبردة', 'براد').
    3. 'category_suggestion': A string suggesting the best category for this product.

    Do not include markdown formatting or extra text.`;

    console.log(`[AI Debug] Calling SiliconFlow for product ${productId}...`);
    
    const response = await siliconflow.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-V3', // Fast, cheap, and extremely capable
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });

    const responseText = response.choices[0].message.content.trim();
    console.log(`[AI Debug] SiliconFlow response for product ${productId}: ${responseText}`);
    
    let aiMetadata;
    try {
      // Clean potential markdown and parse JSON
      const cleanJson = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      aiMetadata = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error(`[AI Debug] JSON Parse Error for product ${productId}:`, parseError.message);
      // Fallback metadata
      aiMetadata = { extracted_tags: [], synonyms: [] };
    }

    // 2. Generate Embedding (384 dimensions) using Hugging Face
    console.log(`[AI Debug] Generating embedding for product ${productId}...`);
    const embedding = await generateEmbedding(content);

    // 3. Update Product in Database
    console.log(`[AI Debug] Saving AI metadata and embedding for product ${productId}...`);
    
    // Use raw SQL to update the vector field
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRaw`
      UPDATE "Product" 
      SET "aiMetadata" = ${JSON.stringify(aiMetadata)}::jsonb, 
          "embedding" = ${vectorStr}::vector 
      WHERE "id" = ${productId}
    `;

    console.log(`[AI Debug] Successfully processed product ${productId}`);
    return aiMetadata;
  } catch (error) {
    console.error(`[AI Debug] Error processing product ${productId}:`, error.message);
    throw error;
  }
}

/**
 * Arabic and Iraqi Dialect Normalization
 */
function normalizeArabic(text) {
  if (!text) return '';
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ق') // Iraqi dialect: G -> Q
    .replace(/چ/g, 'ج') // Iraqi dialect: CH -> J
    .replace(/پ/g, 'ب') // P -> B
    .replace(/ڤ/g, 'ف') // V -> F
    .trim();
}

/**
 * Hybrid Search Engine (Free Tier)
 * Combines Keyword Matching and Semantic Vector Search.
 */
export async function hybridSearch(query, limit = 50, skip = 0, maxPrice = null) {
  try {
    const normalizedQuery = normalizeArabic(query);
    
    // 1. Generate query embedding (384 dimensions)
    const embedding = await generateEmbedding(query);
    const queryVector = `[${embedding.join(',')}]`;

    // 2. Perform Hybrid Search
    // Weighted Ranking:
    // 30% Keyword Relevance (with Arabic support)
    // 40% Semantic Similarity
    // 30% Popularity/Personalization
    
    // Build price filter
    const priceFilter = maxPrice !== null ? `AND p.price <= ${maxPrice}` : '';
    const semanticPriceFilter = maxPrice !== null ? `AND price <= ${maxPrice}` : '';
    const keywordPriceFilter = maxPrice !== null ? `AND price <= ${maxPrice}` : '';

    // Split query into words for better keyword matching
    const queryWords = query.split(/\s+/).filter(w => w.length > 2);
    const wordFilters = queryWords.map(w => `(name ILIKE '%${w}%' OR description ILIKE '%${w}%' OR "aiMetadata"::text ILIKE '%${w}%')`).join(' OR ');
    const keywordCondition = wordFilters ? `OR (${wordFilters})` : '';
    
    // Case statement for word matches
    const wordScores = queryWords.map(w => `
      (CASE WHEN name ILIKE '%${w}%' THEN 0.5 ELSE 0.0 END) +
      (CASE WHEN description ILIKE '%${w}%' THEN 0.2 ELSE 0.0 END) +
      (CASE WHEN "aiMetadata"::text ILIKE '%${w}%' THEN 0.3 ELSE 0.0 END)
    `).join(' + ');
    const wordScoreSql = wordScores ? `+ (${wordScores})` : '';

    const results = await prisma.$queryRawUnsafe(`
      WITH semantic_search AS (
        SELECT 
          id,
          1 - (embedding <=> $1::vector) as semantic_score
        FROM "Product"
        WHERE embedding IS NOT NULL AND "isActive" = true AND status = 'PUBLISHED' ${semanticPriceFilter}
        ORDER BY embedding <=> $1::vector
        LIMIT 100
      ),
      keyword_search AS (
        SELECT 
          id,
          (
            (CASE WHEN name ILIKE $2 OR name ILIKE $3 THEN 1.0 ELSE 0.0 END) +
            (CASE WHEN description ILIKE $2 OR description ILIKE $3 THEN 0.5 ELSE 0.0 END) +
            (CASE WHEN "aiMetadata"::text ILIKE $2 OR "aiMetadata"::text ILIKE $3 THEN 0.8 ELSE 0.0 END)
            ${wordScoreSql}
          ) as keyword_score
        FROM "Product"
        WHERE 
          ("isActive" = true AND status = 'PUBLISHED') ${keywordPriceFilter} AND
          (name ILIKE $2 OR name ILIKE $3 OR 
          description ILIKE $2 OR description ILIKE $3 OR
          "aiMetadata"::text ILIKE $2 OR "aiMetadata"::text ILIKE $3 ${keywordCondition})
        LIMIT 100
      )
      SELECT 
        p.id, p.name, p."chineseName", p.description, p.price, p."basePriceRMB", 
        p.image, p."purchaseUrl", p.status, p."isFeatured", 
        p."isActive", p.specs, p."storeEvaluation", p."reviewsCountShown", 
        p."createdAt", p."updatedAt", p."videoUrl", p."aiMetadata", 
        p."clickCount", p."conversionRate",
        COALESCE(s.semantic_score, 0) as semantic_score,
        COALESCE(k.keyword_score, 0) as keyword_score,
        (
          0.4 * COALESCE(s.semantic_score, 0) + 
          0.3 * COALESCE(k.keyword_score, 0) + 
          0.3 * (1 - 1/(1 + (COALESCE(p."clickCount", 0) * 0.1 + COALESCE(p."conversionRate", 0) * 0.9)))
        ) as final_rank
      FROM "Product" p
      LEFT JOIN semantic_search s ON p.id = s.id
      LEFT JOIN keyword_search k ON p.id = k.id
      WHERE (s.id IS NOT NULL OR k.id IS NOT NULL) AND p."isActive" = true AND p.status = 'PUBLISHED' ${priceFilter}
      ORDER BY final_rank DESC
      LIMIT ${limit}
      OFFSET ${skip}
    `, queryVector, `%${query}%`, `%${normalizedQuery}%`);

    return results.map(p => ({
      ...p,
      id: Number(p.id),
      semantic_score: p.semantic_score,
      keyword_score: p.keyword_score,
      final_rank: p.final_rank
    }));
  } catch (error) {
    console.error('Free-tier hybrid search failed:', error);
    throw error;
  }
}
