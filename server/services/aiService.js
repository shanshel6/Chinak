import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { HfInference } from '@huggingface/inference';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import prisma from '../prismaClient.js';
import axios from 'axios';

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
let genAI = null;

function getClients() {
  if (!hf) {
    if (!process.env.HUGGINGFACE_API_KEY) {
      throw new Error('HUGGINGFACE_API_KEY is not defined in environment variables');
    }
    hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
  }
  
  if (!siliconflow) {
    if (process.env.SILICONFLOW_API_KEY) {
      siliconflow = new OpenAI({
        baseURL: "https://api.siliconflow.cn/v1",
        apiKey: process.env.SILICONFLOW_API_KEY,
      });
      console.log(`[AI Debug] SiliconFlow initialized (OpenAI-compatible)`);
    } else {
      siliconflow = null;
    }
  }

  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[AI Debug] GEMINI_API_KEY is missing. Vision AI will be disabled.');
    } else {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      console.log(`[AI Debug] Gemini AI initialized`);
    }
  }
  
  return { hf, siliconflow, genAI };
}

/**
 * Generate Embeddings using Hugging Face (Free Tier)
 * Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (384 dimensions)
 * This model is optimized for 50+ languages including Arabic.
 */
async function generateEmbedding(text) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const getStatusCode = (err) => {
    if (!err) return null;
    const direct = err.status ?? err.statusCode;
    if (typeof direct === 'number') return direct;
    const respStatus = err.response?.status;
    if (typeof respStatus === 'number') return respStatus;
    const msg = String(err.message || '');
    const match = msg.match(/\b(4\d\d|5\d\d)\b/);
    return match ? Number(match[1]) : null;
  };
  const shouldRetry = (err) => {
    const status = getStatusCode(err);
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  };

  const { hf } = getClients();
  const maxAttempts = 5;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await hf.featureExtraction({
        model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
        inputs: text,
      });

      let result = response;
      if (Array.isArray(result) && Array.isArray(result[0])) {
        result = result[0];
      }
      if (!Array.isArray(result) || result.length !== 384) {
        throw new Error(`Unexpected embedding shape (len=${Array.isArray(result) ? result.length : 'n/a'})`);
      }
      return result;
    } catch (error) {
      lastErr = error;
      if (!shouldRetry(error) || attempt === maxAttempts) break;
      const base = Math.min(30000, 1000 * (2 ** (attempt - 1)));
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }

  console.error('Hugging Face embedding failed:', lastErr);
  throw lastErr;
}

export async function processProductEmbedding(productId) {
  try {
    console.log(`[AI Debug] Starting embedding-only processing for product ${productId}`);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, description: true, specs: true, image: true }
    });

    if (!product) {
      console.error(`[AI Debug] Product ${productId} not found`);
      return;
    }

    const content = `Title: ${product.name}\nDescription: ${product.description || ''}\nSpecs: ${product.specs || ''}\nMain Image URL: ${product.image || ''}`;
    const embedding = await generateEmbedding(content);

    const vectorStr = `[${embedding.join(',')}]`;
    const query = `
      UPDATE "Product"
      SET "embedding" = $1::vector
      WHERE "id" = $2
    `;

    await prisma.$executeRawUnsafe(query, vectorStr, productId);
    console.log(`[AI Debug] Successfully saved embedding for product ${productId}`);
  } catch (error) {
    console.error(`[AI Debug] Embedding-only processing failed for product ${productId}:`, error.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
    throw error;
  }
}

/**
 * Analyze product image using Gemini Vision (Free Tier)
 */
async function visionAnalyzeImage(imageUrl, productName) {
  try {
    const { genAI } = getClients();
    if (!genAI || !imageUrl) return null;

    console.log(`[AI Debug] Analyzing image for ${productName}: ${imageUrl}`);
    
    // Fetch image data
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageParts = [
      {
        inlineData: {
          data: Buffer.from(response.data).toString("base64"),
          mimeType: response.headers["content-type"],
        },
      },
    ];

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analyze this product image: "${productName}". 
    Estimate its physical weight (in kg) and dimensions (length, width, height in cm).
    Look for any visible size markings, scale comparison, or standard product sizes.
    Return ONLY a valid JSON object with:
    { "weight": number, "length": number, "width": number, "height": number }`;

    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = result.response.text();
    const cleanJson = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error('[AI Debug] Vision analysis failed:', error.message);
    return null;
  }
}

/**
 * Estimate weight and dimensions for a product using Vision AI -> Text AI
 */
export async function estimateProductPhysicals(product) {
  try {
    // 1. Try Vision AI first (Moderate Accuracy)
    if (product.image) {
      console.log(`[AI Debug] Attempting Vision AI for ${product.name}...`);
      const visionResult = await visionAnalyzeImage(product.image, product.name);
      if (visionResult && (visionResult.weight || visionResult.length)) {
        console.log(`[AI Debug] Vision AI success for ${product.name}`);
        return {
          weight: parseFloat(visionResult.weight) || 0.5,
          length: parseFloat(visionResult.length) || 10,
          width: parseFloat(visionResult.width) || 10,
          height: parseFloat(visionResult.height) || 10
        };
      }
    }

    // 3. Fallback to Text-based estimation (DeepSeek)
    console.log(`[AI Debug] Falling back to text-based estimation for ${product.name}...`);
    const { siliconflow } = getClients();
    
    const prompt = `Estimate the physical dimensions and weight for the following product.
    Product: ${product.name}
    Description: ${product.description || ''}
    Specs: ${product.specs || ''}
    
    Return ONLY a valid JSON object with:
    1. 'weight': Number (in kg)
    2. 'length': Number (in cm)
    3. 'width': Number (in cm)
    4. 'height': Number (in cm)
    
    Be realistic based on common shipping standards. 
    If you're not sure, provide a reasonable average for that category of product.
    Return ONLY JSON, no markdown.`;

    const response = await siliconflow.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });

    const text = response.choices[0].message.content.trim();
    const cleanJson = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    const data = JSON.parse(cleanJson);
    
    return {
      weight: parseFloat(data.weight) || 0.5,
      length: parseFloat(data.length) || 10,
      width: parseFloat(data.width) || 10,
      height: parseFloat(data.height) || 10
    };
  } catch (error) {
    console.error('[AI Debug] Physical estimation error:', error.message);
    return null;
  }
}

/**
 * Auto-Tagging Pipeline using SiliconFlow (Free/Low-cost Tier)
 * Triggers when a product is added or updated.
 */
export async function processProductAI(productId) {
  try {
    console.log(`[AI Debug] Starting processing for product ${productId}`);
    const { siliconflow } = getClients();
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      console.error(`[AI Debug] Product ${productId} not found`);
      return;
    }

    const content = `Title: ${product.name}\nDescription: ${product.description || ''}\nSpecs: ${product.specs || ''}\nMain Image URL: ${product.image || ''}`;
    
    let aiMetadata = null;
    if (!product.aiMetadata && siliconflow) {
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
        model: 'deepseek-ai/DeepSeek-V3',
        messages: [
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      });
  
      const responseText = response.choices[0].message.content.trim();
      console.log(`[AI Debug] SiliconFlow response for product ${productId}: ${responseText}`);
      
      try {
        const cleanJson = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        aiMetadata = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error(`[AI Debug] JSON Parse Error for product ${productId}:`, parseError.message);
        aiMetadata = { extracted_tags: [], synonyms: [] };
      }
    }

    // 2. Generate Embedding (384 dimensions) using Hugging Face
    console.log(`[AI Debug] Generating embedding for product ${productId}...`);
    const embedding = await generateEmbedding(content);

    // 3. Update Product in Database
    console.log(`[AI Debug] Saving AI metadata and embedding for product ${productId}...`);
    
    // 4. Estimate Physical Dimensions if missing
    let physicalUpdate = '';
    if (!product.weight || !product.length || !product.width || !product.height) {
      console.log(`[AI Debug] Estimating physical dimensions for product ${productId}...`);
      try {
        const physicals = await estimateProductPhysicals({
          name: product.name,
          description: product.description,
          specs: product.specs,
          purchaseUrl: product.purchaseUrl,
          image: product.image
        });
        
        if (physicals) {
          if (!product.weight && physicals.weight) physicalUpdate += `, weight = ${physicals.weight}`;
          if (!product.length && physicals.length) physicalUpdate += `, length = ${physicals.length}`;
          if (!product.width && physicals.width) physicalUpdate += `, width = ${physicals.width}`;
          if (!product.height && physicals.height) physicalUpdate += `, height = ${physicals.height}`;
        }
      } catch (physErr) {
        console.warn(`[AI Debug] Physical estimation failed for product ${productId}:`, physErr.message);
      }
    }

    // Use raw SQL to update the vector field
    const vectorStr = `[${embedding.join(',')}]`;
    const query = `
      UPDATE "Product" 
      SET "aiMetadata" = CASE WHEN "aiMetadata" IS NULL THEN $1::jsonb ELSE "aiMetadata" END,
          "embedding" = $2::vector 
          ${physicalUpdate}
      WHERE "id" = $3
    `;

    console.log(`[AI Debug] Executing database update for product ${productId}...`);
    const aiMetadataParam = aiMetadata === null ? null : JSON.stringify(aiMetadata);
    await prisma.$executeRawUnsafe(query, aiMetadataParam, vectorStr, productId);
    console.log(`[AI Debug] Successfully processed product ${productId}`);
  } catch (error) {
    console.error(`[AI Debug] Critical error in processProductAI for product ${productId}:`, error.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error(error);
    }
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
