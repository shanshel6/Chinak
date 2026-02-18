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
// CHANGED: Default to FALSE to prevent "hanging" if no proxy is running
if (process.env.USE_AI_PROXY === 'true') {
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
    if (process.env.HUGGINGFACE_API_KEY) {
      hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
    } else {
      hf = null;
    }
  }
  
  if (!siliconflow) {
    if (process.env.SILICONFLOW_API_KEY) {
      siliconflow = new OpenAI({
        baseURL: "https://api.siliconflow.cn/v1",
        apiKey: process.env.SILICONFLOW_API_KEY,
      });
      // Monkey-patch baseURL for detection later
      siliconflow.baseURL = "https://api.siliconflow.cn/v1";
      console.log(`[AI Debug] SiliconFlow initialized (OpenAI-compatible)`);
    } else if (process.env.DEEPINFRA_API_KEY) {
      // Fallback to DeepInfra if SiliconFlow is not set
      siliconflow = new OpenAI({
        baseURL: "https://api.deepinfra.com/v1/openai",
        apiKey: process.env.DEEPINFRA_API_KEY,
      });
      // Monkey-patch baseURL for detection later (OpenAI client might hide it)
      siliconflow.baseURL = "https://api.deepinfra.com/v1/openai";
      console.log(`[AI Debug] DeepInfra initialized (OpenAI-compatible)`);
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
  const targetDim = 384;
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

  const normalizeVector = (vector) => {
    if (!Array.isArray(vector)) {
      throw new Error('Invalid embedding vector');
    }
    const numeric = vector.map((n) => Number(n));
    if (numeric.some((n) => !Number.isFinite(n))) {
      throw new Error('Embedding vector contains non-numeric values');
    }
    if (numeric.length === targetDim) return numeric;
    if (numeric.length > targetDim) return numeric.slice(0, targetDim);
    return numeric.concat(new Array(targetDim - numeric.length).fill(0));
  };

  const { hf, siliconflow } = getClients();
  const maxAttempts = 5;

  const generateWithSiliconFlow = async () => {
    if (!siliconflow) return null;
    
    // Check if we are using DeepInfra
    const isDeepInfra = siliconflow.baseURL === "https://api.deepinfra.com/v1/openai";
    
    // Use user-requested model for DeepInfra or fallback to env/default
    let model = process.env.SILICONFLOW_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-0.6B';
    
    if (isDeepInfra) {
        model = process.env.DEEPINFRA_EMBEDDING_MODEL || 'google/embeddinggemma-300m';
    }
    
    console.log(`[AI Debug] Generating embedding with model: ${model} (Provider: ${isDeepInfra ? 'DeepInfra' : 'SiliconFlow'})`);

    const rawDimensions = process.env.SILICONFLOW_EMBEDDING_DIMENSIONS;
    const dimensions = rawDimensions !== undefined && rawDimensions !== null && rawDimensions !== '' ? Number(rawDimensions) : undefined;

    const payload = { model, input: text };
    
    // DeepInfra might not support 'dimensions' parameter for this model, or it might be fixed.
    // Only send dimensions if not using DeepInfra or if explicitly tested.
    // For now, let's omit dimensions for DeepInfra to be safe unless we know it's supported.
    if (!isDeepInfra && Number.isFinite(dimensions) && dimensions > 0) {
      payload.dimensions = dimensions;
    }

    const response = await siliconflow.embeddings.create(payload);
    const embedding = response?.data?.[0]?.embedding;
    return normalizeVector(embedding);
  };

  const generateWithHuggingFace = async () => {
    if (!hf) {
      throw new Error('HUGGINGFACE_API_KEY is not defined in environment variables');
    }
    const response = await hf.featureExtraction({
      model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      inputs: text,
    });

    let result = response;
    if (Array.isArray(result) && Array.isArray(result[0])) {
      result = result[0];
    }
    return normalizeVector(result);
  };

  const tryGenerate = async (fn) => {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const embedding = await fn();
        if (embedding) return embedding;
        return null;
      } catch (error) {
        lastErr = error;
        if (!shouldRetry(error) || attempt === maxAttempts) break;
        const base = Math.min(30000, 1000 * (2 ** (attempt - 1)));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(base + jitter);
      }
    }
    throw lastErr;
  };

  if (siliconflow) {
    try {
      const embedding = await tryGenerate(generateWithSiliconFlow);
      if (embedding) return embedding;
    } catch (err) {
      if (!hf) throw err;
    }
  }

  return tryGenerate(generateWithHuggingFace);
}

export async function processProductEmbedding(productId) {
  try {
    console.log(`[AI Debug] Starting embedding-only processing for product ${productId}`);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, specs: true, image: true }
    });

    if (!product) {
      console.error(`[AI Debug] Product ${productId} not found`);
      return;
    }

    const content = `Title: ${product.name}\nSpecs: ${product.specs || ''}\nMain Image URL: ${product.image || ''}`;
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
    if (process.env.NODE_ENV !== 'production' && !error.message.includes('API_KEY is not defined')) {
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
  const withTimeout = (promise, ms) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);
  };

  try {
    // 1. Try Vision AI first (Moderate Accuracy)
    if (product.image) {
      console.log(`[AI Debug] Attempting Vision AI for ${product.name}...`);
      try {
        const visionResult = await withTimeout(visionAnalyzeImage(product.image, product.name), 10000);
        if (visionResult && (visionResult.weight || visionResult.length)) {
          console.log(`[AI Debug] Vision AI success for ${product.name}`);
          return {
            weight: parseFloat(visionResult.weight) || 0.5,
            length: parseFloat(visionResult.length) || 10,
            width: parseFloat(visionResult.width) || 10,
            height: parseFloat(visionResult.height) || 10
          };
        }
      } catch (visionErr) {
        console.warn(`[AI Debug] Vision AI failed or timed out: ${visionErr.message}`);
      }
    }

    // 3. Fallback to Text-based estimation (DeepSeek)
    console.log(`[AI Debug] Falling back to text-based estimation for ${product.name}...`);
    const { siliconflow } = getClients();
    
    if (!siliconflow) {
        console.warn('[AI Debug] SiliconFlow client not initialized. Skipping text-based estimation.');
        return null;
    }

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

    const response = await withTimeout(siliconflow.chat.completions.create({
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    }), 15000);

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

    const content = `Title: ${product.name}\nSpecs: ${product.specs || ''}\nMain Image URL: ${product.image || ''}`;
    
    let aiMetadata = null;
    if (!product.aiMetadata && siliconflow) {
      const prompt = `You are an AI specialized in e-commerce product analysis for the Middle Eastern market, specifically Iraq. 
      Analyze the product details and image to extract 'Invisible Tags' and search synonyms.
      
      Product Details:
      Title: ${product.name}
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
    
    // Use raw SQL to update the vector field
    const vectorStr = `[${embedding.join(',')}]`;
    const query = `
      UPDATE "Product" 
      SET "aiMetadata" = CASE WHEN "aiMetadata" IS NULL THEN $1::jsonb ELSE "aiMetadata" END,
          "embedding" = $2::vector 
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
  
  let normalized = text
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

  // Iraqi Dialect Expansions (Common Synonyms)
  // When user searches for X, we also want to search for Y (Arabic + English)
  const synonyms = {
    // Furniture
    'ميز': 'طاوله مكتب desk table',
    'جربايه': 'سرير bed',
    'قنفه': 'اريكه كنبه sofa couch',
    'برده': 'ستاره curtain',
    'بنكه': 'مروحه fan',
    'ثلاجه': 'براد refrigerator fridge',
    'مجمد': 'فريزر freezer',
    'طباخ': 'فرن غاز stove oven',
    'كاونتر': 'خزانه مطبخ kitchen cabinet',
    'دوشك': 'مرتبه mattress',
    'شرشف': 'مفرش غطاء sheet cover',
    'كرسي': 'chair',
    'مكتب': 'desk office',
    
    // Clothing / Accessories
    'خاولي': 'منشفه towel',
    'تراكي': 'اقراط حلق earrings',
    'سوار': 'اسواره bracelet',
    'جنطه': 'حقيبه bag backpack',
    'قاط': 'بدله suit',
    'دشداشه': 'جلابيه ثوب dress robe',
    'حذاء': 'بوط جزم shoes boots',
    'نعال': 'شبشب slippers',
    'شحاطه': 'صندل sandals',
    'كلاو': 'قبعه hat cap',
    'تيشيرت': 't-shirt shirt',
    'قميص': 'shirt',
    'بنطلون': 'pants trousers jeans',
    'فستان': 'dress',
    'تنوره': 'skirt',
    
    // Electronics
    'بايدر': 'دراجه bike bicycle',
    'سياره': 'عربه car',
    'تلفزيون': 'شاشه tv television monitor',
    'موبايل': 'هاتف جوال mobile phone',
    'لابتوب': 'حاسوب كمبيوتر laptop computer',
    'شاحنه': 'charger',
    'سماعه': 'headphone speaker headset',
    'كاميرا': 'camera',

    // General
    'نساء': 'women woman female ladies',
    'نسائي': 'women woman female ladies',
    'رجال': 'men man male',
    'رجالي': 'men man male',
    'اطفال': 'kids children',
    'ولادي': 'boys',
    'بناتي': 'girls',
  };

  // Check if any word in the query matches a dialect word
  const words = normalized.split(/\s+/);
  const expandedGroups = words.map(word => {
    if (synonyms[word]) {
      return [word, ...synonyms[word].split(' ')];
    }
    return [word];
  });
  
  return {
    fullString: expandedGroups.map(g => g.join(' ')).join(' '),
    groups: expandedGroups
  };
}

/**
 * Hybrid Search Engine (Free Tier)
 * Combines Keyword Matching and Semantic Vector Search.
 */
export async function hybridSearch(query, limit = 50, skip = 0, maxPrice = null, userId = null, sessionId = null) {
  try {
    const { fullString: normalizedQuery, groups: queryGroups } = normalizeArabic(query);
    
    // 1. Generate query embedding (384 dimensions)
    const embedding = await generateEmbedding(query);
    const queryVector = `[${embedding.join(',')}]`;

    // 2. Perform Hybrid Search
    // Weighted Ranking:
    // 30% Keyword Relevance (with Arabic support)
    // 40% Semantic Similarity
    // 20% Popularity
    // 10% Personalization (if userId/sessionId provided)
    
    // Build price filter
    const priceFilter = maxPrice !== null ? `AND p.price <= ${maxPrice}` : '';
    const semanticPriceFilter = maxPrice !== null ? `AND price <= ${maxPrice}` : '';
    const keywordPriceFilter = maxPrice !== null ? `AND price <= ${maxPrice}` : '';

    // 1. Build Match Count SQL (How many Groups matched?)
    // A group matches if ANY word in the group is present
    const matchCountSql = queryGroups.length > 0 ? queryGroups.map(group => {
      const groupConditions = group.map(w => `name ILIKE '%${w}%' OR "aiMetadata"::text ILIKE '%${w}%'`).join(' OR ');
      return `(CASE WHEN ${groupConditions} THEN 1 ELSE 0 END)`;
    }).join(' + ') : '0';

    // 2. Build Word Score SQL (Weighted score per word in original query)
    // We prioritize the user's original words, but also give some points for synonyms
    const wordScores = queryGroups.flat().map(w => `
      (CASE WHEN name ILIKE '%${w}%' THEN 0.5 ELSE 0.0 END) +
      (CASE WHEN "aiMetadata"::text ILIKE '%${w}%' THEN 0.3 ELSE 0.0 END)
    `).join(' + ');
    
    const wordScoreSql = wordScores ? `+ (${wordScores})` : '';

    // 3. Build Filter Conditions (OR logic for recall)
    const allWords = queryGroups.flat();
    const wordFilters = allWords.map(w => `(name ILIKE '%${w}%' OR "aiMetadata"::text ILIKE '%${w}%')`).join(' OR ');
    const keywordCondition = wordFilters ? `OR (${wordFilters})` : '';

    // 4. Build Personalization Score SQL
    let personalizationSql = '0';
    let personalizationJoin = '';
    
    if (userId || sessionId) {
      const userCondition = userId ? `userId = ${userId}` : `sessionId = '${sessionId}'`;
      // Boost products that the user has interacted with (viewed, cart, purchased)
      // or similar products (same category/tags) - simplified here to direct interaction
      personalizationJoin = `
        LEFT JOIN (
          SELECT "productId", SUM(weight) as interaction_score 
          FROM "UserInteraction" 
          WHERE ${userCondition} 
          GROUP BY "productId"
        ) ui ON p.id = ui."productId"
      `;
      personalizationSql = 'COALESCE(ui.interaction_score, 0)';
    }

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
            -- Exact phrase match gets huge boost
            (CASE WHEN name ILIKE $2 OR name ILIKE $3 THEN 3.0 ELSE 0.0 END) +
            (CASE WHEN "aiMetadata"::text ILIKE $2 OR "aiMetadata"::text ILIKE $3 THEN 2.0 ELSE 0.0 END)
            ${wordScoreSql}
          ) as keyword_score,
          (${matchCountSql}) as match_count
        FROM "Product"
        WHERE 
          ("isActive" = true AND status = 'PUBLISHED') ${keywordPriceFilter} AND
          (name ILIKE $2 OR name ILIKE $3 OR 
          "aiMetadata"::text ILIKE $2 OR "aiMetadata"::text ILIKE $3 ${keywordCondition})
        LIMIT 100
      )
      SELECT 
        p.id, p.name, p.price, p."basePriceIQD",
        p.image, p."purchaseUrl", p.status, p."isFeatured", 
        p."isActive", p.specs, 
        p."createdAt", p."updatedAt", p."aiMetadata", 
        p."deliveryTime", p."domesticShippingFee",
        COALESCE(s.semantic_score, 0) as semantic_score,
        COALESCE(k.keyword_score, 0) as keyword_score,
        COALESCE(k.match_count, 0) as match_count,
        ${personalizationSql} as personal_score,
        (
          -- Semantic Score (35%)
          0.35 * COALESCE(s.semantic_score, 0) + 
          -- Keyword Score (35%)
          0.35 * COALESCE(k.keyword_score, 0) + 
          -- Popularity (15%)
          0.15 * (1 - 1/(1 + (0.1 + 0.9))) +
          -- Personalization (15%) - Boosts items user has interacted with
          0.15 * (1 - 1/(1 + ${personalizationSql}))
        ) * (
          -- Boost if ALL Token Groups matched (e.g. "Women" AND "Shirts")
          CASE 
            WHEN COALESCE(k.match_count, 0) >= ${queryGroups.length} THEN 2.0 
            WHEN COALESCE(k.match_count, 0) > 0 THEN 1.0
            ELSE 0.5 
          END
        ) as final_rank
      FROM "Product" p
      LEFT JOIN semantic_search s ON p.id = s.id
      LEFT JOIN keyword_search k ON p.id = k.id
      ${personalizationJoin}
      WHERE (s.id IS NOT NULL OR k.id IS NOT NULL) AND p."isActive" = true AND p.status = 'PUBLISHED' ${priceFilter}
      ORDER BY final_rank DESC
      LIMIT ${limit}
      OFFSET ${skip}
    `, queryVector, `%${query}%`, `%${normalizedQuery}%`);

    // Fetch variants for the found products to ensure accurate pricing
    const productIds = results.map(r => Number(r.id));
    const variants = await prisma.productVariant.findMany({
      where: { productId: { in: productIds } },
      select: {
        id: true,
        productId: true,
        combination: true,
        price: true,
        basePriceRMB: true,
        weight: true,
        length: true,
        width: true,
        height: true,
        isPriceCombined: true,
        image: true
      }
    });

    const variantsMap = variants.reduce((acc, v) => {
      if (!acc[v.productId]) acc[v.productId] = [];
      acc[v.productId].push(v);
      return acc;
    }, {});

    return results.map(p => ({
      ...p,
      id: Number(p.id),
      variants: variantsMap[Number(p.id)] || [],
      semantic_score: p.semantic_score,
      keyword_score: p.keyword_score,
      final_rank: p.final_rank
    }));
  } catch (error) {
    console.error('Free-tier hybrid search failed:', error);
    throw error;
  }
}
