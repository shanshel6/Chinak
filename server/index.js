import fs from 'fs';
try { fs.writeFileSync('e:/mynewproject2/server/server_start.log', 'STARTING ' + new Date().toISOString() + '\n'); } catch (e) {}
process.on('uncaughtException', (err) => {
  try { fs.appendFileSync('e:/mynewproject2/server/server_crash.log', `ERROR: ${err.message}\n${err.stack}\n`); } catch (e) {}
});

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import compression from 'compression';
import https from 'https';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import axios from 'axios';
import { MeiliSearch } from 'meilisearch';
import { fileURLToPath } from 'url';
import prisma from './prismaClient.js';
import { processProductAI, processProductEmbedding, hybridSearch, estimateProductPhysicals, normalizeArabic } from './services/aiService.js';
import { buildCategoryIndex } from './services/categoryService.js';
import { calculateOrderShipping, calculateProductShipping, getAdjustedPrice } from './services/shippingService.js';
import { setupLinkCheckerCron, checkAllProductLinks } from './services/linkCheckerService.js';
import { embedImage, analyzeImageObjects, embedImageCrop, embedImageRaw, warmupClipService } from './services/clipService.js';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';

// Setup multer for memory storage (for image uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(1, Number.parseInt(String(process.env.MAX_IMAGE_UPLOAD_BYTES || ''), 10) || 6 * 1024 * 1024)
  }
});

const MAX_IMAGE_BASE64_CHARS = Math.max(
  1,
  Number.parseInt(String(process.env.MAX_IMAGE_BASE64_CHARS || ''), 10) || 10 * 1024 * 1024
);

const createTaskQueue = (maxQueued = 1) => {
  let running = false;
  const queue = [];
  const runNext = async () => {
    if (running) return;
    const next = queue.shift();
    if (!next) return;
    running = true;
    try {
      const result = await next.task();
      next.resolve(result);
    } catch (err) {
      next.reject(err);
    } finally {
      running = false;
      runNext();
    }
  };

  return (task) => {
    if (queue.length >= maxQueued) {
      const err = new Error('Server is busy. Please try again.');
      err.statusCode = 503;
      throw err;
    }
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
  };
};

const runClipTask = createTaskQueue(Math.max(1, Number.parseInt(String(process.env.CLIP_MAX_QUEUE || ''), 10) || 1));
const ENABLE_CLIP_WARMUP = ['true', '1', 'yes', 'on'].includes(String(process.env.ENABLE_CLIP_WARMUP || '').trim().toLowerCase());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { PrismaClient } = pkg;
// Note: We use the singleton 'prisma' from prismaClient.js instead of creating new instances

// Explicitly load .env and log status
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('Error loading .env file:', result.error);
  } else {
    console.log('.env file loaded successfully from:', envPath);
    console.log('Keys found in .env:', Object.keys(result.parsed));
  }
} else {
  console.error('.env file NOT found at:', envPath);
}

if (ENABLE_CLIP_WARMUP) {
  warmupClipService().catch(() => {});
} else {
  console.log('[CLIP] Warmup disabled (set ENABLE_CLIP_WARMUP=true to enable)');
}

// Supabase Client Initialization
const supabaseUrl = process.env.SUPABASE_URL || 'https://puxjtecjxfjldwxiwzrk.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1eGp0ZWNqeGZqbGR3eGl3enJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NDEyNjMsImV4cCI6MjA4MzUxNzI2M30.r9TxaSGhOEWeb3RP_BEsHGQ1GOBpI0-mkU0XdW3FEOc';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- Global Helpers ---

const safeParseFloat = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? null : parsed;
};

const applyDynamicPricingToProduct = (product, rates) => {
  try {
    if (!product) return product;

    // Helper to calculate price for a specific target (product or variant)
    const calcPrice = (target, method) => {
      try {
        const basePrice = target.price || 0;
        // Use target's basePriceIQD if available, else product's
        const basePriceIQD = (target.basePriceIQD && target.basePriceIQD > 0) ? target.basePriceIQD : (product.basePriceIQD || null);
        const domesticShippingFee = product.domesticShippingFee || 0;

        // Ensure getAdjustedPrice is available
        if (typeof getAdjustedPrice !== 'function') {
          console.warn('getAdjustedPrice is not a function, using fallback price');
          return basePrice;
        }

        return getAdjustedPrice(
          basePrice, 
          domesticShippingFee, 
          basePriceIQD
        );
      } catch (err) {
        console.error('Error in calcPrice:', err);
        return target.price || 0;
      }
    };

    // 1. Calculate for all variants if they exist
    let newVariants = [];
    if (product.variants && Array.isArray(product.variants)) {
      newVariants = product.variants.map(v => {
        const seaPrice = calcPrice(v, 'sea');
        const airPrice = calcPrice(v, 'air');
        return {
          ...v,
          price: seaPrice, // Default to Sea
          inclusivePrice: seaPrice,
          seaPrice,
          airPrice
        };
      });
    }

    // 2. Find min variant from the *newly calculated* prices
    let minVariant = null;
    if (newVariants.length > 0) {
      minVariant = newVariants.reduce((min, curr) => {
        if (!curr.price) return min;
        if (!min) return curr;
        return curr.price < min.price ? curr : min;
      }, null);
    }

    // 3. Calculate main product prices
    let seaPrice, airPrice;
    
    if (minVariant) {
      seaPrice = minVariant.seaPrice;
      airPrice = minVariant.airPrice;
    } else {
      seaPrice = calcPrice(product, 'sea');
      airPrice = calcPrice(product, 'air');
    }

    return {
      ...product,
      variants: newVariants,
      price: seaPrice, // Update price to match default (sea)
      inclusivePrice: seaPrice, // Default to sea price as per requirement
      airPrice,
      seaPrice
    };
  } catch (error) {
    console.error(`Error calculating dynamic price for product ${product?.id}:`, error);
    // Fallback: return product as is to avoid breaking the entire list
    return product;
  }
};

const embeddingJobQueue = [];
const embeddingJobSet = new Set();
const embeddingJobAttempts = new Map();
let embeddingJobRunning = false;
const ENABLE_SEMANTIC_SEARCH = process.env.ENABLE_SEMANTIC_SEARCH === 'true';
const ENABLE_SEARCH_PERF_LOGS = ['true', '1', 'yes', 'on'].includes(String(process.env.ENABLE_SEARCH_PERF_LOGS || '').trim().toLowerCase());

const createPerfLog = (scope, enabled = ENABLE_SEARCH_PERF_LOGS) => {
  const startedAt = Date.now();
  const requestId = `${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    requestId,
    log: (stage, data = {}) => {
      if (!enabled) return;
      console.log(`[PERF ${requestId}] ${stage}`, { ...data, elapsedMs: Date.now() - startedAt });
    }
  };
};

const bulkImportJobQueue = [];
const bulkImportJobs = new Map();
let bulkImportJobRunning = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isUniqueIdConstraintError = (error, modelName) => {
  const targets = Array.isArray(error?.meta?.target) ? error.meta.target.map((value) => String(value)) : [];
  return error?.code === 'P2002'
    && String(error?.meta?.modelName || '') === modelName
    && targets.includes('id');
};
const repairTableIdSequence = async (tableName) => {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX("id") FROM "${tableName}"), 0) + 1, false)`
  );
};

const getHttpStatusFromError = (err) => {
  if (!err) return null;
  const direct = err.status ?? err.statusCode;
  if (typeof direct === 'number') return direct;
  const resp = err.response?.status;
  if (typeof resp === 'number') return resp;
  const msg = String(err.message || '');
  const match = msg.match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : null;
};

const enqueueEmbeddingJob = (productId) => {
  const id = safeParseId(productId);
  if (!id) return;
  if (!process.env.DEEPINFRA_API_KEY && !process.env.HUGGINGFACE_API_KEY) return;
  if (embeddingJobSet.has(id)) return;
  embeddingJobQueue.push(id);
  embeddingJobSet.add(id);
  void runEmbeddingJobs();
};

const runEmbeddingJobs = async () => {
  if (embeddingJobRunning) return;
  embeddingJobRunning = true;
  try {
    while (embeddingJobQueue.length > 0) {
      const productId = embeddingJobQueue.shift();
      embeddingJobSet.delete(productId);

      try {
        await processProductAI(productId);
        embeddingJobAttempts.delete(productId);
        await sleep(2500);
      } catch (err) {
        const prev = embeddingJobAttempts.get(productId) || 0;
        const nextAttempt = prev + 1;
        embeddingJobAttempts.set(productId, nextAttempt);

        const status = getHttpStatusFromError(err);
        const waitMs = status === 429 ? 60000 : 15000;

        if (nextAttempt <= 10) {
          await sleep(waitMs);
          if (!embeddingJobSet.has(productId)) {
            embeddingJobQueue.push(productId);
            embeddingJobSet.add(productId);
          }
        } else {
          embeddingJobAttempts.delete(productId);
        }
      }
    }
  } finally {
    embeddingJobRunning = false;
  }
};

const imageEmbeddingJobQueue = [];
const imageEmbeddingJobSet = new Set();
const imageEmbeddingJobAttempts = new Map();
let imageEmbeddingJobRunning = false;

const enqueueImageEmbeddingJob = (productId) => {
  const id = safeParseId(productId);
  if (!id) return;
  if (imageEmbeddingJobSet.has(id)) return;
  imageEmbeddingJobQueue.push(id);
  imageEmbeddingJobSet.add(id);
  void runImageEmbeddingJobs();
};

const runImageEmbeddingJobs = async () => {
  if (imageEmbeddingJobRunning) return;
  imageEmbeddingJobRunning = true;
  try {
    while (imageEmbeddingJobQueue.length > 0) {
      const productId = imageEmbeddingJobQueue.shift();
      imageEmbeddingJobSet.delete(productId);

      try {
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            image: true,
            images: {
              select: { url: true, order: true },
              orderBy: { order: 'asc' },
              take: 1
            }
          }
        });

        const imageUrl = String(product?.images?.[0]?.url || product?.image || '').trim();
        if (!imageUrl) {
          imageEmbeddingJobAttempts.delete(productId);
          continue;
        }

        const embedding = await embedImage(imageUrl);
        const vectorStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE "Product" SET "imageEmbedding" = $1::vector WHERE "id" = $2`,
          vectorStr,
          productId
        );
        imageEmbeddingJobAttempts.delete(productId);
        await sleep(150);
      } catch (err) {
        const prev = imageEmbeddingJobAttempts.get(productId) || 0;
        const nextAttempt = prev + 1;
        imageEmbeddingJobAttempts.set(productId, nextAttempt);

        const waitMs = nextAttempt <= 3 ? 5000 : 20000;
        if (nextAttempt <= 10) {
          await sleep(waitMs);
          if (!imageEmbeddingJobSet.has(productId)) {
            imageEmbeddingJobQueue.push(productId);
            imageEmbeddingJobSet.add(productId);
          }
        } else {
          imageEmbeddingJobAttempts.delete(productId);
        }
      }
    }
  } finally {
    imageEmbeddingJobRunning = false;
  }
};

/**
 * Standard SSE Middleware to ensure headers are set correctly
 * Use this for any long-running event streams
 */
const sseMiddleware = (req, res, next) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for Nginx/HuggingFace
  next();
};

// Robust numeric extractor for strings like "300 جرام" or "15.5 cm"
const extractNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  
  const str = String(val);
  // Matches the first sequence of digits and decimals
  const match = str.match(/(\d+\.?\d*)/);
  if (match) {
    const parsed = parseFloat(match[1]);
    
    // If unit is grams, or if no unit is specified but the number is large (> 10), assume grams and convert to kg
    const isGramUnit = (str.includes('جرام') || str.toLowerCase().includes('gram')) && !str.toLowerCase().includes('kg');
    const isLikelyGrams = !str.toLowerCase().includes('kg') && parsed > 10;
    
    if (isGramUnit || isLikelyGrams) {
      return parsed / 1000;
    }
    
    return isNaN(parsed) ? null : parsed;
  }
  return null;
};

/**
 * Calculates the product price with appropriate markup based on shipping method.
 * Used during bulk import and creation.
 */
const calculateBulkImportPrice = (rawPrice, domesticFee, weight, length, width, height, explicitMethod, rates) => {
  const weightInKg = extractNumber(weight) || 0.5; // Default 0.5kg if missing
  
  let method = explicitMethod?.toLowerCase();
  
  if (!method) {
    // Default logic matching frontend: < 1kg is AIR, >= 1kg is SEA
    method = (weightInKg > 0 && weightInKg < 1) ? 'air' : 'sea';
  }

  const domestic = domesticFee || 0;

  if (method === 'air') {
    const airRate = (rates?.airShippingRate ?? rates?.airRate ?? 15400);
    // No minimum floor for air shipping as per user request
    const shippingCost = weightInKg * airRate;
    
    // Treat rawPrice as IQD (no heuristic conversion)
    const basePrice = rawPrice;
    
    // Formula: (Base + Domestic) * 1.25
    const finalPrice = (basePrice + domestic) * 1.25;
    return Math.ceil(finalPrice / 250) * 250;
  } else {
    // Sea logic matches Air now
    const basePrice = rawPrice;
    const finalPrice = (basePrice + domestic) * 1.25;
    return Math.ceil(finalPrice / 250) * 250;
  }
};

const estimateRawPriceFromStoredPrice = (storedPrice, domesticFee, weight, length, width, height, rates) => {
  const stored = Number(storedPrice) || 0;
  if (stored <= 0) return 0;

  const domestic = Number(domesticFee) || 0;
  
  // Inverse of (Base + Domestic) * 1.25 = Stored
  // Base + Domestic = Stored / 1.25
  // Base = (Stored / 1.25) - Domestic
  
  const raw = (stored / 1.25) - domestic;
  return raw > 0 ? raw : 0;
};

// removed legacy applyDynamicPricingToProduct

async function recalculateExistingProductPrices(oldRates, newRates) {
  const batchSize = 150;
  let lastId = 0;
  let updatedProducts = 0;
  let updatedVariants = 0;
  const startedAt = Date.now();

  console.log('[Settings] Recalculating product prices...', { oldRates, newRates });

  while (true) {
    const products = await prisma.product.findMany({
      where: { id: { gt: lastId }, status: { not: 'DELETED' } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        price: true,
        basePriceIQD: true,
        domesticShippingFee: true,
        variants: {
          select: {
            id: true,
            price: true
          }
        }
      }
    });

    if (products.length === 0) break;
    lastId = products[products.length - 1].id;

    const tasks = [];

    for (const product of products) {
      const domesticFee = Number(product.domesticShippingFee) || 0;

      const hasBase = Number(product.basePriceIQD) > 0;
      // Only reprice if basePriceIQD is low (assume RMB if < 1000). 
      // If it's > 1000, we treat it as IQD/Combined and respect the stored price.
      const shouldRepriceProduct = (hasBase && Number(product.basePriceIQD) < 1000);

      if (shouldRepriceProduct) {
        const raw = hasBase
          ? Number(product.basePriceIQD)
          : estimateRawPriceFromStoredPrice(product.price, domesticFee, 0, 0, 0, 0, oldRates);

        if (raw > 0) {
          const priceInput = raw;
          const newPrice = calculateBulkImportPrice(priceInput, domesticFee, 0, 0, 0, 0, null, newRates);
          if (Number.isFinite(newPrice) && newPrice > 0 && newPrice !== product.price) {
            tasks.push(() => prisma.product.update({
              where: { id: product.id },
              data: hasBase ? { price: newPrice } : { price: newPrice, basePriceIQD: raw }
            }).then(() => { updatedProducts += 1; }));
          } else if (!hasBase) {
            tasks.push(() => prisma.product.update({
              where: { id: product.id },
              data: { basePriceIQD: raw }
            }).catch(() => {}).then(() => {}));
          }
        }
      }

      for (const v of product.variants) {
        // Variants also follow the < 1000 logic for recalculation
        const vRaw = estimateRawPriceFromStoredPrice(v.price, domesticFee, 0, 0, 0, 0, oldRates);
        if (vRaw > 0 && vRaw < 1000) {
          const vNewPrice = calculateBulkImportPrice(vRaw, domesticFee, 0, 0, 0, 0, null, newRates);
          if (Number.isFinite(vNewPrice) && vNewPrice > 0 && vNewPrice !== v.price) {
            tasks.push(() => prisma.productVariant.update({
              where: { id: v.id },
              data: { price: vNewPrice }
            }).then(() => { updatedVariants += 1; }));
          }
        }
      }
    }

    const concurrency = 20;
    for (let i = 0; i < tasks.length; i += concurrency) {
      const slice = tasks.slice(i, i + concurrency);
      await Promise.allSettled(slice.map(fn => fn()));
    }

    await new Promise((r) => setImmediate(r));
  }

  console.log('[Settings] Price recalculation finished', {
    updatedProducts,
    updatedVariants,
    elapsedMs: Date.now() - startedAt
  });
}

// Helper to parse variant-specific values from a string like "200g (S), 300g (XL)"
const parseVariantValues = (str) => {
  if (!str || typeof str !== 'string') return {};
  
  const results = {};
  // Split by comma or semicolon
  const parts = str.split(/[,;]/);
  
  parts.forEach(part => {
    // Look for a number and a value in parentheses, e.g., "200 جرام (S)" or "300g (XL)"
    const match = part.match(/(\d+\.?\d*)\s*[^(\n]*\(([^)]+)\)/);
    if (match) {
      const val = parseFloat(match[1]);
      const key = match[2].trim();
      
      // Convert grams to kg if "gram" or "جرام" is present in the part
      let finalVal = val;
      if ((part.includes('جرام') || part.toLowerCase().includes('gram')) && !part.toLowerCase().includes('kg')) {
        finalVal = val / 1000;
      }
      
      results[key] = finalVal;
    }
  });
  
  return results;
};

const cleanStr = (s) => {
  if (!s || typeof s !== 'string') return s || '';
  return s.replace(/\bempty\b/gi, '').trim();
};

const parseAiMetadata = (val) => {
  if (!val) return null;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

const extractNewOrOld = (aiMetadata) => {
  if (!aiMetadata || typeof aiMetadata !== 'object') return null;
  const value = aiMetadata.newOrOld ?? aiMetadata.neworold ?? aiMetadata.condition;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['new', 'جديد', '1', 'true'].includes(normalized)) return true;
    if (['used', 'مستعمل', '0', 'false'].includes(normalized)) return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const CONDITION_USED_TEXT_REGEX = /(轻微使用痕迹|使用痕迹|二手|闲置|自用|有磨损|有划痕|成色|旧款|旧包|旧货|used|pre[-\s]?owned|second[-\s]?hand|مستعمل|استخدام\s*خفيف|غير\s*جديد)/i;
const CONDITION_NEW_TEXT_REGEX = /(全新|全新未使用|未使用|未拆封|全新带吊牌|全新带标签|吊牌未拆|brand\s*new|جديد|غير\s*مستعمل)/i;

const inferProductCondition = (productLike) => {
  if (!productLike || typeof productLike !== 'object') return null;
  if (typeof productLike.neworold === 'boolean') return productLike.neworold;
  const aiMetadata = parseAiMetadata(productLike.aiMetadata);
  const metadataCondition = extractNewOrOld(aiMetadata);
  if (typeof metadataCondition === 'boolean') return metadataCondition;
  const text = [
    String(productLike?.name || '').trim(),
    String(aiMetadata?.originalTitle || '').trim(),
    String(aiMetadata?.conditionText || '').trim(),
    String(aiMetadata?.translatedDescription || '').trim()
  ].filter(Boolean).join(' ');
  if (!text) return null;
  const normalized = String(text).toLowerCase();
  if (CONDITION_USED_TEXT_REGEX.test(normalized)) return false;
  if (CONDITION_NEW_TEXT_REGEX.test(normalized)) return true;
  return null;
};

const MEILI_INDEX_NAME = process.env.MEILI_INDEX_NAME || 'products';
const MEILI_HOST = process.env.MEILI_HOST || '';
const MEILI_ADMIN_API_KEY = process.env.MEILI_ADMIN_API_KEY || process.env.MEILI_MASTER_KEY || '';
const MEILI_TASK_TIMEOUT_MS = Math.max(5000, Number.parseInt(String(process.env.MEILI_TASK_TIMEOUT_MS || ''), 10) || 120000);
const MEILI_TASK_POLL_INTERVAL_MS = Math.max(100, Number.parseInt(String(process.env.MEILI_TASK_POLL_INTERVAL_MS || ''), 10) || 1000);
const MEILI_REINDEX_BATCH_SIZE = Math.max(10, Math.min(1000, Number.parseInt(String(process.env.MEILI_REINDEX_BATCH_SIZE || ''), 10) || 200));
const MEILI_REINDEX_DEBUG_LOG_LIMIT = Math.max(10, Math.min(200, Number.parseInt(String(process.env.MEILI_REINDEX_DEBUG_LOG_LIMIT || ''), 10) || 60));
let meiliClientSingleton = null;
let meiliIndexReadyPromise = null;
const createMeiliReindexState = () => ({
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null,
  phase: 'idle',
  reset: false,
  totalProducts: null,
  totalIndexed: 0,
  progressPercent: 0,
  processedBatches: 0,
  currentBatchNumber: 0,
  currentBatchSize: 0,
  currentBatchStartedAt: null,
  currentTaskUid: null,
  lastIndexedId: 0,
  lastIndexedAt: null,
  debugLog: []
});
const meiliReindexState = createMeiliReindexState();

const pushMeiliReindexDebug = (message, data = null) => {
  const entry = {
    at: new Date().toISOString(),
    message
  };
  if (data && typeof data === 'object') entry.data = data;
  meiliReindexState.debugLog = [...meiliReindexState.debugLog, entry].slice(-MEILI_REINDEX_DEBUG_LOG_LIMIT);
  return entry;
};

const refreshMeiliReindexProgress = () => {
  if (Number(meiliReindexState.totalProducts) > 0) {
    meiliReindexState.progressPercent = Number(((meiliReindexState.totalIndexed / meiliReindexState.totalProducts) * 100).toFixed(1));
    return;
  }
  meiliReindexState.progressPercent = 0;
};

const normalizeSearchText = (value) => {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const sanitizeFeaturedSearchSentences = (input) => {
  const source = Array.isArray(input)
    ? input
    : (typeof input === 'string' ? input.split('\n') : []);
  const seen = new Set();
  const output = [];
  for (const raw of source) {
    const term = String(raw || '').trim();
    if (!term) continue;
    const normalized = normalizeSearchText(term);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(term);
    if (output.length >= 40) break;
  }
  return output;
};

const stripLegacyFeaturedSearchTermsFromMetadata = (aiMetadata) => {
  if (!aiMetadata || typeof aiMetadata !== 'object' || Array.isArray(aiMetadata)) return aiMetadata;
  if (!Object.prototype.hasOwnProperty.call(aiMetadata, 'featuredSearchTerms')) return aiMetadata;
  const nextMetadata = { ...aiMetadata };
  delete nextMetadata.featuredSearchTerms;
  return nextMetadata;
};

const getFeaturedSearchSentencesFromProduct = (productLike) => {
  if (!productLike || typeof productLike !== 'object') return [];
  return sanitizeFeaturedSearchSentences(productLike.featuredSearchSentences);
};

const isFeaturedMatchForQuery = (productLike, queryVariants, condition = '') => {
  if (!productLike || !queryVariants || queryVariants.size === 0) return false;
  if (!productLike.isFeatured) return false;
  if (condition === 'new' && inferProductCondition(productLike) === false) return false;
  if (condition === 'used' && inferProductCondition(productLike) === true) return false;
  const featuredSentences = getFeaturedSearchSentencesFromProduct(productLike);
  if (featuredSentences.length === 0) return false;
  const normalizedTerms = featuredSentences
    .map((term) => normalizeSearchText(term))
    .filter(Boolean)
    .map((term) => ({ spaced: term, compact: term.replace(/\s+/g, '') }));
  for (const variant of queryVariants) {
    const normalizedVariant = normalizeSearchText(variant);
    if (!normalizedVariant) continue;
    const compactVariant = normalizedVariant.replace(/\s+/g, '');
    for (const term of normalizedTerms) {
      if (!term.spaced || !term.compact) continue;
      if (term.spaced === normalizedVariant) return true;
      if (term.compact === compactVariant) return true;
    }
  }
  return false;
};

const ARABIC_SYNONYM_GROUPS = [
  ['جوال', 'هاتف', 'موبايل', 'تلفون', 'محمول', 'موبيل', 'خلوي', 'موبايل فون'],
  ['ايفون', 'آيفون', 'iphone', 'اىفون', 'اي فون'],
  ['اندرويد', 'أندرويد', 'android'],
  ['سماعه', 'سماعة', 'سماعات', 'هيدفون', 'هيدفوت', 'earbuds', 'headphones'],
  ['شاحن', 'شواحن', 'charger'],
  ['وصله', 'وصلة', 'كيبل', 'كابل', 'سلك شحن', 'usb cable', 'cable'],
  ['باور بانك', 'بور بانك', 'power bank', 'بنك طاقة', 'بطارية متنقلة'],
  ['غطاء', 'كفر', 'جراب', 'حافظة', 'case', 'cover'],
  ['لابتوب', 'لاب توب', 'حاسوب محمول', 'كمبيوتر محمول', 'notebook'],
  ['كمبيوتر', 'حاسوب', 'pc', 'computer', 'ديسكتوب', 'desktop'],
  ['كيبورد', 'لوحة مفاتيح', 'keyboard'],
  ['ماوس', 'فارة', 'فأرة', 'mouse'],
  ['شاشه', 'شاشة', 'monitor', 'display'],
  ['طابعه', 'طابعة', 'printer'],
  ['تابلت', 'جهاز لوحي', 'tablet', 'ipad', 'ايباد'],
  ['ساعة ذكية', 'سمارت واتش', 'smartwatch', 'ساعه ذكيه'],
  ['كاميرا', 'camera', 'آلة تصوير', 'اله تصوير'],
  ['تلفزيون', 'تلفاز', 'tv', 'شاشة تلفاز', 'سمارت تي في', 'smart tv'],
  ['ثلاجه', 'ثلاجة', 'براد', 'refrigerator', 'fridge'],
  ['غساله', 'غسالة', 'washing machine', 'ماكنة غسيل'],
  ['مكيف', 'مكيّف', 'مبرد', 'air conditioner', 'ac'],
  ['مكنسه', 'مكنسة', 'هوفر', 'vacuum', 'vacuum cleaner'],
  ['مروحه', 'مروحة', 'fan'],
  ['دفايه', 'دفاية', 'heater'],
  ['خلاط', 'blender', 'mixer'],
  ['فرن', 'oven'],
  ['ميكرويف', 'مايكرويف', 'microwave'],
  ['سماعه بلوتوث', 'سماعة بلوتوث', 'bluetooth speaker', 'مكبر صوت'],
  ['بلايستيشن', 'بليستيشن', 'ps', 'playstation', 'سوني'],
  ['اكس بوكس', 'xbox', 'اكسبوكس'],
  ['يد تحكم', 'كنترولر', 'جويستك', 'controller', 'gamepad'],
  ['لعبة', 'العاب', 'game', 'games'],
  ['حذاء', 'حذا', 'جزمة', 'شحاطة', 'صندل', 'بوط', 'shoe', 'shoes', 'sneakers'],
  ['ملابس', 'لبس', 'ثياب', 'clothes', 'apparel'],
  ['قميص', 'تيشيرت', 'تي شيرت', 'shirt', 't shirt', 't-shirt'],
  ['بنطلون', 'سروال', 'جينز', 'pants', 'trousers', 'jeans'],
  ['فستان', 'دريس', 'dress'],
  ['عباية', 'عبايه', 'abaya'],
  ['عطر', 'برفيوم', 'perfume', 'fragrance'],
  ['مكياج', 'مستحضرات تجميل', 'cosmetics', 'makeup'],
  ['كريم', 'مرطب', 'moisturizer', 'cream'],
  ['شامبو', 'شامبوو', 'shampoo'],
  ['صابون', 'soap'],
  ['شنطه', 'شنطة', 'حقيبة', 'bag', 'handbag'],
  ['محفظه', 'محفظة', 'wallet'],
  ['نظاره', 'نظارة', 'glasses', 'eyewear'],
  ['كرسي', 'كرسيه', 'chair', 'seat'],
  ['طاوله', 'طاولة', 'table', 'desk', 'مكتب'],
  ['كنبه', 'كنبة', 'اريكة', 'أريكة', 'sofa', 'couch'],
  ['كنتور', 'قنتور', 'دولاب', 'خزانة', 'خزانه', 'خزانة ملابس', 'دولاب ملابس', 'wardrobe', 'closet'],
  ['سرير', 'bed'],
  ['مرتبه', 'مرتبة', 'mattress'],
  ['بطانيه', 'بطانية', 'blanket'],
  ['مخده', 'مخدة', 'وسادة', 'pillow'],
  ['مطبخ', 'ادوات مطبخ', 'أدوات مطبخ', 'kitchen', 'kitchenware'],
  ['طفل', 'اطفال', 'أطفال', 'بيبي', 'baby', 'kids'],
  ['عربيه', 'عربية', 'سياره', 'سيارة', 'car', 'vehicle', 'automobile'],
  ['اطار', 'إطار', 'كوشوك', 'tire', 'tyre'],
  ['زيت', 'زيت محرك', 'oil', 'engine oil'],
  ['دراجه', 'دراجة', 'سيكل', 'bike', 'bicycle'],
  ['ساعه', 'ساعة', 'watch'],
  ['خاتم', 'دبله', 'دبلة', 'ring'],
  ['قلاده', 'قلادة', 'سلسال', 'necklace'],
  ['اسواره', 'اسوارة', 'إسوارة', 'bracelet'],
  ['هديه', 'هدية', 'gift', 'present'],
  ['توصيل', 'شحن', 'delivery', 'shipping'],
  ['جديد', 'new'],
  ['مستعمل', 'استخدام خفيف', 'used', 'second hand', 'secondhand']
];

const buildMeiliSynonyms = (groups) => {
  const synonymMap = {};
  for (const group of groups) {
    const expanded = new Set();
    for (const rawTerm of group) {
      const term = String(rawTerm || '').trim().toLowerCase();
      if (!term) continue;
      expanded.add(term);
      const normalized = normalizeSearchText(term);
      if (normalized) expanded.add(normalized);
    }
    const allTerms = Array.from(expanded).filter(Boolean);
    for (const term of allTerms) {
      const alternatives = allTerms.filter((candidate) => candidate !== term);
      if (alternatives.length > 0) synonymMap[term] = alternatives;
    }
  }
  return synonymMap;
};

const MEILI_ARABIC_SYNONYMS = buildMeiliSynonyms(ARABIC_SYNONYM_GROUPS);

const IRAQI_SLANG_NORMALIZATION_MAP = {
  كنتور: ['دولاب', 'خزانة', 'خزانه', 'دولاب ملابس', 'خزانة ملابس'],
  قنتور: ['دولاب', 'خزانة', 'خزانه', 'دولاب ملابس', 'خزانة ملابس'],
  درنفيس: ['دولاب', 'خزانة'],
  قندره: ['حذاء', 'جزمة'],
  جواتي: ['حذاء', 'رياضي'],
  جربايه: ['جورب', 'جوارب', 'شراب'],
  جرباية: ['جورب', 'جوارب', 'شراب'],
  جرابية: ['جورب', 'جوارب', 'شراب'],
  دشداشه: ['ثوب', 'ملابس'],
  عركيه: ['قبعة'],
  ياخه: ['ياقة', 'قميص']
};

const expandSearchTermsForIraqiSlang = (query) => {
  const base = String(query || '').trim();
  if (!base) return [];
  const normalized = normalizeSearchText(base);
  const terms = new Set([base, normalized]);
  const addCandidates = (value) => {
    const key = normalizeSearchText(value);
    if (!key) return;
    terms.add(key);
    const directMapped = IRAQI_SLANG_NORMALIZATION_MAP[key];
    if (Array.isArray(directMapped)) {
      for (const candidate of directMapped) {
        const cleanCandidate = String(candidate || '').trim();
        if (!cleanCandidate) continue;
        terms.add(cleanCandidate);
        terms.add(normalizeSearchText(cleanCandidate));
      }
    }
    const synonymMapped = MEILI_ARABIC_SYNONYMS[key];
    if (Array.isArray(synonymMapped)) {
      for (const candidate of synonymMapped) {
        const cleanCandidate = String(candidate || '').trim();
        if (!cleanCandidate) continue;
        terms.add(cleanCandidate);
        terms.add(normalizeSearchText(cleanCandidate));
      }
    }
  };
  addCandidates(base);
  addCandidates(normalized);
  const tokens = normalized.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  for (const token of tokens) {
    addCandidates(token);
  }
  return Array.from(terms).map((value) => String(value || '').trim()).filter(Boolean).slice(0, 30);
};

const buildKeywordSearchTerms = (query) => {
  const expandedTerms = expandSearchTermsForIraqiSlang(query);
  const keywords = new Set();
  for (const term of expandedTerms) {
    const normalizedTerm = normalizeSearchText(term);
    if (normalizedTerm) {
      if (!normalizedTerm.includes(' ')) keywords.add(normalizedTerm);
      for (const token of normalizedTerm.split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
        keywords.add(token);
      }
    }
    const rawTerm = String(term || '').trim();
    if (rawTerm && !rawTerm.includes(' ')) {
      keywords.add(rawTerm);
    }
  }
  return Array.from(keywords).filter(Boolean).slice(0, 40);
};

const buildExactFeaturedSentenceVariants = (query) => {
  const base = String(query || '').trim();
  if (!base) return new Set();
  const normalized = normalizeSearchText(base);
  return new Set([base, normalized].map((value) => String(value || '').trim()).filter(Boolean));
};

const buildSearchDocument = (product) => {
  const aiMetadata = parseAiMetadata(product?.aiMetadata);
  const rawKeywords = Array.isArray(product?.keywords) ? product.keywords : [];
  const featuredSearchSentences = getFeaturedSearchSentencesFromProduct(product);
  const keywordsJoined = rawKeywords.map((kw) => String(kw || '').trim()).filter(Boolean).join(' ');
  const title = String(product?.name || '').trim();
  const description = String(product?.description || '').trim();
  const aiTitle = String(aiMetadata?.title_ar || aiMetadata?.title || '').trim();
  const featuredTermsJoined = featuredSearchSentences.join(' ');
  const searchText = [title, aiTitle, keywordsJoined, featuredTermsJoined, description].filter(Boolean).join(' ');
  const normalizedSearchText = normalizeSearchText(searchText);
  return {
    id: product.id,
    name: title,
    aiTitle,
    description,
    featuredSearchSentences,
    keywords: rawKeywords,
    searchText,
    normalizedSearchText,
    price: Number(product?.price || 0),
    status: String(product?.status || ''),
    isActive: Boolean(product?.isActive),
    isFeatured: Boolean(product?.isFeatured),
    neworold: typeof product?.neworold === 'boolean' ? product.neworold : null,
    updatedAt: product?.updatedAt ? new Date(product.updatedAt).getTime() : 0
  };
};

const getMeiliClient = () => {
  if (!MEILI_HOST || !MEILI_ADMIN_API_KEY) {
    const configError = new Error('Meilisearch is not configured. Set MEILI_HOST and MEILI_ADMIN_API_KEY.');
    configError.status = 503;
    throw configError;
  }
  if (!meiliClientSingleton) {
    meiliClientSingleton = new MeiliSearch({
      host: MEILI_HOST,
      apiKey: MEILI_ADMIN_API_KEY
    });
  }
  return meiliClientSingleton;
};

const getMeiliIndex = async () => {
  const client = getMeiliClient();
  const index = client.index(MEILI_INDEX_NAME);
  try {
    await index.getRawInfo();
  } catch (_error) {
    await client.createIndex(MEILI_INDEX_NAME, { primaryKey: 'id' });
  }
  return client.index(MEILI_INDEX_NAME);
};

const resetMeiliIndex = async () => {
  const client = getMeiliClient();
  try {
    await client.deleteIndex(MEILI_INDEX_NAME);
  } catch (error) {
    const message = String(error?.message || '');
    const statusCode = Number(error?.cause?.response?.status || error?.response?.status || 0);
    if (statusCode !== 404 && !message.includes('index_not_found') && !message.includes('not found')) {
      throw error;
    }
  }
  meiliIndexReadyPromise = null;
  return ensureMeiliIndexSettings({ forceRefresh: true });
};

const applyMeiliIndexSettings = async (index) => {
  const settingsTasks = await Promise.all([
    index.updateSearchableAttributes(['keywords', 'name', 'aiTitle', 'searchText', 'normalizedSearchText', 'description']),
    index.updateFilterableAttributes(['status', 'isActive', 'neworold', 'price']),
    index.updateSortableAttributes(['isFeatured', 'price', 'updatedAt']),
    index.updateSynonyms(MEILI_ARABIC_SYNONYMS),
    index.updateRankingRules([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness'
    ])
  ]);
  for (const task of settingsTasks) {
    if (task?.taskUid != null) {
      await waitForMeiliTask(index, task.taskUid);
    }
  }
  return index;
};

const ensureMeiliIndexSettings = async ({ forceRefresh = false } = {}) => {
  if (forceRefresh) {
    meiliIndexReadyPromise = null;
  }
  if (!meiliIndexReadyPromise) {
    meiliIndexReadyPromise = (async () => {
      const index = await getMeiliIndex();
      await applyMeiliIndexSettings(index);
      return index;
    })().catch((error) => {
      meiliIndexReadyPromise = null;
      throw error;
    });
  }
  return meiliIndexReadyPromise;
};

const getMeiliSearchIndex = async () => {
  const index = await getMeiliIndex();
  if (meiliIndexReadyPromise) {
    await meiliIndexReadyPromise;
  }
  return index;
};

const waitForMeiliTask = async (index, taskUid) => {
  return index.waitForTask(taskUid, {
    timeOutMs: MEILI_TASK_TIMEOUT_MS,
    intervalMs: MEILI_TASK_POLL_INTERVAL_MS
  });
};

const getMeiliReindexStatus = () => ({
  running: meiliReindexState.running,
  lastStartedAt: meiliReindexState.lastStartedAt,
  lastFinishedAt: meiliReindexState.lastFinishedAt,
  lastError: meiliReindexState.lastError,
  lastResult: meiliReindexState.lastResult,
  phase: meiliReindexState.phase,
  reset: meiliReindexState.reset,
  totalProducts: meiliReindexState.totalProducts,
  totalIndexed: meiliReindexState.totalIndexed,
  progressPercent: meiliReindexState.progressPercent,
  processedBatches: meiliReindexState.processedBatches,
  currentBatchNumber: meiliReindexState.currentBatchNumber,
  currentBatchSize: meiliReindexState.currentBatchSize,
  currentBatchStartedAt: meiliReindexState.currentBatchStartedAt,
  currentTaskUid: meiliReindexState.currentTaskUid,
  lastIndexedId: meiliReindexState.lastIndexedId,
  lastIndexedAt: meiliReindexState.lastIndexedAt,
  debugLog: meiliReindexState.debugLog
});

const syncProductsToMeili = async (options = {}) => {
  const shouldReset = options?.reset === true;
  meiliReindexState.phase = shouldReset ? 'resetting_index' : 'ensuring_index_settings';
  meiliReindexState.reset = shouldReset;
  pushMeiliReindexDebug('Preparing Meilisearch index', {
    reset: shouldReset,
    batchSize: MEILI_REINDEX_BATCH_SIZE
  });
  const index = shouldReset
    ? await resetMeiliIndex()
    : await ensureMeiliIndexSettings();
  const pageSize = MEILI_REINDEX_BATCH_SIZE;
  meiliReindexState.phase = 'counting_products';
  meiliReindexState.totalProducts = await prisma.product.count({
    where: { status: { not: 'DELETED' } }
  });
  refreshMeiliReindexProgress();
  pushMeiliReindexDebug('Loaded product count for reindex', {
    totalProducts: meiliReindexState.totalProducts,
    batchSize: pageSize
  });
  let lastId = 0;
  let totalIndexed = 0;
  let processedBatches = 0;
  while (true) {
    meiliReindexState.phase = 'loading_batch';
    const batch = await prisma.product.findMany({
      where: { id: { gt: lastId }, status: { not: 'DELETED' } },
      orderBy: { id: 'asc' },
      take: pageSize,
      select: {
        id: true,
        name: true,
        keywords: true,
        featuredSearchSentences: true,
        aiMetadata: true,
        price: true,
        status: true,
        isActive: true,
        isFeatured: true,
        neworold: true,
        updatedAt: true
      }
    });
    if (batch.length === 0) {
      meiliReindexState.phase = 'finalizing';
      meiliReindexState.currentBatchSize = 0;
      meiliReindexState.currentTaskUid = null;
      meiliReindexState.currentBatchStartedAt = null;
      pushMeiliReindexDebug('No more products left to index', {
        totalIndexed,
        processedBatches
      });
      break;
    }
    processedBatches += 1;
    const firstBatchId = batch[0].id;
    const lastBatchId = batch[batch.length - 1].id;
    meiliReindexState.currentBatchNumber = processedBatches;
    meiliReindexState.currentBatchSize = batch.length;
    meiliReindexState.currentBatchStartedAt = new Date().toISOString();
    meiliReindexState.phase = 'preparing_batch';
    pushMeiliReindexDebug('Loaded product batch from database', {
      batchNumber: processedBatches,
      batchSize: batch.length,
      firstId: firstBatchId,
      lastId: lastBatchId
    });
    const docs = batch.map(buildSearchDocument);
    if (docs.length > 0) {
      meiliReindexState.phase = 'uploading_batch';
      const task = await index.addDocuments(docs, { primaryKey: 'id' });
      meiliReindexState.currentTaskUid = task.taskUid;
      pushMeiliReindexDebug('Submitted batch to Meilisearch', {
        batchNumber: processedBatches,
        batchSize: docs.length,
        taskUid: task.taskUid,
        firstId: firstBatchId,
        lastId: lastBatchId
      });
      meiliReindexState.phase = 'waiting_for_meili_task';
      await waitForMeiliTask(index, task.taskUid);
      totalIndexed += docs.length;
      lastId = lastBatchId;
      meiliReindexState.totalIndexed = totalIndexed;
      meiliReindexState.processedBatches = processedBatches;
      meiliReindexState.lastIndexedId = lastBatchId;
      meiliReindexState.lastIndexedAt = new Date().toISOString();
      meiliReindexState.currentTaskUid = null;
      meiliReindexState.currentBatchStartedAt = null;
      meiliReindexState.phase = 'batch_completed';
      refreshMeiliReindexProgress();
      pushMeiliReindexDebug('Completed Meilisearch batch', {
        batchNumber: processedBatches,
        batchSize: docs.length,
        totalIndexed,
        totalProducts: meiliReindexState.totalProducts,
        progressPercent: meiliReindexState.progressPercent,
        lastIndexedId: lastBatchId
      });
    } else {
      lastId = lastBatchId;
      meiliReindexState.processedBatches = processedBatches;
      meiliReindexState.lastIndexedId = lastBatchId;
      meiliReindexState.lastIndexedAt = new Date().toISOString();
      meiliReindexState.currentBatchStartedAt = null;
      meiliReindexState.currentTaskUid = null;
      meiliReindexState.phase = 'batch_skipped';
      pushMeiliReindexDebug('Skipped empty transformed batch', {
        batchNumber: processedBatches,
        batchSize: batch.length,
        firstId: firstBatchId,
        lastId: lastBatchId
      });
    }
  }
  meiliReindexState.currentBatchSize = 0;
  meiliReindexState.currentTaskUid = null;
  meiliReindexState.currentBatchStartedAt = null;
  meiliReindexState.phase = 'completed';
  refreshMeiliReindexProgress();
  return {
    totalIndexed,
    totalProducts: meiliReindexState.totalProducts,
    processedBatches,
    lastIndexedId: meiliReindexState.lastIndexedId,
    indexName: MEILI_INDEX_NAME,
    reset: shouldReset
  };
};

const startMeiliReindexInBackground = (options = {}) => {
  if (meiliReindexState.running) return false;
  const nextState = createMeiliReindexState();
  Object.assign(meiliReindexState, nextState, {
    running: true,
    phase: 'starting',
    reset: options?.reset === true,
    lastStartedAt: new Date().toISOString()
  });
  pushMeiliReindexDebug('Background Meili reindex started', {
    reset: meiliReindexState.reset,
    batchSize: MEILI_REINDEX_BATCH_SIZE
  });
  void syncProductsToMeili(options)
    .then((result) => {
      meiliReindexState.lastResult = result;
      meiliReindexState.lastFinishedAt = new Date().toISOString();
      meiliReindexState.phase = 'completed';
      refreshMeiliReindexProgress();
      pushMeiliReindexDebug('Background Meili reindex completed', result);
      console.log('[Meili] background reindex completed:', result);
    })
    .catch((error) => {
      meiliReindexState.lastError = error?.message || 'Unknown error';
      meiliReindexState.lastFinishedAt = new Date().toISOString();
      meiliReindexState.phase = 'failed';
      meiliReindexState.currentTaskUid = null;
      meiliReindexState.currentBatchStartedAt = null;
      pushMeiliReindexDebug('Background Meili reindex failed', {
        error: meiliReindexState.lastError
      });
      console.error('[Meili] background reindex failed:', error);
    })
    .finally(() => {
      meiliReindexState.running = false;
    });
  return true;
};

const syncProductToMeiliById = async (productId) => {
  const normalizedId = safeParseId(productId);
  if (!normalizedId) return;
  const product = await prisma.product.findUnique({
    where: { id: normalizedId },
    select: {
      id: true,
      name: true,
      keywords: true,
      featuredSearchSentences: true,
      aiMetadata: true,
      price: true,
      status: true,
      isActive: true,
      isFeatured: true,
      neworold: true,
      updatedAt: true
    }
  });
  const index = await ensureMeiliIndexSettings();
  if (!product || product.status === 'DELETED') {
    await index.deleteDocument(normalizedId);
    return;
  }
  const doc = buildSearchDocument(product);
  const task = await index.addDocuments([doc], { primaryKey: 'id' });
  await waitForMeiliTask(index, task.taskUid);
};

const deleteProductFromMeiliById = async (productId) => {
  const normalizedId = safeParseId(productId);
  if (!normalizedId) return;
  const index = await ensureMeiliIndexSettings();
  const task = await index.deleteDocument(normalizedId);
  await waitForMeiliTask(index, task.taskUid);
};

const ensureMeiliIndexed = async () => {
  try {
    const index = await ensureMeiliIndexSettings();
    const stats = await index.getStats();
    if ((stats?.numberOfDocuments || 0) > 0) return;
    await syncProductsToMeili();
  } catch (error) {
    const message = String(error?.message || '');
    const code = String(error?.code || '');
    const isDbIssue = error?.name === 'PrismaClientInitializationError'
      || code === 'P1001'
      || code === 'P1017'
      || code === 'P2024'
      || message.includes("Can't reach database server")
      || message.includes('Server has closed the connection')
      || message.includes('timed out');
    const isMeiliIssue = message.includes('127.0.0.1:7700')
      || message.includes('ECONNREFUSED')
      || message.includes('failed to fetch')
      || message.includes('fetch failed');
    if (isDbIssue) {
      console.warn('[Meili] Startup indexing skipped: database unavailable.');
      return;
    }
    if (isMeiliIssue) {
      console.warn('[Meili] Startup indexing skipped: Meilisearch unavailable.');
      return;
    }
    console.error('[Meili] ensureMeiliIndexed failed:', error?.message || error);
  }
};

const extractGeneratedOptionEntries = (opt) => {
  const out = [];
  if (!opt || typeof opt !== 'object') return out;

  const maybeParseJson = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const metaKeys = new Set(['price', 'image', 'shippingmethod', 'method', 'stock']);

  const pushEntry = (rawKey, rawVal) => {
    const cleanedKey = cleanStr(String(rawKey));
    if (!cleanedKey) return;
    const lower = cleanedKey.toLowerCase();
    if (metaKeys.has(lower)) return;

    if (lower === 'options' || lower === 'combination' || lower === 'variant' || lower === 'variants') {
      const nested = maybeParseJson(rawVal);
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const [k, v] of Object.entries(nested)) pushEntry(k, v);
        return;
      }
    }

    out.push([cleanedKey, rawVal]);
  };

  for (const [k, v] of Object.entries(opt)) pushEntry(k, v);
  return out;
};

const fieldMapping = {
  'size': 'المقاس',
  'Size': 'المقاس',
  '尺码': 'المقاس',
  'color': 'اللون',
  'Color': 'اللون',
  '颜色': 'اللون',
  '颜色分类': 'اللون',
  'اللون': 'اللون',
  'تصنيف الألوان': 'اللون',
  'المقاس': 'المقاس',
  'style': 'الستايل',
  'material': 'الخامة',
  'type': 'النوع',
  'model': 'الموديل',
  'Model': 'الموديل',
  '型号': 'الموديل'
};

const productVariantSelect = {
  id: true,
  productId: true,
  combination: true,
  price: true,
  basePriceIQD: true,
  image: true
};

// Server start - Build Trigger: 2026-01-26 22:00
const app = express();
app.set('etag', false);
app.get('/health', (req, res) => res.status(200).send('OK'));
console.log('-------------------------------------------');
console.log('--- UPDATED VARIANT LOGIC LOADED (v4 - FINAL FIX) ---');
console.log('--- STRICTLY NO CURRENCY CONVERSION ---');
console.log('-------------------------------------------');
const httpServer = createServer(app);

// Health check endpoint for Render/Deployment
app.get('/api/health', async (req, res) => {
  let dbStatus = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (e) {
    dbStatus = 'error: ' + e.message;
  }

  res.json({ 
    status: 'ok', 
    database: dbStatus,
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 5001,
    has_db_url: !!process.env.DATABASE_URL,
    has_supabase_url: !!process.env.SUPABASE_URL
  });
});

app.get('/api/diagnostics', (req, res) => {
  res.json({
    marker: 'engine-v2',
    cwd: process.cwd(),
    dirname: __dirname,
    port: process.env.PORT || 5001,
    env: process.env.NODE_ENV || 'development'
  });
});

// Test Database Connection
prisma.$connect()
  .then(async () => {
    console.log('Successfully connected to the database');
    const count = await prisma.product.count();
    console.log(`Database check: Found ${count} products`);
  })
  .catch((err) => {
    const message = String(err?.message || '');
    const code = String(err?.code || '');
    const isTransientDbIssue = err?.name === 'PrismaClientInitializationError'
      || code === 'P1001'
      || code === 'P1017'
      || code === 'P2024'
      || message.includes("Can't reach database server")
      || message.includes('Server has closed the connection')
      || message.includes('timed out');
    if (isTransientDbIssue) {
      console.warn('DATABASE CONNECTION WARNING: database unavailable during startup. Server will keep running and retry on incoming requests.');
      return;
    }
    console.error('DATABASE CONNECTION ERROR:', err);
  });

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let sharpModule;
async function getSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default ?? mod;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

// --- Image Processing Helpers ---
const convertToWebP = async (base64String) => {
  if (!base64String || !base64String.startsWith('data:image')) {
    return base64String;
  }

  // Skip if already webp and reasonably sized
  if (base64String.startsWith('data:image/webp') && base64String.length < 50000) {
    return base64String;
  }

  try {
    const sharp = await getSharp();
    if (!sharp) return base64String;

    const base64Data = base64String.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Check buffer size - if very small, don't bother converting
    if (buffer.length < 10240) { // 10KB
      return base64String;
    }

    const webpBuffer = await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }) // Added resize for optimization
      .webp({ quality: 75 }) // Slightly lower quality for better speed/size
      .toBuffer();
      
    return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
  } catch (error) {
    console.error('Image conversion error:', error);
    return base64String;
  }
};

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join_admin_room', () => {
    socket.join('admin_notifications');
    console.log(`Socket ${socket.id} joined admin room`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=';

// --- Normalization Helpers ---
const normalizePhone = (phone) => {
  if (!phone) return '';
  // Remove all non-numeric characters including '+'
  let clean = phone.replace(/\D/g, '');
  
  // Handle Iraq numbers (+964 or 07...)
  if (clean.startsWith('0')) {
    clean = '964' + clean.substring(1);
  } else if (clean.startsWith('9640')) {
    clean = '964' + clean.substring(4);
  } else if (!clean.startsWith('964') && clean.length === 10 && (clean.startsWith('77') || clean.startsWith('78') || clean.startsWith('75') || clean.startsWith('79'))) {
    // If it's a 10 digit number starting with a mobile prefix, assume it's Iraq
    clean = '964' + clean;
  }
  
  return clean;
};

const normalizeEmail = (email) => {
  if (!email) return '';
  return email.toLowerCase().trim();
};

// --- Email Configuration ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

let testAccount = null;
let testTransporter = null;

const sendEmail = async ({ to, subject, html }) => {
  const isSmtpConfigured = process.env.SMTP_USER && 
                          process.env.SMTP_USER !== 'your_user' && 
                          process.env.SMTP_USER !== '';
  
  if (!isSmtpConfigured) {
    if (!testAccount) {
      try {
        testAccount = await nodemailer.createTestAccount();
        testTransporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        console.log('--- TEST EMAIL SERVICE INITIALIZED ---');
        console.log('User:', testAccount.user);
        console.log('--------------------------------------');
      } catch (err) {
        console.error('Failed to create test account:', err.message);
        return { success: false, error: 'Could not initialize email service' };
      }
    }
    
    try {
      const info = await testTransporter.sendMail({
        from: '"Chinak Test" <noreply@chinak.com>',
        to,
        subject: `[TEST] ${subject}`,
        html
      });
      const url = nodemailer.getTestMessageUrl(info);
      console.log('--- TEST EMAIL SENT ---');
      console.log('To:', to);
      console.log('Preview URL:', url);
      console.log('-----------------------');
      return { success: true, test: true, url };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Chinak" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html
    });
    return { success: true, test: false };
  } catch (err) {
    console.error('SMTP Error:', err.message);
    return { success: false, error: err.message };
  }
};

const emailTemplate = (name, otpCode) => `
  <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
    <div style="text-align: center; margin-bottom: 30px;">
      <h1 style="color: #2563eb; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.025em;">CHINAK</h1>
    </div>
    <div style="color: #1e293b; line-height: 1.6;">
      <h2 style="font-size: 20px; font-weight: 700; margin-top: 0;">Verify your email</h2>
      <p>Hello ${name},</p>
      <p>Thank you for joining Chinak. Please use the following verification code to complete your registration:</p>
      <div style="background: #f1f5f9; padding: 24px; text-align: center; font-size: 36px; font-weight: 800; letter-spacing: 8px; margin: 30px 0; border-radius: 12px; color: #2563eb; border: 1px solid #e2e8f0;">
        ${otpCode}
      </div>
      <p style="font-size: 14px; color: #64748b;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
    </div>
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
      <p>&copy; ${new Date().getFullYear()} Chinak. All rights reserved.</p>
    </div>
  </div>
`;

const forgotPasswordTemplate = (otp) => `
  <div dir="rtl" style="font-family: sans-serif; text-align: right; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
    <h2 style="color: #2563eb;">إعادة تعيين كلمة المرور</h2>
    <p>لقد طلبت إعادة تعيين كلمة المرور الخاصة بك في تطبيق شيناك.</p>
    <p>كود التحقق الخاص بك هو:</p>
    <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; margin: 20px 0;">
      ${otp}
    </div>
    <p style="color: #6b7280; font-size: 14px;">هذا الكود صالح لمدة 30 دقيقة فقط.</p>
    <p>إذا لم تطلب هذا الكود، يمكنك تجاهل هذا البريد بأمان.</p>
  </div>
`;

app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins in development
    if (!origin || 
        origin.startsWith('http://localhost') || 
        origin.startsWith('https://localhost') || 
        origin.startsWith('http://127.0.0.1') || 
        origin.includes('ngrok-free.dev') || 
        origin.startsWith('http://192.168.')) {
      callback(null, true);
    } else {
      // For production, you should be more specific, but for now we allow to debug
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));

// Request Logger Middleware
app.use((req, res, next) => {
  const start = Date.now();
  if (req.path.startsWith('/api')) {
    console.log(`[API Request] ${req.method} ${req.path}`);
  }
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      const duration = Date.now() - start;
      console.log(`[API Response] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

app.use(compression({
  filter: (req, res) => {
    // Never compress SSE streams as it breaks real-time delivery
    const contentType = res.getHeader('Content-Type');
    const accept = req.headers['accept'];
    
    if (accept === 'text/event-stream' || (contentType && String(contentType).includes('text/event-stream'))) {
      return false;
    }
    
    // Default filter logic
    if (compression.filter) {
      return compression.filter(req, res);
    }
    return true;
  }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from the 'dist' directory
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));

// --- Authentication Middleware ---
const authenticateToken = async (req, res, next) => {
  try { fs.appendFileSync('e:/mynewproject2/server/perf.log', `[Auth] Checking token at ${new Date().toISOString()}\n`); } catch (e) {}
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('[Auth] No token provided');
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (token.startsWith('guest-token-')) {
    try {
      const guestSupabaseId = `guest:${token}`;
      let guestUser = await prisma.user.findUnique({
        where: { supabaseId: guestSupabaseId }
      });
      if (!guestUser) {
        guestUser = await prisma.user.create({
          data: {
            supabaseId: guestSupabaseId,
            name: 'زائر',
            role: 'GUEST',
            isVerified: true
          }
        });
      }
      req.user = {
        id: guestUser.id,
        role: guestUser.role,
        name: guestUser.name,
        supabaseId: guestUser.supabaseId
      };
      return next();
    } catch (guestError) {
      console.error('[Auth] Guest token handling failed:', guestError?.message || guestError);
      return res.status(401).json({ error: 'Authentication failed for guest token' });
    }
  }

  try {
    // Try Supabase Auth first
    console.log('[Auth] Checking Supabase token...');
    let supabaseUser = null;
    let supabaseError = null;
    
    try {
      // Only try Supabase if it looks like a Supabase token or if we want to be safe
      // Supabase tokens are usually very long JWTs
      const result = await supabase.auth.getUser(token);
      supabaseUser = result.data?.user;
      supabaseError = result.error;
    } catch (sbErr) {
      console.log('[Auth] Supabase getUser threw error (probably not a Supabase token):', sbErr.message);
    }
    
    if (supabaseUser) {
      console.log('[Auth] Supabase user found:', supabaseUser.email);
      // Find or create local user synced with Supabase
      let user = await prisma.user.findUnique({
        where: { supabaseId: supabaseUser.id }
      });

      if (!user) {
        console.log('[Auth] Syncing new Supabase user to local DB...');
        // Try finding by email
        user = await prisma.user.findUnique({
          where: { email: supabaseUser.email }
        });

        if (user) {
          // Update existing user with supabaseId and name if missing
          user = await prisma.user.update({
            where: { id: user.id },
            data: { 
              supabaseId: supabaseUser.id,
              name: user.name || supabaseUser.user_metadata?.full_name || supabaseUser.email.split('@')[0]
            }
          });
        } else {
          // Create new local user
          user = await prisma.user.create({
            data: {
              email: supabaseUser.email,
              supabaseId: supabaseUser.id,
              name: supabaseUser.user_metadata?.full_name || supabaseUser.email.split('@')[0] || 'User',
              role: 'USER',
              isVerified: true
            }
          });
        }
      } else if (!user.name || user.name === 'User') {
        // Update name if it's missing or just 'User'
        const sbName = supabaseUser.user_metadata?.full_name;
        if (sbName && sbName !== user.name) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name: sbName }
          });
        }
      }

      req.user = { 
        id: user.id, 
        role: user.role, 
        name: user.name,
        supabaseId: supabaseUser.id
      };
      return next();
    }

    // Fallback to local JWT if Supabase fails or returns no user
    console.log('[Auth] Supabase check failed, trying local JWT...');
    try {
      const verified = jwt.verify(token, JWT_SECRET);
      console.log('[Auth] Local JWT verified for user ID:', verified.id);
      
      // Ensure ID is a number if it's stored as a number in DB
      const userId = typeof verified.id === 'string' ? parseInt(verified.id) : verified.id;
      
      if (!userId || isNaN(userId)) {
        console.log('[Auth] Invalid user ID in token');
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      
      if (user) {
        // Update verified object with the numeric ID to be safe
        req.user = { ...verified, id: userId };
        next();
      } else {
        console.log('[Auth] User not found in local DB for ID:', userId);
        return res.status(401).json({ error: 'User not found' });
      }
    } catch (jwtError) {
      console.log('[Auth] Local JWT verification failed:', jwtError.message);
      // Debug: Log secret length/prefix to check consistency (DO NOT LOG FULL SECRET)
      console.log('[Auth] JWT_SECRET prefix:', JWT_SECRET.substring(0, 5) + '...');
      return res.status(401).json({ error: `Authentication failed: ${jwtError.message}` });
    }
  } catch (error) {
    console.error('[Auth] Unexpected error during authentication:', error);
    if (error.stack) console.error(error.stack);
    return res.status(401).json({ 
      error: 'Authentication failed', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
};

// --- WhatsApp OTP (OTPIQ) Endpoints ---
app.get('/api/auth/check-user/:phone', async (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const email = `${phone}@whatsapp.user`;
  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });
    res.json({ exists: !!user });
  } catch (error) {
    console.error('Check User Error:', error);
    res.status(500).json({ error: 'Failed to check user' });
  }
});

// --- Email Auth Endpoints ---
app.post('/api/auth/sync-supabase-user', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { name, supabaseId } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const user = await prisma.user.upsert({
      where: { email },
      update: { 
        supabaseId,
        name: name || undefined,
        isVerified: true 
      },
      create: {
        email,
        name: name || email.split('@')[0] || 'User',
        supabaseId,
        role: 'USER',
        isVerified: true
      }
    });

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '36500d' }
    );

    res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Sync Supabase User Error:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

app.get('/api/auth/check-email/:email', async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!email) return res.status(400).json({ error: 'Email is required' });
  
  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    // For simplicity in this demo, we check if they are in our DB.
    // In a real app with Supabase, we'd also check if they are in Supabase.
    // But since listUsers() is expensive and needs pagination, we'll stick to Prisma
    // and let the frontend handle "User already exists" from Supabase if needed.
    
    // Don't count WhatsApp fallback emails as "real" emails for this flow
    const isRealEmail = user && !user.email.endsWith('@whatsapp.user');
    res.json({ 
      exists: !!isRealEmail,
      hasPassword: !!(user && user.password)
    });
  } catch (error) {
    console.error('Check Email Error:', error);
    res.status(500).json({ error: 'Failed to check email' });
  }
});

app.post('/api/auth/email-login', async (req, res) => {
  let { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '36500d' }
    );

    res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Email Login Error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/email-signup', async (req, res) => {
  let { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password and name are required' });
  }
  email = email.toLowerCase().trim();

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.upsert({
      where: { email },
      update: {
        password: hashedPassword,
        name,
        otpCode,
        otpExpires,
        isVerified: false
      },
      create: {
        email,
        password: hashedPassword,
        name,
        otpCode,
        otpExpires,
        role: 'USER',
        isVerified: false
      }
    });

    // Send OTP via Email
    const result = await sendEmail({
      to: email,
      subject: 'Verify your email - Chinak',
      html: emailTemplate(name, otpCode)
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Failed to send verification email' });
    }

    res.json({ 
      message: 'تم إرسال كود التحقق بنجاح',
      testUrl: result.url 
    });
  } catch (error) {
    console.error('Email Signup Error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/resend-email-otp', async (req, res) => {
  let { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.status(400).json({ error: 'Account already verified' });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: { otpCode, otpExpires }
    });

    const result = await sendEmail({
      to: email,
      subject: 'Verify your email - Chinak',
      html: emailTemplate(user.name || 'User', otpCode)
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Failed to send email' });
    }

    res.json({ message: 'تم إعادة إرسال الكود بنجاح', testUrl: result.url });
  } catch (error) {
    console.error('Resend OTP Error:', error);
    res.status(500).json({ error: 'Resend failed' });
  }
});

app.post('/api/auth/verify-email-otp', async (req, res) => {
  let { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.otpCode !== code || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        otpCode: null,
        otpExpires: null,
        isVerified: true
      }
    });

    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role, email: updatedUser.email },
      JWT_SECRET,
      { expiresIn: '36500d' }
    );

    res.json({
      token,
      user: {
        id: updatedUser.id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role
      }
    });
  } catch (error) {
    console.error('Verify Email OTP Error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  let { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'لا يوجد حساب مرتبط بهذا البريد الإلكتروني' });
    }
    
    // If user exists but has no password, they likely signed up via social login
    if (!user.password) {
      return res.status(400).json({ error: 'هذا الحساب يستخدم تسجيل الدخول عبر Google أو WhatsApp. يرجى استخدام الطريقة الأصلية لتسجيل الدخول.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await prisma.user.update({
      where: { email },
      data: {
        resetPasswordOTP: otp,
        resetPasswordExpires: expires
      }
    });

    // Send Email
    const result = await sendEmail({
      to: email,
      subject: 'إعادة تعيين كلمة المرور - شيناك',
      html: forgotPasswordTemplate(otp)
    });

    if (!result.success) {
      return res.status(500).json({ error: 'Failed to send reset email' });
    }

    res.json({ 
      message: 'تم إرسال كود إعادة التعيين إلى بريدك الإلكتروني',
      testUrl: result.url 
    });
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ error: 'Forgot password failed' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  let { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  email = email.toLowerCase().trim();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || user.resetPasswordOTP !== otp || new Date() > user.resetPasswordExpires) {
      return res.status(400).json({ error: 'كود التحقق غير صحيح أو منتهي الصلاحية' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        resetPasswordOTP: null,
        resetPasswordExpires: null
      }
    });

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ error: 'فشل إعادة تعيين كلمة المرور' });
  }
});

app.post('/api/auth/phone-login', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password are required' });
  const email = `${phone}@whatsapp.user`;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'User not found' });
    if (!user.password) return res.status(400).json({ error: 'No password set for this account. Please reset your password.' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '36500d' }
    );

    res.json({
      token,
      user: {
        id: user.id.toString(),
        name: user.name,
        phone: user.email.split('@')[0],
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Phone login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/phone-reset-password', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { otpCode, newPassword } = req.body;
  if (!phone || !otpCode || !newPassword) return res.status(400).json({ error: 'Missing fields' });
  const email = `${phone}@whatsapp.user`;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.otpCode !== otpCode || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword, otpCode: null, otpExpires: null, isVerified: true }
    });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Phone reset password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

app.post('/api/auth/send-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { name, isResetPassword } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  // --- Google Play Test Account Logic ---
  const TEST_PHONE = '9647700000000'; // Normalized test phone
  const TEST_OTP = '123456';
  
  if (phone === TEST_PHONE) {
    console.log(`[TEST MODE] OTP requested for test account ${TEST_PHONE}`);
    const email = `demo_phone@example.com`;
    const otpExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour for test account
    
    // Hash the default test password "123456"
    const hashedTestPassword = await bcrypt.hash('123456', 10);
    
    await prisma.user.upsert({
      where: { email },
      update: { otpCode: TEST_OTP, otpExpires, phone: TEST_PHONE, password: hashedTestPassword },
      create: { 
        email, 
        phone: TEST_PHONE,
        otpCode: TEST_OTP, 
        otpExpires,
        password: hashedTestPassword,
        role: 'USER',
        isVerified: true,
        name: name || 'Demo Phone User'
      }
    });
    
    return res.json({ message: 'OTP sent successfully (Test Mode)' });
  }
  // --- End Test Account Logic ---

  const email = `${phone.replace('+', '')}@whatsapp.user`;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    const now = new Date();

    if (user) {
      const lastDate = user.lastWhatsappOtpDate ? new Date(user.lastWhatsappOtpDate) : null;
      
      // Calculate hours difference
      let hoursDiff = 24; // Default to a large number if no last date
      if (lastDate) {
        hoursDiff = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
      }

      // Check if it's a new hour window
      const isNewHourWindow = hoursDiff >= 1;
      
      let newCount = user.whatsappOtpCount || 0;
      
      if (isNewHourWindow) {
        newCount = 1; // Reset count for the new hour
      } else {
        newCount += 1;
      }

      // Check limits based on the request type
      if (isResetPassword) {
        // Limit: 1 OTP per hour for password reset
        if (!isNewHourWindow && user.whatsappOtpCount >= 1) {
          return res.status(429).json({ error: 'لقد طلبت كود إعادة تعيين كلمة المرور مؤخراً. يرجى الانتظار لمدة ساعة قبل المحاولة مرة أخرى.' });
        }
      } else {
        // Limit: 2 OTPs per hour for signup/general
        if (!isNewHourWindow && user.whatsappOtpCount >= 2) {
          return res.status(429).json({ error: 'لقد تجاوزت الحد الأقصى لطلبات الكود (مرتين في الساعة). يرجى المحاولة بعد ساعة.' });
        }
      }

      // Update count and last date
      await prisma.user.update({
        where: { email },
        data: {
          whatsappOtpCount: newCount,
          lastWhatsappOtpDate: now
        }
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert user and save OTP using email as the unique identifier
    await prisma.user.upsert({
      where: { email },
      update: { otpCode, otpExpires, name: name || undefined, phone },
      create: { 
        email, 
        phone,
        otpCode, 
        otpExpires,
        role: 'USER',
        isVerified: false,
        name: name || phone,
        whatsappOtpCount: 1,
        lastWhatsappOtpDate: now
      }
    });

    // Send via OTPIQ
    try {
      const otpiqResponse = await axios.post('https://api.otpiq.com/api/sms', { 
        "phoneNumber": phone.replace('+', ''), 
        "smsType": "verification", 
        "provider": "whatsapp-sms", 
        "verificationCode": otpCode 
      }, { 
        headers: { 
          'Authorization': 'Bearer sk_live_f891c78edd44691d580e53a95f9e8d138df94c3c', 
          'Content-Type': 'application/json' 
        } 
      });
      console.log('OTPIQ Response:', otpiqResponse.data);
    } catch (otpiqError) {
      console.error('OTPIQ sending failed, but continuing for development:', otpiqError.response?.data || otpiqError.message);
      console.log('-------------------------------------------');
      console.log(`DEVELOPMENT WHATSAPP OTP FOR ${phone}: ${otpCode}`);
      console.log('-------------------------------------------');
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Send OTP Error:', error.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { code, fullName, password } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });
  const email = `${phone}@whatsapp.user`;

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || user.otpCode !== code || new Date() > user.otpExpires) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const dataToUpdate = { 
      otpCode: null, 
      otpExpires: null, 
      isVerified: true,
      name: fullName || user.name || 'User'
    };

    if (password) {
      dataToUpdate.password = await bcrypt.hash(password, 10);
    }

    // Clear OTP and verify user
    const updatedUser = await prisma.user.update({
      where: { email },
      data: dataToUpdate
    });

    // --- Supabase Sync (Optional but recommended) ---
    // Try to find or create this user in Supabase too
    let supabaseId = updatedUser.supabaseId;
    if (!supabaseId) {
      try {
        // We use admin API to create the user without email confirmation
        const { data: sbData, error: sbError } = await supabase.auth.admin.createUser({
          email: updatedUser.email,
          email_confirm: true,
          user_metadata: { full_name: updatedUser.name },
          password: Math.random().toString(36).slice(-12) // Random password for WhatsApp users
        });

        if (!sbError && sbData.user) {
          supabaseId = sbData.user.id;
          await prisma.user.update({
            where: { id: updatedUser.id },
            data: { supabaseId }
          });
        }
      } catch (e) {
        console.warn('Supabase WhatsApp sync failed (non-fatal):', e);
      }
    }

    // Generate JWT for our app
    const token = jwt.sign(
      { id: updatedUser.id, role: updatedUser.role, email: updatedUser.email },
      JWT_SECRET,
      { expiresIn: '36500d' }
    );

    res.json({ 
      token, 
      user: {
        id: updatedUser.id.toString(), // Convert to string for consistency with frontend User interface
        name: updatedUser.name,
        phone: updatedUser.email.split('@')[0], // Extract phone from fallback email
        email: updatedUser.email,
        role: updatedUser.role
      } 
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.delete('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const supabaseId = req.user.supabaseId;

    // Delete from local database
    await prisma.user.delete({
      where: { id: userId }
    });

    // If there's a Supabase user, delete it from Supabase as well
    if (supabaseId) {
      const { error } = await supabase.auth.admin.deleteUser(supabaseId);
      if (error) {
        console.error('Supabase user deletion error (non-fatal):', error);
      }
    }

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatar: true,
        role: true,
        permissions: true
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...user,
      id: user.id.toString(), // Consistency with frontend
      phone: user.phone || user.email?.split('@')[0] || '' // Use phone field if available, fallback to email-based phone
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

app.put('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    let { name, email, avatar } = req.body;
    const userId = req.user.id;

    if (avatar && avatar.startsWith('data:image')) {
      avatar = await convertToWebP(avatar);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name, email, avatar },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true
      }
    });
    res.json({
      ...updatedUser,
      id: updatedUser.id.toString(),
      phone: updatedUser.email?.split('@')[0] || ''
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

const isAdmin = async (req, res, next) => {
  // Temporary: allow everyone to be admin
  next();
  return;
  
  try {
    // Check if user exists and has ADMIN role in DB to ensure role changes are immediate
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true }
    });

    if (user && user.role === 'ADMIN') {
      req.user.role = 'ADMIN'; // Sync token role with DB role for subsequent middlewares
      next();
    } else {
      res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Internal server error during authorization' });
  }
};

const hasPermission = (permission) => {
  return async (req, res, next) => {
    // Temporary: allow everyone to have all permissions
    next();
    return;

    try {
      if (req.user.role === 'ADMIN') {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { permissions: true, name: true }
        });
        
        req.user.name = user.name;
        const permissions = JSON.parse(user.permissions || '[]');
        // Super admins (no permissions set or "*" in permissions) have full access
        if (permissions.length === 0 || permissions.includes('*') || permissions.includes(permission)) {
          return next();
        }
        return res.status(403).json({ error: `Access denied. Required permission: ${permission}` });
      }
      res.status(403).json({ error: 'Access denied. Admin role required.' });
    } catch (error) {
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
};

// --- Logging and Notifications Helpers ---
const safeParseId = (id) => {
  if (id === null || id === undefined) return id;
  const stringId = String(id);
  if (/^\d+$/.test(stringId)) {
    return parseInt(stringId, 10);
  }
  return stringId;
};

const logActivity = async (adminId, adminName, action, details, targetType, targetId) => {
  try {
    await prisma.activityLog.create({
      data: {
        adminId,
        adminName,
        action,
        details: typeof details === 'string' ? details : JSON.stringify(details),
        targetType,
        targetId: targetId ? safeParseId(targetId) : null
      }
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};

// --- Debug: Check Recent Products ---
app.get('/api/debug/recent-products', async (req, res) => {
  try {
    const products = await prisma.product.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { options: true }
      });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const createNotification = async (title, message, type, link) => {
  try {
    await prisma.adminNotification.create({
      data: { title, message, type, link }
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
};

// ADMIN: Get stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  console.log('GET /api/admin/stats hit by user:', req.user.id, req.user.name);
  try {
    const [
      totalProducts, 
      totalOrders, 
      totalUsers, 
      recentOrders,
      pendingOrders,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.order.count(),
      prisma.user.count(),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true } } }
      }),
      prisma.order.count({ where: { status: 'PENDING' } }),
    ]);

    const totalSales = await prisma.order.aggregate({
      _sum: { total: true },
      _count: { id: true },
      _avg: { total: true },
      where: { status: 'DELIVERED' }
    });

    // Get sales by month for the last 12 months
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    
    const ordersByMonth = await prisma.order.findMany({
      where: {
        status: 'DELIVERED',
        createdAt: { gte: lastYear }
      },
      select: {
        total: true,
        createdAt: true
      }
    });

    // Group by month
    const monthlySales = Array(12).fill(0).map((_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      const month = d.getMonth();
      const year = d.getFullYear();
      
      const monthTotal = ordersByMonth
        .filter(o => {
          const od = new Date(o.createdAt);
          return od.getMonth() === month && od.getFullYear() === year;
        })
        .reduce((sum, o) => sum + o.total, 0);
        
      return {
        month: d.toLocaleString('en-US', { month: 'short' }),
        total: monthTotal
      };
    });

    res.json({
      totalProducts,
      totalOrders,
      totalUsers,
      totalSales: totalSales._sum.total || 0,
      averageOrderValue: totalSales._avg.total || 0,
      deliveredOrders: totalSales._count.id || 0,
      recentOrders,
      monthlySales,
      pendingOrders
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// ADMIN: Get all orders
app.get('/api/admin/orders', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status, startDate, endDate, minPrice, maxPrice, province, search } = req.query;
    
    let where = {};
    
    if (status && status !== 'ALL') {
      where.status = status;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    
    if (minPrice || maxPrice) {
      where.total = {};
      if (minPrice) where.total.gte = parseFloat(minPrice);
      if (maxPrice) where.total.lte = parseFloat(maxPrice);
    }
    
    if (province && province !== 'ALL') {
      where.address = {
        province: province
      };
    }
    
    if (search) {
      where.OR = [
        { id: safeParseId(search) },
        { user: { name: { contains: search } } },
        { user: { email: { contains: search } } },
        { address: { phone: { contains: search } } }
      ].filter(condition => Object.values(condition)[0] !== undefined);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: { name: true, email: true }
          },
          address: true
          // Items removed for list performance
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      orders,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ADMIN: Get single order details
app.get('/api/admin/orders/:id', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) },
      include: {
        user: {
          select: { name: true, email: true }
        },
        address: true,
        items: {
          include: { 
            product: {
              include: {
                options: true
              }
            },
            variant: { select: productVariantSelect }
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// --- User Notifications ---
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.notification.update({
      where: { 
        id: safeParseId(id),
        userId: req.user.id // Security: ensure notification belongs to user
      },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { 
        userId: req.user.id,
        isRead: false 
      },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.notification.delete({
      where: { 
        id: safeParseId(id),
        userId: req.user.id // Security
      }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

app.delete('/api/notifications', authenticateToken, async (req, res) => {
  try {
    await prisma.notification.deleteMany({
      where: { userId: req.user.id }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Helper for user notifications
const createUserNotification = async (userId, title, description, type, icon, color, link) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        description,
        type,
        icon,
        color,
        link
      }
    });
    // Optional: Emit via socket.io for real-time update
    io.emit(`user_notification_${userId}`, notification);
    return notification;
  } catch (error) {
    console.error('Failed to create user notification:', error);
  }
};

const sendOrderStatusNotification = async (orderId, status, userId) => {
  try {
    let title = '';
    let description = '';
    let icon = '';
    let color = 'blue';

    switch (status) {
      case 'AWAITING_PAYMENT':
        title = 'بانتظار الدفع 💳';
        description = `طلبك رقم #${orderId} بانتظار إتمام عملية الدفع للمباشرة بالتجهيز.`;
        icon = 'payments';
        color = 'orange';
        break;
      case 'PREPARING':
        title = 'جاري تجهيز طلبك 📦';
        description = `طلبك رقم #${orderId} قيد التجهيز الآن في مستودعاتنا.`;
        icon = 'inventory_2';
        color = 'indigo';
        break;
      case 'SHIPPED':
        title = 'خرج طلبك للشحن! 🚢';
        description = `بشرى سارة! طلبك رقم #${orderId} تم شحنه من المصدر وهو في طريقه إلى مستودعاتنا.`;
        icon = 'ship';
        color = 'blue';
        break;
      case 'ARRIVED_IRAQ':
        title = 'وصل طلبك إلى العراق 🇮🇶';
        description = `وصل طلبك رقم #${orderId} إلى العراق، سيتم تسليمه للمندوب قريباً.`;
        icon = 'location_on';
        color = 'cyan';
        break;
      case 'DELIVERED':
        title = 'تم توصيل طلبك بنجاح ✅';
        description = `تم تسليم الطلب رقم #${orderId}. شكراً لثقتك بنا، نتمنى أن تنال المنتجات إعجابك!`;
        icon = 'verified';
        color = 'green';
        break;
      case 'CANCELLED':
        title = 'تم إلغاء الطلب ❌';
        description = `تم إلغاء طلبك رقم #${orderId}. إذا لم تكن أنت من قام بالإلغاء، يرجى التواصل مع الدعم.`;
        icon = 'cancel';
        color = 'red';
        break;
      default:
        title = 'تحديث في حالة الطلب';
        description = `هناك تحديث جديد لطلبك رقم #${orderId}. يمكنك التحقق من التفاصيل الآن.`;
        icon = 'notifications';
        color = 'blue';
    }

    await createUserNotification(
      userId,
      title,
      description,
      'order',
      icon,
      color,
      `/shipping-tracking?id=${orderId}`
    );

    // Emit real-time order update event
    io.emit(`order_status_updated_${orderId}`, { 
      orderId, 
      status,
      timestamp: new Date().toISOString()
    });

    io.emit('order_status_update', { id: safeParseId(orderId), status });
  } catch (error) {
    console.error('Failed to send order status notification:', error);
  }
};

// ADMIN: Update order status
app.put('/api/admin/orders/:id/status', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updatedOrder = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { status }
    });
    
    await sendOrderStatusNotification(id, status, order.userId);
    
    res.json(updatedOrder);
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// ADMIN: Update order internal note
app.put('/api/admin/orders/:id/note', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const order = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { internalNote: note }
    });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order note' });
  }
});

app.put('/api/admin/orders/:id/international-fee', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { id } = req.params;
    const { fee } = req.body;
    const newFee = parseFloat(fee) || 0;

    // Get current order to calculate new total
    const currentOrder = await prisma.order.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!currentOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const oldFee = currentOrder.internationalShippingFee || 0;
    const newTotal = Math.ceil((currentOrder.total - oldFee + newFee) / 250) * 250;
    
    // Automatically move to AWAITING_PAYMENT when fee is set, but only if it was PENDING
    let newStatus = currentOrder.status;
    if (currentOrder.status === 'PENDING') {
      newStatus = 'AWAITING_PAYMENT';
    }

    const order = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { 
        internationalShippingFee: newFee,
        total: newTotal,
        status: newStatus
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        address: true,
        items: {
          include: { product: true, variant: { select: productVariantSelect } }
        }
      }
    });

    // Send notification about status change if it actually changed
    if (newStatus !== currentOrder.status) {
      await sendOrderStatusNotification(id, newStatus, order.user.id);
    }

    res.json(order);
  } catch (error) {
    console.error('Error updating international fee:', error);
    res.status(500).json({ error: 'Failed to update international shipping fee' });
  }
});

// ADMIN: Get all reviews
app.get('/api/admin/reviews', authenticateToken, isAdmin, hasPermission('manage_reviews'), async (req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      include: {
        user: { select: { name: true, email: true } },
        product: { select: { name: true, image: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ADMIN: Delete review
app.delete('/api/admin/reviews/:id', authenticateToken, isAdmin, hasPermission('manage_reviews'), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.review.delete({
      where: { id: safeParseId(id) }
    });
    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Bulk update orders status
app.post('/api/admin/orders/bulk-status', authenticateToken, isAdmin, hasPermission('manage_orders'), async (req, res) => {
  try {
    const { ids, status } = req.body;
    await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: { status }
    });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_UPDATE_ORDER_STATUS',
      { ids, status },
      'ORDER'
    );
    
    // Notify about bulk status update
    io.emit('bulk_order_status_update', { ids, status });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk update orders' });
  }
});

// ADMIN: Fetch all activity logs
app.get('/api/admin/activity-logs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const logs = await prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// ADMIN: Get notifications
app.get('/api/admin/notifications', authenticateToken, isAdmin, async (req, res) => {
  try {
    const notifications = await prisma.adminNotification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ADMIN: Mark notification as read
app.put('/api/admin/notifications/:id/read', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.adminNotification.update({
      where: { id: safeParseId(id) },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ADMIN: Mark all notifications as read
app.put('/api/admin/notifications/read-all', authenticateToken, isAdmin, async (req, res) => {
  try {
    await prisma.adminNotification.updateMany({
      where: { isRead: false },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ADMIN: Trigger AI processing for a product
app.post('/api/admin/products/:id/process-ai', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const productId = safeParseId(id);
    
    console.log(`[Admin] Manually triggering AI processing for product ${productId}`);
    
    // Run asynchronously to not block response
    processProductAI(productId).catch(err => {
      console.error(`[Admin] Background AI processing failed for ${productId}:`, err);
    });

    res.json({ success: true, message: 'AI processing started in background' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger AI processing' });
  }
});

// ADMIN: Bulk update products status
app.post('/api/admin/products/bulk-status', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids, isActive } = req.body;
    
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const parsedIds = ids.map(id => safeParseId(id)).filter(id => typeof id === 'number');

    if (parsedIds.length === 0) {
      return res.json({ success: true });
    }

    await prisma.product.updateMany({
      where: { id: { in: parsedIds } },
      data: { isActive }
    });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_UPDATE_PRODUCT_STATUS',
      { ids: parsedIds, isActive },
      'PRODUCT'
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Bulk status update error:', error);
    res.status(500).json({ error: 'Failed to bulk update products' });
  }
});

// ADMIN: Bulk delete products
app.post('/api/admin/products/bulk-delete', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No product IDs provided' });
    }

    // Parse IDs to ensure they are numbers
    const productIds = ids.map(id => safeParseId(id));

    console.log(`[Bulk Delete] Deleting ${productIds.length} products:`, productIds);
    
    // Delete related records for all products in bulk
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { productId: { in: productIds } } }), // Delete OrderItems first
      prisma.productImage.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.productOption.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.wishlistItem.deleteMany({ where: { productId: { in: productIds } } }),
      prisma.review.deleteMany({ where: { productId: { in: productIds } } }),
    ]);

    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    
    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_DELETE_PRODUCTS',
      { ids: productIds },
      'PRODUCT'
    );
    
    res.json({ success: true, count: productIds.length });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: 'Failed to bulk delete products: ' + error.message });
  }
});

// ADMIN: Get all users
app.get('/api/admin/users', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const isArabicSearch = typeof search === 'string' && /[\u0600-\u06FF]/.test(search);

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          permissions: true,
          createdAt: true,
          _count: {
            select: { orders: true }
          },
          orders: {
            select: {
              total: true
            }
          }
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    const usersWithTotalSpend = users.map(user => {
      const totalSpend = user.orders.reduce((sum, order) => sum + (order.total || 0), 0);
      const { orders, ...userWithoutOrders } = user;
      return {
        ...userWithoutOrders,
        totalSpend
      };
    });

    res.json({
      users: usersWithTotalSpend,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Fetch admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ADMIN: Update user role
app.put('/api/admin/users/:id/role', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['USER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await prisma.user.update({
      where: { id: safeParseId(id) },
      data: { role }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// ADMIN: Update user permissions
app.put('/api/admin/users/:id/permissions', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;
    
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'Permissions must be an array' });
    }

    const user = await prisma.user.update({
      where: { id: safeParseId(id) },
      data: { permissions: JSON.stringify(permissions) }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user permissions' });
  }
});

// ADMIN: Get all coupons
app.get('/api/admin/coupons', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const coupons = await prisma.coupon.findMany({
      where: {
        NOT: {
          code: { startsWith: 'DELETED_' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(coupons);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// ADMIN: Create coupon
app.post('/api/admin/coupons', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const { 
      code, 
      discountType, 
      discountValue, 
      minOrderAmount, 
      maxDiscount, 
      endDate, 
      usageLimit,
      isPublic 
    } = req.body;
    const coupon = await prisma.coupon.create({
      data: {
        code,
        discountType,
        discountValue: parseFloat(discountValue),
        minOrderAmount: parseFloat(minOrderAmount) || 0,
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        endDate: new Date(endDate),
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        isPublic: isPublic !== undefined ? isPublic : true
      }
    });
    res.status(201).json(coupon);
  } catch (error) {
    console.error('Create coupon error:', error);
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

// ADMIN: Update coupon
app.put('/api/admin/coupons/:id', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      code, 
      discountType, 
      discountValue, 
      minOrderAmount, 
      maxDiscount, 
      endDate, 
      usageLimit, 
      isActive,
      isPublic 
    } = req.body;
    const coupon = await prisma.coupon.update({
      where: { id: safeParseId(id) },
      data: {
        code,
        discountType,
        discountValue: parseFloat(discountValue),
        minOrderAmount: parseFloat(minOrderAmount) || 0,
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        endDate: new Date(endDate),
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        isActive,
        isPublic: isPublic !== undefined ? isPublic : true
      }
    });
    res.json(coupon);
  } catch (error) {
    console.error('Update coupon error:', error);
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

// ADMIN: Delete coupon
app.delete('/api/admin/coupons/:id', authenticateToken, isAdmin, hasPermission('manage_coupons'), async (req, res) => {
  try {
    const { id } = req.params;
    const couponId = safeParseId(id);

    // Check if coupon is used in any orders
    const ordersWithCoupon = await prisma.order.count({
      where: { couponId }
    });

    if (ordersWithCoupon > 0) {
      // If used in orders, we can't delete it without breaking order history
      // Instead, we deactivate it and mark it as deleted (using a naming convention or isActive)
      await prisma.coupon.update({
        where: { id: couponId },
        data: { 
          isActive: false,
          code: `DELETED_${Date.now()}_${couponId}` // Rename to free up the code
        }
      });
      return res.json({ message: 'Coupon used in orders, deactivated instead of deleted' });
    }

    // Also delete coupon usage records if any
    await prisma.couponUsage.deleteMany({
      where: { couponId }
    });

    await prisma.coupon.delete({ where: { id: couponId } });
    res.json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Delete coupon error:', error);
    res.status(500).json({ error: 'Failed to delete coupon: ' + error.message });
  }
});

// ADMIN: Generate summary report for dashboard
app.get('/api/admin/reports/summary', authenticateToken, isAdmin, hasPermission('view_reports'), async (req, res) => {
  try {
    const now = new Date();
    
    // Daily stats
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const dailyOrders = await prisma.order.findMany({
      where: { createdAt: { gte: todayStart }, status: 'DELIVERED' },
      select: { total: true }
    });
    
    // Weekly stats
    const lastWeek = new Date(new Date().setDate(new Date().getDate() - 7));
    const weeklyOrders = await prisma.order.findMany({
      where: { createdAt: { gte: lastWeek }, status: 'DELIVERED' },
      select: { total: true }
    });
    
    // Monthly stats
    const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1));
    const monthlyOrders = await prisma.order.findMany({
      where: { createdAt: { gte: lastMonth }, status: 'DELIVERED' },
      select: { total: true }
    });

    // Top Products (Monthly)
    const topProducts = await prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true },
      where: { order: { createdAt: { gte: lastMonth }, status: 'DELIVERED' } },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5
    });

    let topProductsWithDetails = [];
    if (topProducts && topProducts.length > 0) {
      const productDetails = await prisma.product.findMany({
        where: { id: { in: topProducts.map(p => p.productId) } },
        select: { id: true, name: true }
      });

      topProductsWithDetails = topProducts.map(p => {
        const details = productDetails.find(pd => pd.id === p.productId);
        // Calculate revenue for this product
        // For simplicity in this mock, we'll just use quantity
        return {
          id: p.productId,
          name: details?.name || 'Unknown',
          count: p._sum.quantity,
          revenue: p._sum.quantity * 30000 // Mock revenue calculation
        };
      });
    }

    res.json({
      daily: {
        totalSales: dailyOrders.reduce((sum, o) => sum + o.total, 0),
        orderCount: dailyOrders.length
      },
      weekly: {
        totalSales: weeklyOrders.reduce((sum, o) => sum + o.total, 0),
        orderCount: weeklyOrders.length
      },
      monthly: {
        totalSales: monthlyOrders.reduce((sum, o) => sum + o.total, 0),
        orderCount: monthlyOrders.length
      },
      topProducts: topProductsWithDetails
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ADMIN: Send test automated report
app.post('/api/admin/reports/send-test', authenticateToken, isAdmin, hasPermission('view_reports'), async (req, res) => {
  try {
    await sendAutomatedReports();
    res.json({ message: 'Reports sent successfully to all admins' });
  } catch (error) {
    console.error('Test report error:', error);
    res.status(500).json({ error: 'Failed to send test reports' });
  }
});

// --- User Interaction Tracking ---
app.post('/api/track', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { productId, type, weight, sessionId } = body;
    
    // Get user ID if authenticated
    const authHeader = req.headers['authorization'];
    let userId = null;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
      } catch (e) {}
    }

    if (!productId || !type) {
      return res.status(400).json({ error: 'Product ID and Type are required' });
    }

    const normalizedProductId = String(productId).startsWith('rapid-')
      ? String(productId).replace(/^rapid-/, '')
      : productId;
    const parsedProductId = safeParseId(normalizedProductId);
    if (typeof parsedProductId !== 'number' || !Number.isSafeInteger(parsedProductId) || parsedProductId > 2147483647) {
      return res.json({ success: true, skipped: true });
    }

    const interactionData = {
      userId: userId ? safeParseId(userId) : null,
      sessionId: sessionId || 'guest',
      productId: parsedProductId,
      type,
      weight: weight || 1.0
    };

    try {
      await prisma.userInteraction.create({
        data: interactionData
      });
    } catch (error) {
      if (!isUniqueIdConstraintError(error, 'UserInteraction')) {
        throw error;
      }
      await repairTableIdSequence('UserInteraction');
      await prisma.userInteraction.create({
        data: interactionData
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Tracking error:', error);
    res.json({ success: true, skipped: true });
  }
});

// Automated Reports Logic
const generateWeeklyReport = async () => {
  const lastWeek = new Date(new Date().setDate(new Date().getDate() - 7));
  const weeklyOrders = await prisma.order.findMany({
    where: { createdAt: { gte: lastWeek }, status: 'DELIVERED' },
    select: { total: true }
  });

  const totalSales = weeklyOrders.reduce((sum, o) => sum + o.total, 0);
  const orderCount = weeklyOrders.length;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `
    <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right;">
      <h2 style="color: #4f46e5;">تقرير الأداء الأسبوعي للمتجر</h2>
      <p>إليك ملخص لأداء المتجر خلال الأسبوع الماضي:</p>
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <p><strong>إجمالي المبيعات:</strong> ${totalSales.toLocaleString()} ج.م</p>
        <p><strong>عدد الطلبات المكتملة:</strong> ${orderCount}</p>
        <p><strong>متوسط قيمة الطلب:</strong> ${orderCount > 0 ? (totalSales / orderCount).toLocaleString() : 0} ج.م</p>
      </div>
      <p>يمكنك عرض المزيد من التفاصيل من خلال <a href="${frontendUrl}/admin" style="color: #4f46e5; text-decoration: none;">لوحة تحكم المشرف</a>.</p>
    </div>
  `;
};

const sendAutomatedReports = async () => {
  try {
    const admins = await prisma.user.findMany({ 
      where: { 
        role: 'ADMIN',
        // In a real app, you might check if they've opted in for reports
      } 
    });
    
    if (admins.length === 0) return;

    console.log(`[Automated Report] Generating weekly performance summary for ${admins.length} admins...`);
    
    const reportHtml = await generateWeeklyReport();
    
    for (const admin of admins) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_FROM || '"My Store" <noreply@mystore.com>',
          to: admin.email,
          subject: 'تقرير الأداء الأسبوعي للمتجر',
          html: reportHtml
        });
        console.log(`[Automated Report] Report sent to ${admin.email}`);
      } catch (err) {
        console.error(`[Automated Report] Failed to send to ${admin.email}:`, err.message);
      }
    }
    
    console.log('[Automated Report] Weekly report process completed.');
  } catch (error) {
    console.error('[Automated Report] Global failure:', error);
  }
};

// Run every week (simulated with 7 days in ms)
// setInterval(sendAutomatedReports, 7 * 24 * 60 * 60 * 1000);
// Also run once on startup after a delay
// setTimeout(sendAutomatedReports, 10000);

// USER: Validate coupon
app.post('/api/coupons/validate', authenticateToken, async (req, res) => {
  try {
    const { code, orderAmount } = req.body;
    const coupon = await prisma.coupon.findUnique({
      where: { code }
    });

    if (!coupon || !coupon.isActive) {
      return res.status(400).json({ error: 'كود الخصم غير صحيح أو غير فعال' });
    }

    // Check if user has already used this coupon
    const usage = await prisma.couponUsage.findFirst({
      where: {
        couponId: coupon.id,
        userId: req.user.id
      }
    });

    if (usage) {
      return res.status(400).json({ error: 'لقد استخدمت هذا الكوبون مسبقاً' });
    }

    // For private coupons, check if it's already used by anyone
    if (!coupon.isPublic && coupon.usageCount >= 1) {
      return res.status(400).json({ error: 'تم استخدام هذا الكوبون من قبل مستخدم آخر' });
    }

    const now = new Date();
    if (now < coupon.startDate || now > coupon.endDate) {
      return res.status(400).json({ error: 'انتهت صلاحية هذا الكوبون' });
    }

    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      return res.status(400).json({ error: 'تم الوصول للحد الأقصى لاستخدام هذا الكوبون' });
    }

    if (orderAmount < coupon.minOrderAmount) {
      return res.status(400).json({ error: `الحد الأدنى للطلب لاستخدام هذا الكوبون هو ${coupon.minOrderAmount.toLocaleString()} د.ع` });
    }

    let discount = 0;
    if (coupon.discountType === 'PERCENTAGE') {
      discount = (orderAmount * coupon.discountValue) / 100;
      if (coupon.maxDiscount && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
      }
    } else {
      discount = coupon.discountValue;
    }

    res.json({
      id: coupon.id,
      code: coupon.code,
      discountAmount: discount,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minOrderAmount: coupon.minOrderAmount,
      maxDiscount: coupon.maxDiscount
    });
  } catch (error) {
    res.status(500).json({ error: 'فشل التحقق من الكوبون' });
  }
});

// USER: Get all available coupons
app.get('/api/coupons', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    
    // Get all active coupons within date range
    const coupons = await prisma.coupon.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      include: {
        usedBy: {
          where: { userId }
        }
      }
    });

    // Filter based on usage logic
    const availableCoupons = coupons.filter(c => {
      // 1. Check if user has already used it (if public, once per user)
      if (c.usedBy.length > 0) return false;

      // 2. Check global usage limit for private coupons
      if (!c.isPublic && c.usageCount >= 1) return false;

      // 3. Check custom usage limit if set
      if (c.usageLimit && c.usageCount >= c.usageLimit) return false;

      return true;
    });

    // Transform to exclude usage info from response
    const sanitizedCoupons = availableCoupons.map(({ usedBy, ...coupon }) => coupon);

    res.json(sanitizedCoupons);
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

app.get('/api/admin/reports/abandoned-carts', authenticateToken, isAdmin, async (req, res) => {
  try {
    // Abandoned carts are users who have items in their cart but haven't placed an order in the last 24 hours
    // or simply have items in cart while their last order is older than their cart items.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const abandonedCarts = await prisma.user.findMany({
      where: {
        cart: {
          some: {
            updatedAt: { lte: twentyFourHoursAgo }
          }
        },
        OR: [
          { orders: { none: {} } },
          { orders: { some: { createdAt: { lte: twentyFourHoursAgo } } } }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        cart: {
          include: {
            product: true
          }
        },
        updatedAt: true
      }
    });

    const formattedCarts = abandonedCarts.map(user => {
      const total = user.cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
      const itemCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
      return {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userAvatar: user.avatar,
        itemCount,
        total,
        items: user.cart.map(item => ({
          productId: item.productId,
          productName: item.product.name,
          productImage: item.product.image,
          price: item.product.price,
          quantity: item.quantity
        })),
        lastActivity: user.updatedAt
      };
    });

    res.json(formattedCarts);
  } catch (error) {
    console.error('Failed to fetch abandoned carts:', error);
    res.status(500).json({ error: 'Failed to fetch abandoned carts' });
  }
});

app.post('/api/shipping/calculate', authenticateToken, async (req, res) => {
  try {
    const { items, method = 'air' } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items are required' });
    }
    
    const shippingInfo = await calculateOrderShipping(items, method);
    res.json(shippingInfo);
  } catch (error) {
    console.error('Shipping calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate shipping' });
  }
});

// Products routes
let cachedStoreSettings = null;
let cachedStoreSettingsTime = 0;
const productsResponseCache = new Map();
const PRODUCTS_RESPONSE_TTL_MS = 30000;

const isDbConnectionError = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const name = String(error?.name || '');
  return code === 'P1001' || code === 'P1017' || code === 'P2024'
    || name === 'PrismaClientInitializationError'
    || message.includes("Can't reach database server")
    || message.includes('Server has closed the connection')
    || message.includes('timed out')
    || message.includes('Engine is not yet connected')
    || message.includes('Connection terminated unexpectedly')
    || message.includes('Transaction API error');
};

let prismaReconnectPromise = null;
const reconnectPrisma = async (attempt = 1) => {
  if (!prismaReconnectPromise) {
    prismaReconnectPromise = (async () => {
      try { await prisma.$disconnect(); } catch {}
      await sleep(500 * attempt);
      await prisma.$connect();
    })();
  }
  try {
    await prismaReconnectPromise;
  } finally {
    prismaReconnectPromise = null;
  }
};

const withDbRetry = async (task, attempts = 3) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isDbConnectionError(error) || attempt === attempts) {
        throw error;
      }
      try {
        await reconnectPrisma(attempt);
      } catch {}
    }
  }
  throw lastError;
};

const mapProductToRapidItem = (product) => {
  const media = Array.isArray(product?.images) ? product.images : [];
  const normalizedImages = media
    .map((img) => typeof img === 'string' ? img : (img?.url || img?.image || ''))
    .filter(Boolean);
  const firstImage = product?.image || normalizedImages[0] || '';
  const itemId = String(product?.id || '').trim();
  const itemUrl = product?.purchaseUrl || (itemId ? `https://item.taobao.com/item.htm?id=${encodeURIComponent(itemId)}` : '');
  const price = Number(product?.price ?? 0);
  return {
    itemId,
    itemIdStr: null,
    title: product?.name || 'Product',
    image: firstImage,
    images: normalizedImages,
    itemUrl,
    taobaoItemUrl: itemUrl,
    detail_url: itemUrl,
    sales: '0',
    price,
    originalPrice: price,
    priceMoney: {
      Price: price
    }
  };
};

const normalizeRapidItem = (item) => {
  if (!item || typeof item !== 'object') return null;
  const rapidErrorCode = String(item?.ErrorCode || item?.errorCode || '').trim().toLowerCase();
  const rapidSubError = String(item?.SubErrorCode?.Value || item?.subErrorCode?.value || '').trim();
  if (rapidErrorCode === 'notfound' || rapidSubError === 'ItemWithId' || item?.HasError === true) return null;
  const itemId = String(item?.itemId ?? item?.ItemId ?? item?.id ?? item?.Id ?? '').trim();
  if (isRapidItemBlocked(itemId)) return null;
  const title = item?.title ?? item?.Title ?? item?.name ?? item?.Name;
  const image = item?.image ?? item?.Image ?? item?.mainPictureUrl ?? item?.MainPictureUrl ?? item?.MainPictureURL;
  const imagesRaw = item?.images ?? item?.Images ?? item?.pictureUrls ?? item?.PictureUrls ?? item?.PictureUrl ?? [];
  const images = Array.isArray(imagesRaw) ? imagesRaw : [imagesRaw].filter(Boolean);
  const itemUrl = item?.taobaoItemUrl
    ?? item?.TaobaoItemUrl
    ?? item?.itemUrl
    ?? item?.ItemUrl
    ?? item?.detail_url
    ?? item?.DetailUrl;
  
  // Robust price extraction
  let price = item?.price ?? item?.Price;
  if (price && typeof price === 'object') {
    price = price?.ConvertedPriceWithoutSign
      ?? price?.OriginalPrice
      ?? price?.ConvertedPriceList?.Internal?.Price
      ?? price?.ConvertedPriceList?.DisplayedMoneys?.[0]?.Price
      ?? price?.PriceWithoutDelivery?.ConvertedPriceList?.Internal?.Price
      ?? price?.OneItemPriceWithoutDelivery?.ConvertedPriceList?.Internal?.Price;
  }
  if (price === undefined || price === null) {
    price = item?.Price?.ConvertedPriceWithoutSign 
      ?? item?.Price?.OriginalPrice 
      ?? item?.PromotionPrice?.ConvertedPriceList?.Internal?.Price
      ?? item?.originalPrice 
      ?? item?.OriginalPrice 
      ?? item?.priceValue 
      ?? item?.PriceValue;
  }

  const numericPrice = (() => {
    if (typeof price === 'number') return Number.isFinite(price) ? price : 0;
    if (typeof price === 'string') {
      const parsed = parseFloat(price.replace(/[^\d.]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const coerced = Number(price);
    return Number.isFinite(coerced) ? coerced : 0;
  })();

  const normalized = {
    ...item,
    itemId: item?.itemId ?? item?.ItemId ?? item?.id ?? item?.Id ?? itemId,
    title: item?.title ?? item?.Title ?? title,
    image: item?.image ?? item?.Image ?? item?.mainPictureUrl ?? item?.MainPictureUrl ?? item?.MainPictureURL ?? image,
    images,
    itemUrl: item?.itemUrl ?? item?.ItemUrl ?? item?.taobaoItemUrl ?? item?.TaobaoItemUrl ?? itemUrl,
    taobaoItemUrl: item?.taobaoItemUrl ?? item?.TaobaoItemUrl ?? item?.itemUrl ?? item?.ItemUrl ?? itemUrl,
    detail_url: item?.detail_url ?? item?.DetailUrl ?? itemUrl,
    price: numericPrice,
    originalPrice: numericPrice,
    priceMoney: { Price: numericPrice }
  };
  
  return normalized;
};

const extractRapidItemsPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload?.items,
    payload?.Items,
    payload?.Result?.Items,
    payload?.Result?.Items?.Items,
    payload?.Result?.Items?.Content,
    payload?.Result?.Items?.Items?.Content,
    payload?.result?.items,
    payload?.result?.items?.items,
    payload?.result?.items?.content,
    payload?.data?.items,
    payload?.Data?.Items,
    payload?.ProviderBody?.Items,
    payload?.providerBody?.items
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
};

const RAPID_ITEM_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const RAPID_SEARCH_REQUEST_CACHE_TTL_MS = 10 * 60 * 1000;
const normalizeRapidCacheItemId = (value) => String(value || '').trim().replace(/^rapid-/i, '');
let rapidItemCacheTableReady = false;
const blockedRapidItemsFilePath = path.join(__dirname, 'data', 'blocked_rapid_items.json');
let blockedRapidItemsLoaded = false;
const blockedRapidItemsSet = new Set();
const loadBlockedRapidItems = () => {
  if (blockedRapidItemsLoaded) return;
  blockedRapidItemsLoaded = true;
  try {
    if (!fs.existsSync(blockedRapidItemsFilePath)) return;
    const raw = fs.readFileSync(blockedRapidItemsFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const ids = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.blockedItemIds) ? parsed.blockedItemIds : []);
    ids.forEach((entry) => {
      const normalized = normalizeRapidCacheItemId(entry);
      if (normalized) blockedRapidItemsSet.add(normalized);
    });
  } catch (error) {
    console.error('[RapidBlocklist] load failed:', error?.message || error);
  }
};
const persistBlockedRapidItems = () => {
  try {
    fs.mkdirSync(path.dirname(blockedRapidItemsFilePath), { recursive: true });
    fs.writeFileSync(
      blockedRapidItemsFilePath,
      JSON.stringify({
        blockedItemIds: Array.from(blockedRapidItemsSet).sort(),
        updatedAt: new Date().toISOString()
      }, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('[RapidBlocklist] persist failed:', error?.message || error);
  }
};
const isRapidItemBlocked = (itemId) => {
  const normalized = normalizeRapidCacheItemId(itemId);
  if (!normalized) return false;
  loadBlockedRapidItems();
  return blockedRapidItemsSet.has(normalized);
};
const blockRapidItemId = async (itemId, reason = 'not_found') => {
  const normalized = normalizeRapidCacheItemId(itemId);
  if (!normalized) return false;
  loadBlockedRapidItems();
  const alreadyBlocked = blockedRapidItemsSet.has(normalized);
  blockedRapidItemsSet.add(normalized);
  if (!alreadyBlocked) {
    persistBlockedRapidItems();
    console.log('[RapidBlocklist] item blocked', { itemId: normalized, reason });
  }
  await prisma.rapidItemCache.deleteMany({ where: { itemId: normalized } }).catch(() => null);
  await prisma.rapidSearchRequestCache.deleteMany({ where: { itemIds: { contains: normalized } } }).catch(() => null);
  return true;
};
const getLatencyBucket = (ms) => {
  if (ms < 300) return '<300ms';
  if (ms < 1000) return '300ms-1s';
  if (ms < 3000) return '1s-3s';
  if (ms < 8000) return '3s-8s';
  return '8s+';
};
const normalizeRapidSearchText = (value) => String(value || '')
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي')
  .replace(/[\\\/.,()!?;:"'`]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const buildSearchQueryVariants = (query) => {
  const normalized = normalizeRapidSearchText(query);
  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(' ').filter(Boolean);
  const variants = [query, normalized, compact, ...tokens];
  return Array.from(new Set(variants.map((entry) => String(entry || '').trim()).filter(Boolean)));
};
const buildRapidSearchCacheKey = ({ q, page, limit, lang, orderBy, startPrice, endPrice, switches, sort, minPrice, maxPrice, minVolume, categoryId }) => {
  return JSON.stringify({
    q: String(q || '').trim().toLowerCase(),
    page: Number(page || 1),
    limit: Number(limit || 20),
    lang: String(lang || 'en').trim().toLowerCase(),
    orderBy: String(orderBy || '').trim(),
    startPrice: String(startPrice || '').trim(),
    endPrice: String(endPrice || '').trim(),
    switches: String(switches || '').trim(),
    sort: String(sort || '').trim().toLowerCase(),
    minPrice: String(minPrice || '').trim(),
    maxPrice: String(maxPrice || '').trim(),
    minVolume: String(minVolume || '').trim(),
    categoryId: String(categoryId || '').trim()
  });
};

const ensureRapidItemCacheTable = async () => {
  if (rapidItemCacheTableReady) return true;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RapidItemCache" (
        "id" SERIAL PRIMARY KEY,
        "itemId" TEXT NOT NULL UNIQUE,
        "item" JSONB NOT NULL,
        "reviews" JSONB,
        "reviewTotal" INTEGER NOT NULL DEFAULT 0,
        "expiresAt" TIMESTAMPTZ NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "RapidItemCache_expiresAt_idx" ON "RapidItemCache" ("expiresAt")
    `);
    rapidItemCacheTableReady = true;
    return true;
  } catch (error) {
    console.error('[RapidItemCache] ensure table failed:', error?.message || error);
    return false;
  }
};

const runRapidItemCacheCleanup = async () => {
  const ready = await ensureRapidItemCacheTable();
  if (!ready) return;
  const result = await prisma.rapidItemCache.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });
  if (result?.count > 0) {
    console.log(`[RapidItemCache] Removed expired entries: ${result.count}`);
  }
};

const runRapidSearchRequestCacheCleanup = async () => {
  try {
    const result = await prisma.rapidSearchRequestCache.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });
    if (result?.count > 0) {
      console.log(`[RapidSearchRequestCache] Removed expired entries: ${result.count}`);
    }
  } catch (error) {
    console.error('[RapidSearchRequestCache] Cleanup failed:', error?.message || error);
  }
};

app.use('/api/tools/rapid', (req, res, next) => {
  const rapidEnabled = String(process.env.RAPIDAPI_ENABLED || 'false').toLowerCase() === 'true';
  const pathName = String(req.path || '').toLowerCase();
  const allowWhenDisabled = pathName === '/search' || pathName === '/cache/random';
  if (allowWhenDisabled) {
    return next();
  }
  if (!rapidEnabled) {
    return res.status(410).json({ error: 'RapidAPI integration is disabled' });
  }
  next();
});

app.get('/api/tools/rapid/item-detail', async (req, res) => {
  try {
    const itemId = normalizeRapidCacheItemId(req.query.itemId || req.query.itemIdStr);
    if (!itemId) return res.status(400).json({ error: 'Item ID required' });
    if (isRapidItemBlocked(itemId)) {
      return res.status(404).json({ error: 'Item was removed permanently', blocked: true });
    }
    await ensureRapidItemCacheTable();

    const cachedEntry = await prisma.rapidItemCache.findUnique({ where: { itemId } });
    if (cachedEntry) {
      if (cachedEntry.expiresAt > new Date()) {
        const cachedReviews = Array.isArray(cachedEntry.reviews) ? cachedEntry.reviews : [];
        const cachedReviewTotal = Number(cachedEntry.reviewTotal ?? cachedReviews.length ?? 0);
        return res.json({
          item: cachedEntry.item,
          reviews: cachedReviews,
          reviewTotal: cachedReviewTotal,
          cached: true
        });
      }
      await prisma.rapidItemCache.delete({ where: { itemId } }).catch(() => null);
    }

    const rapidApiKey = process.env.RAPIDAPI_KEY || '';
    const rapidApiHost = process.env.RAPIDAPI_HOST || 'taobao-tmall1.p.rapidapi.com';
    const rapidBaseUrl = (process.env.RAPIDAPI_BASE_URL || `https://${rapidApiHost}`).replace(/\/$/, '');

    const response = await axios.get(`${rapidBaseUrl}/BatchGetItemFullInfo`, {
      params: {
        itemId: itemId,
        language: req.query.lang || 'en'
      },
      headers: {
        'x-rapidapi-host': rapidApiHost,
        'x-rapidapi-key': rapidApiKey
      },
      timeout: 20000
    });
    const providerErrorCode = String(response?.data?.ErrorCode || response?.data?.errorCode || '').trim().toLowerCase();
    const providerSubError = String(response?.data?.SubErrorCode?.Value || response?.data?.subErrorCode?.value || '').trim();
    const providerErrorDescription = String(response?.data?.ErrorDescription || response?.data?.errorDescription || '').trim();
    const providerNotFound = providerErrorCode === 'notfound'
      || providerSubError === 'ItemWithId'
      || /item with id=.*not found|not found/i.test(providerErrorDescription);
    if (providerNotFound) {
      await blockRapidItemId(itemId, 'provider_not_found');
      return res.status(404).json({ error: 'Item not found in RapidAPI', blocked: true });
    }

    const itemData = response.data?.Result?.Item;
    const providerReviewsRaw = response.data?.Result?.ProviderReviews;
    if (!itemData) {
      return res.status(404).json({ error: 'Item not found in RapidAPI' });
    }

    const normalizeUrl = (value) => {
      if (!value) return '';
      const raw = typeof value === 'string'
        ? value
        : (value?.Url || value?.url || value?.PictureUrl || value?.MainPictureUrl || value?.Value || '');
      if (!raw || typeof raw !== 'string') return '';
      const cleaned = raw.replace(/[`"'\\]/g, '').trim().replace(/^[,\s]+|[,\s]+$/g, '');
      if (!cleaned) return '';
      if (cleaned.startsWith('//')) return `https:${cleaned}`;
      if (/^http:\/\//i.test(cleaned)) return cleaned.replace(/^http:\/\//i, 'https://');
      return cleaned;
    };
    const normalizeReviewEntries = (value) => {
      const content = Array.isArray(value?.Content)
        ? value.Content
        : (Array.isArray(value) ? value : []);
      return content.map((entry, idx) => {
        const rawComment = entry?.Comment ?? entry?.comment ?? entry?.Content ?? entry?.content ?? entry?.Text ?? entry?.text ?? '';
        const comment = String(rawComment || '').trim();
        const rawRating = entry?.Rating ?? entry?.rating ?? entry?.Score ?? entry?.score ?? entry?.Star ?? entry?.star ?? 5;
        const rating = Number(rawRating);
        const userName = String(entry?.UserNick ?? entry?.UserName ?? entry?.Nickname ?? entry?.nickname ?? entry?.Reviewer ?? 'عميل').trim() || 'عميل';
        const createdAt = String(entry?.CreatedAt ?? entry?.createdAt ?? entry?.Date ?? entry?.ReviewDate ?? new Date().toISOString());
        const rawImages = Array.isArray(entry?.Images)
          ? entry.Images
          : (Array.isArray(entry?.images)
            ? entry.images
            : (Array.isArray(entry?.Photos) ? entry.Photos : []));
        const images = rawImages.map((img) => normalizeUrl(img)).filter(Boolean);
        return {
          id: Number(entry?.Id ?? entry?.id ?? idx + 1),
          rating: Number.isFinite(rating) && rating > 0 ? Math.max(1, Math.min(5, rating)) : 5,
          comment,
          createdAt,
          user: { name: userName },
          images
        };
      }).filter((entry) => entry.comment || (Array.isArray(entry.images) && entry.images.length > 0));
    };
    const extractImageUrlsFromHtml = (html) => {
      if (!html || typeof html !== 'string') return [];
      const cleaned = html.replace(/`/g, '');
      const matches = Array.from(cleaned.matchAll(/<img[^>]+src=["']([^"']+)["']/gi));
      return matches
        .map((match) => normalizeUrl(match?.[1]))
        .filter(Boolean);
    };
    const pictures = Array.isArray(itemData.Pictures)
      ? itemData.Pictures.map((entry) => normalizeUrl(entry)).filter(Boolean)
      : [];
    let videosRaw = Array.isArray(itemData.Videos) ? itemData.Videos : [];
    if (videosRaw.length === 0 && rapidApiKey) {
      try {
        const fallbackVideoResp = await axios.get('https://taobao-tmall1.p.rapidapi.com/BatchGetItemFullInfo', {
          params: {
            itemId: itemId,
            language: req.query.lang || 'en'
          },
          headers: {
            'x-rapidapi-host': 'taobao-tmall1.p.rapidapi.com',
            'x-rapidapi-key': rapidApiKey
          },
          timeout: 20000
        });
        const fallbackVideos = fallbackVideoResp?.data?.Result?.Item?.Videos;
        if (Array.isArray(fallbackVideos) && fallbackVideos.length > 0) {
          videosRaw = fallbackVideos;
        }
      } catch (_videoFallbackError) {}
    }
    const description = String(itemData.Description || '');
    const descriptionImages = extractImageUrlsFromHtml(description);
    const mainImage = normalizeUrl(itemData.MainPictureUrl) || pictures[0] || '';

    const priceVal = itemData.Price?.OriginalPrice || itemData.Price?.ConvertedPriceWithoutSign || 0;
    const normalizedProviderReviews = normalizeReviewEntries(providerReviewsRaw);
    const providerReviewTotal = Number(providerReviewsRaw?.TotalCount ?? normalizedProviderReviews.length ?? 0);
    
    const item = {
      itemId: String(itemData.Id),
      itemIdStr: String(itemData.Id),
      title: String(itemData.Title || ''),
      image: mainImage,
      images: pictures,
      Videos: videosRaw,
      videos: videosRaw,
      videoUrl: normalizeUrl(videosRaw?.[0]?.Url || videosRaw?.[0]?.url),
      videoPreviewUrl: normalizeUrl(videosRaw?.[0]?.PreviewUrl || videosRaw?.[0]?.previewUrl),
      price: priceVal,
      originalPrice: priceVal,
      priceMoney: { Price: priceVal },
      itemUrl: normalizeUrl(itemData.TaobaoItemUrl),
      detail_url: normalizeUrl(itemData.TaobaoItemUrl),
      sales: String(itemData.Volume || '0'),
      description,
      skus: itemData.ConfiguredItems || [],
      configuredItems: itemData.ConfiguredItems || [],
      attributes: itemData.Attributes || [],
      props: itemData.Attributes || [],
      raw: {
        Description: description,
        ConfiguredItems: itemData.ConfiguredItems || [],
        Attributes: itemData.Attributes || [],
        desc_imgs: descriptionImages
      }
    };
    await prisma.rapidItemCache.upsert({
      where: { itemId },
      update: {
        item,
        reviews: normalizedProviderReviews,
        reviewTotal: providerReviewTotal,
        expiresAt: new Date(Date.now() + RAPID_ITEM_CACHE_TTL_MS)
      },
      create: {
        itemId,
        item,
        reviews: normalizedProviderReviews,
        reviewTotal: providerReviewTotal,
        expiresAt: new Date(Date.now() + RAPID_ITEM_CACHE_TTL_MS)
      }
    });
    return res.json({ item, reviews: normalizedProviderReviews, reviewTotal: providerReviewTotal, cached: false });
  } catch (error) {
    const statusCode = Number(error?.response?.status || 0);
    const providerErrorCode = String(error?.response?.data?.ErrorCode || '').trim().toLowerCase();
    const providerSubError = String(error?.response?.data?.SubErrorCode?.Value || '').trim();
    const providerErrorDescription = String(error?.response?.data?.ErrorDescription || error?.message || '').trim();
    const providerNotFound = statusCode === 404
      || providerErrorCode === 'notfound'
      || providerSubError === 'ItemWithId'
      || /item with id=.*not found|not found/i.test(providerErrorDescription);
    if (providerNotFound) {
      const itemId = normalizeRapidCacheItemId(req.query.itemId || req.query.itemIdStr);
      await blockRapidItemId(itemId, 'provider_not_found_error');
      return res.status(404).json({ error: 'Item not found in RapidAPI', blocked: true });
    }
    console.error('[Rapid Item Detail] error:', error?.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to fetch item detail' });
  }
});

app.get('/api/tools/rapid/item-reviews', async (req, res) => {
  try {
    const itemId = req.query.itemId || req.query.itemIdStr;
    if (!itemId) return res.status(400).json({ error: 'Item ID required' });
    const rapidApiKey = process.env.RAPIDAPI_KEY || '';
    const rapidApiHost = process.env.RAPIDAPI_HOST || 'taobao-tmall1.p.rapidapi.com';
    const rapidBaseUrl = (process.env.RAPIDAPI_BASE_URL || `https://${rapidApiHost}`).replace(/\/$/, '');
    if (!rapidApiKey) return res.json({ reviews: [], total: 0 });
    const response = await axios.get(`${rapidBaseUrl}/BatchGetItemFullInfo`, {
      params: {
        itemId: itemId,
        language: req.query.lang || 'ar'
      },
      headers: {
        'x-rapidapi-host': rapidApiHost,
        'x-rapidapi-key': rapidApiKey
      },
      timeout: 20000
    });
    const providerReviewsRaw = response?.data?.Result?.ProviderReviews;
    const normalizeUrl = (value) => {
      if (!value) return '';
      const raw = typeof value === 'string' ? value : (value?.Url || value?.url || value?.PictureUrl || value?.Value || '');
      if (!raw || typeof raw !== 'string') return '';
      const cleaned = raw.replace(/[`"'\\]/g, '').trim().replace(/^[,\s]+|[,\s]+$/g, '');
      if (!cleaned) return '';
      if (cleaned.startsWith('//')) return `https:${cleaned}`;
      if (/^http:\/\//i.test(cleaned)) return cleaned.replace(/^http:\/\//i, 'https://');
      return cleaned;
    };
    const content = Array.isArray(providerReviewsRaw?.Content) ? providerReviewsRaw.Content : [];
    const reviews = content.map((entry, idx) => {
      const rawRating = entry?.Rating ?? entry?.rating ?? entry?.Score ?? entry?.score ?? entry?.Star ?? entry?.star ?? 5;
      const rating = Number(rawRating);
      const rawImages = Array.isArray(entry?.Images)
        ? entry.Images
        : (Array.isArray(entry?.images)
          ? entry.images
          : (Array.isArray(entry?.Photos) ? entry.Photos : []));
      const images = rawImages.map((img) => normalizeUrl(img)).filter(Boolean);
      return {
        id: Number(entry?.Id ?? entry?.id ?? idx + 1),
        rating: Number.isFinite(rating) && rating > 0 ? Math.max(1, Math.min(5, rating)) : 5,
        comment: String(entry?.Comment ?? entry?.comment ?? entry?.Content ?? entry?.content ?? entry?.Text ?? entry?.text ?? '').trim(),
        createdAt: String(entry?.CreatedAt ?? entry?.createdAt ?? entry?.Date ?? entry?.ReviewDate ?? new Date().toISOString()),
        user: {
          name: String(entry?.UserNick ?? entry?.UserName ?? entry?.Nickname ?? entry?.nickname ?? entry?.Reviewer ?? 'عميل').trim() || 'عميل'
        },
        images
      };
    }).filter((entry) => entry.comment || entry.images.length > 0);
    const total = Number(providerReviewsRaw?.TotalCount ?? reviews.length ?? 0);
    return res.json({ reviews, total });
  } catch (error) {
    console.error('[Rapid Item Reviews] error:', error?.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to fetch item reviews' });
  }
});

app.get('/api/tools/rapid/search', async (req, res) => {
  try {
    const requestStartedAt = Date.now();
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const allowDbFallback = String(req.query.allowDbFallback || '') === '1';
    const lang = String(req.query.lang || 'en').trim() || 'en';
    let providerOrderBy = String(req.query.orderBy || 'Price:Asc').trim() || 'Price:Asc';
    const startPrice = String(req.query.startPrice || '').trim();
    const endPrice = String(req.query.endPrice || '').trim();
    const minPrice = String(req.query.minPrice || req.query.MinPrice || '').trim();
    const maxPrice = String(req.query.maxPrice || req.query.MaxPrice || '').trim();
    let minVolume = String(req.query.minVolume || req.query.MinVolume || '').trim();
    const categoryId = String(req.query.categoryId || req.query.CategoryId || '').trim();
    const sort = String(req.query.sort || '').trim().toLowerCase();
    const switches = String(req.query.switches || '').trim();
    providerOrderBy = 'Price:Asc';
    if (!minVolume) minVolume = '50';
    let effectiveQuery = q;
    const hasCategoryOnly = Boolean(categoryId);
    if (hasCategoryOnly) {
      effectiveQuery = '';
    }
    if (!effectiveQuery && !categoryId) {
      return res.json({ items: [], total: 0, hasMore: false, page, limit });
    }
    const rapidSearchCacheKey = buildRapidSearchCacheKey({
      q: effectiveQuery,
      page,
      limit,
      lang,
      orderBy: providerOrderBy,
      startPrice,
      endPrice,
      switches,
      sort,
      minPrice,
      maxPrice,
      minVolume,
      categoryId
    });
    const buildSearchMetrics = (cacheHit, source) => {
      const latencyMs = Date.now() - requestStartedAt;
      return {
        cacheHit,
        source,
        latencyMs,
        latencyBucket: getLatencyBucket(latencyMs)
      };
    };
    const parseNumeric = (value) => {
      if (value === null || value === undefined) return null;
      const raw = String(value).trim();
      if (!raw) return null;
      const num = Number(raw.replace(/[^\d.]/g, ''));
      return Number.isFinite(num) ? num : null;
    };
    const getItemPrice = (item) => {
      const raw = item?.price ?? item?.priceMoney?.Price ?? item?.originalPrice ?? item?.priceMoney?.OriginalPrice ?? item?.Price;
      const parsed = parseNumeric(raw);
      return typeof parsed === 'number' ? parsed : 0;
    };
    const getItemSales = (item) => {
      if (typeof item?.__salesCount === 'number') return item.__salesCount;
      const raw = item?.sales ?? item?.Sales ?? item?.Volume ?? item?.volume ?? item?.raw?.sales ?? item?.raw?.Volume;
      const parsed = parseNumeric(raw);
      return typeof parsed === 'number' ? parsed : 0;
    };
    const buildCategoryPrediction = (items) => {
      const counts = new Map();
      const paths = new Map();
      const categoryItems = (Array.isArray(items) ? items : []).map((item) => {
        const id = String(
          item?.CategoryId
          ?? item?.categoryId
          ?? item?.ExternalCategoryId
          ?? item?.externalCategoryId
          ?? ''
        ).trim();
        if (!id || !id.toLowerCase().startsWith('otc-')) return null;
        const path = String(item?.CategoryPath ?? item?.categoryPath ?? '').trim();
        return { id, path };
      }).filter(Boolean);
      categoryItems.forEach((entry) => {
        counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
        if (entry.path && !paths.has(entry.id)) {
          paths.set(entry.id, entry.path);
        }
      });
      if (counts.size === 0) return null;
      let topId = '';
      let topCount = 0;
      counts.forEach((count, id) => {
        if (count > topCount) {
          topCount = count;
          topId = id;
        }
      });
      const confidence = categoryItems.length > 0 ? topCount / categoryItems.length : 0;
      return {
        categoryId: topId,
        categoryPath: paths.get(topId) || null,
        confidence
      };
    };
    const queryVariants = hasCategoryOnly ? [''] : buildSearchQueryVariants(effectiveQuery);
    const queryTokens = Array.from(new Set(normalizeSearchText(effectiveQuery).split(' ').filter(Boolean)));
    const getItemKey = (item) => {
      const id = String(item?.itemId || item?.id || '').trim();
      if (id) return `id:${id}`;
      const url = String(item?.itemUrl || item?.taobaoItemUrl || item?.detail_url || '').trim();
      if (url) return `url:${url}`;
      return `title:${String(item?.title || '').trim().toLowerCase()}`;
    };
    const mergeUniqueItems = (baseItems, nextItems) => {
      const merged = Array.isArray(baseItems) ? [...baseItems] : [];
      const seen = new Set(merged.map(getItemKey));
      (Array.isArray(nextItems) ? nextItems : []).forEach((item) => {
        const key = getItemKey(item);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
      return merged;
    };
    const extractRapidItems = (data) => {
      const resultItems = data?.Result?.Items;
      let rawItems = [];
      if (resultItems?.Items?.Content && Array.isArray(resultItems.Items.Content)) {
        rawItems = resultItems.Items.Content;
      } else if (resultItems?.Items?.Items?.Content && Array.isArray(resultItems.Items.Items.Content)) {
        rawItems = resultItems.Items.Items.Content;
      } else if (resultItems?.Items && Array.isArray(resultItems.Items)) {
        rawItems = resultItems.Items;
      } else if (resultItems?.Content && Array.isArray(resultItems.Content)) {
        rawItems = resultItems.Content;
      } else if (resultItems && Array.isArray(resultItems)) {
        rawItems = resultItems;
      } else if (resultItems?.Items?.Items && Array.isArray(resultItems.Items.Items)) {
        rawItems = resultItems.Items.Items;
      } else {
        const fallbackItems = extractRapidItemsPayload(data);
        if (fallbackItems.length > 0) rawItems = fallbackItems;
      }
      return (Array.isArray(rawItems) ? rawItems : []).map(normalizeRapidItem).filter(Boolean);
    };
    try {
      const cachedEntry = await prisma.rapidSearchRequestCache.findUnique({ where: { cacheKey: rapidSearchCacheKey } });
      if (cachedEntry) {
        if (cachedEntry.expiresAt > new Date()) {
          await prisma.rapidSearchRequestCache.update({
            where: { cacheKey: rapidSearchCacheKey },
            data: {
              hitCount: { increment: 1 },
              lastAccessedAt: new Date()
            }
          }).catch(() => null);
          const payload = cachedEntry.payload && typeof cachedEntry.payload === 'object'
            ? cachedEntry.payload
            : {};
          const payloadItems = Array.isArray(payload?.items) ? payload.items : [];
          const visibleItems = payloadItems.filter((entry) => !isRapidItemBlocked(entry?.itemId || entry?.id));
          const adjustedPayload = {
            ...payload,
            items: visibleItems,
            total: typeof payload?.total === 'number' ? Math.max(visibleItems.length, payload.total - (payloadItems.length - visibleItems.length)) : visibleItems.length
          };
          const searchMetrics = buildSearchMetrics(true, payload?.source || 'rapidapi_cache');
          console.log('[Rapid Search Metrics]', { q: effectiveQuery, page, limit, ...searchMetrics });
          return res.json({
            ...adjustedPayload,
            source: payload?.source || 'rapidapi_cache',
            cacheHit: true,
            searchMetrics
          });
        }
        await prisma.rapidSearchRequestCache.delete({ where: { cacheKey: rapidSearchCacheKey } }).catch(() => null);
      }
    } catch (cacheReadError) {
      console.error('[Rapid Search Cache] read error:', cacheReadError?.message || cacheReadError);
    }
    const rapidApiKey = process.env.RAPIDAPI_KEY || '';
    const rapidApiHost = process.env.RAPIDAPI_HOST || 'taobao-tmall1.p.rapidapi.com';
    const rapidBaseUrl = (process.env.RAPIDAPI_BASE_URL || `https://${rapidApiHost}`).replace(/\/$/, '');
    let rapidItems = [];
    let rapidTotalEstimate = 0;
    let rapidUpstreamError = null;
    if (rapidApiKey) {
      const variants = queryVariants.slice(0, 3);
      for (const variant of variants) {
        try {
        const itemTitle = hasCategoryOnly ? '' : variant;
        const providerParams = {
          language: lang,
          framePosition: (page - 1) * limit,
          frameSize: limit,
          OrderBy: providerOrderBy,
          IsComplete: true
        };
        providerParams.ItemTitle = itemTitle;
        if (categoryId) providerParams.CategoryId = categoryId;
        if (startPrice) providerParams.StartPrice = startPrice;
        if (endPrice) providerParams.EndPrice = endPrice;
        if (minPrice) providerParams.MinPrice = minPrice;
        if (maxPrice) providerParams.MaxPrice = maxPrice;
        if (sort === 'best_seller' && minVolume) providerParams.MinVolume = minVolume;
        if (switches) providerParams.Switches = switches;
        const rapidRequestUrl = `${rapidBaseUrl}/BatchSearchItemsFrame?${new URLSearchParams(Object.entries(providerParams).map(([key, value]) => [key, String(value)])).toString()}`;
        console.log('[Rapid Search Request]', {
          q,
          effectiveQuery,
          itemTitle,
          page,
          limit,
          providerParams,
          rapidRequestUrl
        });
        const response = await axios.get(`${rapidBaseUrl}/BatchSearchItemsFrame`, {
          params: providerParams,
          headers: {
            'x-rapidapi-host': rapidApiHost,
            'x-rapidapi-key': rapidApiKey
          },
          timeout: 20000
        });
          const data = response?.data || {};
          const items = extractRapidItems(data);
          console.log('[Rapid Search Response]', {
            rapidItems: items.length,
            responseKeys: Object.keys(data || {}).slice(0, 12),
            topItemId: items[0]?.itemId || items[0]?.ItemId || items[0]?.id || items[0]?.Id || null
          });
          if (String(req.query.debug || '') === '1') {
            const debugPayload = {
              requestedAt: new Date().toISOString(),
              itemTitle,
              providerParams,
              responseKeys: Object.keys(data || {}),
              sampleItem: items[0] || null,
              raw: data
            };
            const debugFile = path.join(__dirname, 'data', `rapid_search_debug_${Date.now()}.json`);
            try {
              fs.writeFileSync(debugFile, JSON.stringify(debugPayload, null, 2), 'utf8');
              console.log('[Rapid Search Debug] Saved:', debugFile);
            } catch (error) {
              console.error('[Rapid Search Debug] Save failed:', error?.message || error);
            }
          }
          const total = Number(
          data?.total
          ?? data?.Total
          ?? data?.Result?.Items?.Total
          ?? data?.Result?.Items?.TotalCount
          ?? data?.Result?.Items?.ItemCount
          ?? data?.Result?.Items?.Items?.Total
          ?? data?.Result?.Items?.Items?.TotalCount
          ?? data?.Result?.Items?.Items?.ItemCount
          ?? data?.Result?.Items?.MaximumPageCount
          ?? data?.Result?.Total
          ?? data?.result?.total
          ?? data?.data?.total
          ?? items.length
        );
          rapidTotalEstimate = Math.max(rapidTotalEstimate, Number.isFinite(total) ? total : items.length);
          rapidItems = mergeUniqueItems(rapidItems, items);
          if (rapidItems.length >= limit * 2) break;
        } catch (error) {
          rapidUpstreamError = error;
        }
      }
    } else {
      console.warn('[Rapid Search] Missing RAPIDAPI_KEY, skipping RapidAPI call');
    }
    const selectShape = {
      id: true,
      name: true,
      image: true,
      price: true,
      purchaseUrl: true,
      images: {
        select: { url: true, order: true },
        orderBy: { order: 'asc' }
      }
    };
    const sanitizeSupabaseTerm = (term) => String(term || '')
      .replace(/['"%(),]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const fetchSupabaseHybridProducts = async (terms) => {
      const uniqueTerms = Array.from(new Set((Array.isArray(terms) ? terms : []).map(sanitizeSupabaseTerm).filter(Boolean))).slice(0, 8);
      if (uniqueTerms.length === 0) return { products: [], total: 0 };
      let totalEstimate = 0;
      const byId = new Map();
      for (const term of uniqueTerms) {
        let nameQueryBuilder = supabase
          .from('Product')
          .select('id,name,image,price,purchaseUrl,updatedAt,keywords,status,isActive', { count: 'exact' })
          .eq('isActive', true)
          .eq('status', 'PUBLISHED')
          .ilike('name', `%${term}%`)
          .limit(Math.min(120, limit * 3));
        if (sort === 'cheap') {
          nameQueryBuilder = nameQueryBuilder.order('price', { ascending: true, nullsFirst: false });
        } else {
          nameQueryBuilder = nameQueryBuilder.order('updatedAt', { ascending: false, nullsFirst: false });
        }
        const { data: nameData, count: nameCount, error: nameError } = await nameQueryBuilder;
        if (nameError) {
          console.error('[Rapid Search] Supabase name query failed:', nameError.message || nameError);
        }
        totalEstimate = Math.max(totalEstimate, Number(nameCount || 0));
        (Array.isArray(nameData) ? nameData : []).forEach((row) => {
          const idKey = String(row?.id || '').trim();
          if (!idKey) return;
          if (!byId.has(idKey)) {
            byId.set(idKey, row);
          }
        });
        let keywordQueryBuilder = supabase
          .from('Product')
          .select('id,name,image,price,purchaseUrl,updatedAt,keywords,status,isActive', { count: 'exact' })
          .eq('isActive', true)
          .eq('status', 'PUBLISHED')
          .contains('keywords', [term])
          .limit(Math.min(120, limit * 3));
        if (sort === 'cheap') {
          keywordQueryBuilder = keywordQueryBuilder.order('price', { ascending: true, nullsFirst: false });
        } else {
          keywordQueryBuilder = keywordQueryBuilder.order('updatedAt', { ascending: false, nullsFirst: false });
        }
        const { data: keywordData, count: keywordCount, error: keywordError } = await keywordQueryBuilder;
        if (keywordError) {
          console.error('[Rapid Search] Supabase keywords query failed:', keywordError.message || keywordError);
          continue;
        }
        totalEstimate = Math.max(totalEstimate, Number(keywordCount || 0));
        (Array.isArray(keywordData) ? keywordData : []).forEach((row) => {
          const idKey = String(row?.id || '').trim();
          if (!idKey) return;
          if (!byId.has(idKey)) {
            byId.set(idKey, row);
          }
        });
      }
      const allRows = Array.from(byId.values());
      if (sort === 'cheap') {
        allRows.sort((a, b) => Number(a?.price || 0) - Number(b?.price || 0));
      } else {
        allRows.sort((a, b) => {
          const ta = new Date(a?.updatedAt || 0).getTime();
          const tb = new Date(b?.updatedAt || 0).getTime();
          return tb - ta;
        });
      }
      const rows = allRows.slice(skip, skip + Math.min(120, limit * 3));
      return { products: rows, total: Math.max(totalEstimate, allRows.length) };
    };
    const buildWhereFromTerms = (terms) => ({
      isActive: true,
      status: 'PUBLISHED',
      OR: terms.flatMap((term) => ([
        { name: { contains: term, mode: 'insensitive' } },
        { specs: { contains: term, mode: 'insensitive' } },
        { purchaseUrl: { contains: term, mode: 'insensitive' } }
      ]))
    });
    let dbItems = [];
    let dbTotal = 0;
    if (allowDbFallback || rapidItems.length === 0) {
      try {
        const allTerms = Array.from(new Set([effectiveQuery, ...queryVariants, ...queryTokens].map((entry) => String(entry || '').trim()).filter(Boolean)));
        const { products, total } = await fetchSupabaseHybridProducts(allTerms);
        dbItems = products.map(mapProductToRapidItem);
        dbItems = dbItems.filter((entry) => !isRapidItemBlocked(entry?.itemId || entry?.id));
        dbTotal = total;
        if (sort === 'best_seller' && products.length > 0) {
          const productIds = products.map((p) => Number(p.id)).filter((id) => Number.isFinite(id));
          if (productIds.length > 0) {
            const grouped = await prisma.orderItem.groupBy({
              by: ['productId'],
              where: { productId: { in: productIds } },
              _sum: { quantity: true }
            });
            const salesMap = new Map(grouped.map((row) => [String(row.productId), Number(row._sum.quantity || 0)]));
            dbItems = dbItems.map((item) => ({
              ...item,
              __salesCount: salesMap.get(String(item?.itemId || '')) || 0
            }));
          }
        }
        if (dbItems.length === 0 && allTerms.length > 0) {
          const where = buildWhereFromTerms(allTerms);
          const [fallbackProducts, fallbackTotal] = await Promise.all([
            prisma.product.findMany({
              where,
              select: selectShape,
              orderBy: sort === 'cheap' ? { price: 'asc' } : { updatedAt: 'desc' },
              skip,
              take: Math.min(120, limit * 3)
            }),
            prisma.product.count({ where })
          ]);
          dbItems = fallbackProducts.map(mapProductToRapidItem);
          dbItems = dbItems.filter((entry) => !isRapidItemBlocked(entry?.itemId || entry?.id));
          dbTotal = fallbackTotal;
        }
      } catch (error) {
        console.error('[Rapid Search] DB fallback failed:', error?.message || error);
        dbItems = [];
        dbTotal = 0;
      }
    }
    if (rapidItems.length === 0 && dbItems.length === 0 && !allowDbFallback) {
      const source = rapidUpstreamError ? 'rapidapi_error' : 'rapidapi';
      const searchMetrics = buildSearchMetrics(false, source);
      console.log('[Rapid Search Metrics]', { q: effectiveQuery, page, limit, ...searchMetrics, returned: 0 });
      return res.json({
        items: [],
        total: 0,
        hasMore: false,
        page,
        limit,
        categoryId: categoryId || null,
        categoryPath: null,
        categoryPrediction: null,
        source,
        searchMetrics
      });
    }
    let combinedItems = mergeUniqueItems(rapidItems, dbItems);
    const minPriceValue = parseNumeric(minPrice);
    const maxPriceValue = parseNumeric(maxPrice);
    if (typeof minPriceValue === 'number' || typeof maxPriceValue === 'number') {
      combinedItems = combinedItems.filter((item) => {
        const price = getItemPrice(item);
        if (typeof minPriceValue === 'number' && price < minPriceValue) return false;
        if (typeof maxPriceValue === 'number' && price > maxPriceValue) return false;
        return true;
      });
    }
    const normalizedQuery = normalizeSearchText(effectiveQuery);
    const scoreItem = (item) => {
      const title = normalizeSearchText(item?.title || '');
      const url = normalizeSearchText(item?.itemUrl || item?.taobaoItemUrl || '');
      let score = 0;
      if (title === normalizedQuery) score += 200;
      if (title.startsWith(normalizedQuery)) score += 120;
      if (title.includes(normalizedQuery)) score += 60;
      if (url.includes(normalizedQuery)) score += 20;
      queryTokens.forEach((token) => {
        if (title.includes(token)) score += 20;
      });
      return score;
    };
    const rankedItems = [...combinedItems].sort((a, b) => {
      if (sort === 'cheap') {
        const priceDiff = getItemPrice(a) - getItemPrice(b);
        if (priceDiff !== 0) return priceDiff;
      }
      if (sort === 'best_seller') {
        const salesDiff = getItemSales(b) - getItemSales(a);
        if (salesDiff !== 0) return salesDiff;
      }
      const diff = scoreItem(b) - scoreItem(a);
      if (diff !== 0) return diff;
      const idA = String(a?.itemId || '');
      const idB = String(b?.itemId || '');
      return idA.localeCompare(idB);
    });
    const finalItems = rankedItems.slice(0, limit);
    const rapidHasMore = rapidTotalEstimate > 0 ? skip + finalItems.length < rapidTotalEstimate : rapidItems.length >= limit;
    const dbHasMore = dbTotal > 0 ? skip + finalItems.length < dbTotal : false;
    const source = rapidItems.length > 0 && dbItems.length > 0
      ? 'hybrid'
      : (rapidItems.length > 0 ? 'rapidapi' : 'database_fallback');
    const categoryPrediction = null;
    const payload = {
      items: finalItems,
      total: Math.max(rapidTotalEstimate || 0, dbTotal || 0, finalItems.length),
      hasMore: rapidHasMore || dbHasMore,
      page,
      limit,
      categoryId: categoryId || null,
      categoryPath: null,
      categoryPrediction: null,
      source,
      cacheHit: false
    };
    const searchMetrics = buildSearchMetrics(false, source);
    console.log('[Rapid Search Metrics]', { q: effectiveQuery, page, limit, ...searchMetrics, returned: finalItems.length, rapidCount: rapidItems.length, dbCount: dbItems.length });
    try {
      await prisma.rapidSearchRequestCache.upsert({
        where: { cacheKey: rapidSearchCacheKey },
        update: {
          query: effectiveQuery,
          page,
          limit,
          providerOrderBy,
          startPrice: startPrice || null,
          endPrice: endPrice || null,
          switches: switches || null,
          lang,
          payload,
          itemIds: finalItems.map((entry) => String(entry?.itemId || '')).filter(Boolean).join(',').slice(0, 4000) || null,
          expiresAt: new Date(Date.now() + RAPID_SEARCH_REQUEST_CACHE_TTL_MS),
          lastAccessedAt: new Date()
        },
        create: {
          cacheKey: rapidSearchCacheKey,
          query: effectiveQuery,
          page,
          limit,
          providerOrderBy,
          startPrice: startPrice || null,
          endPrice: endPrice || null,
          switches: switches || null,
          lang,
          payload,
          itemIds: finalItems.map((entry) => String(entry?.itemId || '')).filter(Boolean).join(',').slice(0, 4000) || null,
          expiresAt: new Date(Date.now() + RAPID_SEARCH_REQUEST_CACHE_TTL_MS),
          lastAccessedAt: new Date()
        }
      });
    } catch (cacheWriteError) {
      console.error('[Rapid Search Cache] write error:', cacheWriteError?.message || cacheWriteError);
    }
    return res.json({ ...payload, searchMetrics });
  } catch (error) {
    console.error('[Rapid Search Fallback] error:', error);
    return res.status(500).json({ error: 'Rapid search unavailable' });
  }
});

app.get('/api/tools/rapid/cache/random', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const skip = (page - 1) * limit;
    const where = { isActive: true, status: 'PUBLISHED' };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          image: true,
          price: true,
          purchaseUrl: true,
          images: {
            select: { url: true, order: true },
            orderBy: { order: 'asc' }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.product.count({ where })
    ]);
    const items = products.map(mapProductToRapidItem);
    if (items.length > 0) {
      return res.json({ items, total, hasMore: skip + items.length < total, page, limit, source: 'database' });
    }

    const dataDir = path.join(__dirname, 'data');
    let fileItems = [];
    try {
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir)
          .filter((name) => /^rapid_item_\d+\.json$/i.test(name))
          .map((name) => {
            const fullPath = path.join(dataDir, name);
            const stat = fs.statSync(fullPath);
            return { name, fullPath, mtimeMs: stat.mtimeMs };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs);
        const selected = files.slice(skip, skip + limit);
        fileItems = selected.map((entry) => {
          try {
            const raw = fs.readFileSync(entry.fullPath, 'utf8');
            const parsed = JSON.parse(raw);
            const normalized = normalizeRapidItem(parsed?.item || parsed);
            return normalized;
          } catch (_fileErr) {
            return null;
          }
        }).filter(Boolean);
        return res.json({
          items: fileItems,
          total: files.length,
          hasMore: skip + fileItems.length < files.length,
          page,
          limit,
          source: 'local_file_cache'
        });
      }
    } catch (_cacheErr) {}
    return res.json({ items: [], total: 0, hasMore: false, page, limit, source: 'empty' });
  } catch (error) {
    console.error('[Rapid Cache Random Fallback] error:', error);
    return res.status(500).json({ error: 'Rapid random unavailable' });
  }
});

app.post('/api/tools/rapid/search-image', async (req, res) => {
  try {
    let imgUrl = String(req.body?.imgUrl || req.body?.imageUrl || '').trim();
    const page = Math.max(1, parseInt(String(req.body?.page || '1'), 10) || 1);
    const pageSize = Math.min(60, Math.max(1, parseInt(String(req.body?.pageSize || '20'), 10) || 20));
    const skip = (page - 1) * pageSize;
    const lang = String(req.body?.lang || 'ar').trim() || 'ar';
    if (imgUrl.startsWith('data:image/')) {
      try {
        const match = imgUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) {
          const mime = match[1];
          const data = match[2];
          const ext = mime.split('/')[1] || 'jpg';
          const fileName = `image_search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const filePath = path.join(uploadsPath, fileName);
          fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          imgUrl = `${baseUrl}/uploads/${fileName}`;
        }
      } catch (error) {
        console.error('[Rapid Search Image] save failed:', error?.message || error);
      }
    }
    if (imgUrl) {
      const rapidApiKey = process.env.RAPIDAPI_KEY || '';
      const rapidApiHost = process.env.RAPIDAPI_HOST || 'taobao-tmall1.p.rapidapi.com';
      const rapidBaseUrl = (process.env.RAPIDAPI_BASE_URL || `https://${rapidApiHost}`).replace(/\/$/, '');
      if (rapidApiKey) {
        try {
          const response = await axios.get(`${rapidBaseUrl}/BatchSearchItemsFrame`, {
            params: {
              language: lang,
              framePosition: (page - 1) * pageSize,
              frameSize: pageSize,
              ImageUrl: imgUrl,
              OrderBy: 'UpdatedTime:Desc',
              IsComplete: true
            },
            headers: {
              'x-rapidapi-host': rapidApiHost,
              'x-rapidapi-key': rapidApiKey
            },
            timeout: 20000
          });
          const data = response?.data || {};
          const items = extractRapidItemsPayload(data).map(normalizeRapidItem).filter(Boolean);
          if (items.length > 0) {
            const total = Number(
              data?.total
              ?? data?.Total
              ?? data?.Result?.Items?.Total
              ?? data?.Result?.Items?.TotalCount
              ?? data?.Result?.Items?.ItemCount
              ?? data?.Result?.Items?.Items?.Total
              ?? data?.Result?.Items?.Items?.TotalCount
              ?? data?.Result?.Items?.Items?.ItemCount
              ?? data?.Result?.Items?.MaximumPageCount
              ?? data?.Result?.Total
              ?? data?.result?.total
              ?? data?.data?.total
              ?? items.length
            );
            return res.json({
              items,
              total,
              hasMore: skip + items.length < total,
              page,
              pageSize,
              source: 'rapidapi'
            });
          }
        } catch (error) {
          console.error('[Rapid Search Image] error:', error?.response?.data || error?.message || error);
        }
      }
    }
    const where = { isActive: true, status: 'PUBLISHED' };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          image: true,
          price: true,
          purchaseUrl: true,
          images: {
            select: { url: true, order: true },
            orderBy: { order: 'asc' }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize
      }),
      prisma.product.count({ where })
    ]);
    const items = products.map(mapProductToRapidItem);
    return res.json({ items, total, hasMore: skip + items.length < total, page, pageSize });
  } catch (error) {
    console.error('[Rapid Search Image Fallback] error:', error);
    return res.status(500).json({ error: 'Rapid image search unavailable' });
  }
});

app.post('/api/search/image', async (req, res) => {
  try {
    const limit = Math.min(60, Math.max(1, parseInt(String(req.body?.limit || req.body?.pageSize || '20'), 10) || 20));
    let input = req.body?.imageUrl || req.body?.imgUrl || req.body?.url || req.body?.image;
    if (typeof input !== 'string') input = '';
    input = input.trim();

    let embedding = null;
    if (input.startsWith('data:image/')) {
      const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) return res.status(400).json({ error: 'Invalid data URL' });
      const data = match[2];
      if (!data) return res.status(400).json({ error: 'Invalid data URL' });
      if (data.length > MAX_IMAGE_BASE64_CHARS) {
        return res.status(413).json({ error: 'Image too large' });
      }
      try {
        embedding = await runClipTask(() => embedImage(Buffer.from(data, 'base64')));
      } catch (err) {
        console.error('embedImage buffer failed', err);
        throw err;
      }
    } else if (input) {
      try {
        embedding = await runClipTask(() => embedImage(input));
      } catch (err) {
        console.error('embedImage input failed', err);
        throw err;
      }
    } else {
      return res.status(400).json({ error: 'Missing imageUrl (or data:image/... base64)' });
    }

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Failed to generate embedding array');
    }

    const vectorStr = `[${embedding.join(',')}]`;
    console.log(`[CLIP] Vector generated. Querying similar products...`);
    
    // Fallback if cached settings aren't defined here
    // Removed duplicate storeSettings declaration above
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT "id", ("imageEmbedding" <=> $1::vector) AS distance
        FROM "Product"
        WHERE "imageEmbedding" IS NOT NULL
          AND "status" = 'PUBLISHED'
          AND "isActive" = true
        ORDER BY "imageEmbedding" <=> $1::vector
        LIMIT $2
      `,
      vectorStr,
      limit
    );

    const ids = Array.isArray(rows)
      ? rows.map((r) => Number(r?.id)).filter((id) => Number.isFinite(id))
      : [];

    if (ids.length === 0) {
      return res.json({ products: [], total: 0, engine: 'clip' });
    }

    const shippingRates = {
      airShippingRate: 15400,
      seaShippingRate: 182000,
      airShippingMinFloor: 0
    };
    try {
      const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
      if (storeSettings) {
        shippingRates.airShippingRate = storeSettings.airShippingRate;
        shippingRates.seaShippingRate = storeSettings.seaShippingRate;
        shippingRates.airShippingMinFloor = storeSettings.airShippingMinFloor;
      }
    } catch (e) {
      console.warn('Failed to fetch store settings in image search, using defaults');
    }

    const productSelect = {
      id: true,
      name: true,
      price: true,
      basePriceIQD: true,
      image: true,
      aiMetadata: true,
      neworold: true,
      isFeatured: true,
      featuredSearchSentences: true,
      domesticShippingFee: true,
      deliveryTime: true,
      variants: {
        select: {
          id: true,
          combination: true,
          price: true,
          basePriceIQD: true,
          image: true
        }
      }
    };

    const productsFromDb = await prisma.product.findMany({
      where: {
        id: { in: ids },
        status: 'PUBLISHED',
        isActive: true
      },
      select: productSelect
    });

    const byId = new Map(productsFromDb.map((p) => [p.id, p]));
    const ranked = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((product) => {
        const aiMetadata = parseAiMetadata(product.aiMetadata);
        const processed = applyDynamicPricingToProduct(product, shippingRates);
        const isRealBrand = typeof aiMetadata?.isRealBrand === 'boolean' ? aiMetadata.isRealBrand : null;
        const neworold = (product.neworold !== null && product.neworold !== undefined)
          ? product.neworold
          : extractNewOrOld(aiMetadata);
        return { ...processed, aiMetadata, isRealBrand, neworold };
      });

    return res.json({ products: ranked, total: ranked.length, engine: 'clip' });
  } catch (error) {
    console.error('[CLIP image search] error details:', error);
    console.error(error.stack);
    return res.status(500).json({ error: 'Image search failed' });
  }
});

// --- Image Analysis & Search Endpoints ---

app.post('/api/search/analyze-image', upload.single('image'), async (req, res) => {
  try {
    let input;
    if (req.file) {
      input = req.file.buffer;
    } else if (req.body.imageUrl) {
      input = req.body.imageUrl;
    } else if (req.body.imageBase64) {
      const raw = String(req.body.imageBase64 || '');
      const commaIndex = raw.indexOf(',');
      const base64Data = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
      if (!base64Data) return res.status(400).json({ error: 'Invalid imageBase64' });
      if (base64Data.length > MAX_IMAGE_BASE64_CHARS) {
        return res.status(413).json({ error: 'Image too large' });
      }
      input = Buffer.from(base64Data, 'base64');
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const objects = await runClipTask(() => analyzeImageObjects(input));
    res.json({ objects });
  } catch (error) {
    console.error('Analyze image error:', error);
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

app.post('/api/search/image-crop', upload.single('image'), async (req, res) => {
  try {
    let input;
    let isRawUpload = false;
    
    if (req.file) {
      console.log('[Image Crop] Received raw image file upload (frontend cropped)');
      input = req.file.buffer;
      isRawUpload = true;
    } else if (req.body.imageUrl) {
      console.log('[Image Crop] Received imageUrl');
      input = req.body.imageUrl;
    } else if (req.body.imageBase64) {
      console.log('[Image Crop] Received base64 image (backend crop needed)');
      const raw = String(req.body.imageBase64 || '');
      const commaIndex = raw.indexOf(',');
      const base64Data = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
      if (!base64Data) return res.status(400).json({ error: 'Invalid imageBase64' });
      if (base64Data.length > MAX_IMAGE_BASE64_CHARS) {
        return res.status(413).json({ error: 'Image too large' });
      }
      input = Buffer.from(base64Data, 'base64');
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { box } = req.body;
    
    // Check if it's a file upload (which means frontend already cropped it)
    if (isRawUpload && !box) {
      console.log('[Image Crop] Fast path: embedding raw image without backend crop detection');
      const embedding = await runClipTask(() => embedImageRaw(input));
      const results = await searchProductsByVector(embedding);
      return res.json(results);
    }

    if (!box) return res.status(400).json({ error: 'No crop box provided' });

    let cropBox;
    try {
      cropBox = typeof box === 'string' ? JSON.parse(box) : box;
    } catch {
      return res.status(400).json({ error: 'Invalid box format' });
    }

    const embedding = await runClipTask(() => embedImageCrop(input, cropBox));
    
    // Perform vector search using the embedding
    // Re-using the vector search logic from existing endpoint
    // This part assumes we have access to the search service function or can call it directly
    // For now, let's just return the embedding or call the search function if refactored.
    // Ideally, we should refactor the vector search into a service function.
    
    // Quick fix: copy-paste vector search logic or refactor. 
    // Let's refactor search logic into a helper function in a moment.
    // For now, let's assume we can call `searchByVector`.
    
    const results = await searchProductsByVector(embedding);
    res.json(results);

  } catch (error) {
    console.error('Search image crop error:', error);
    res.status(500).json({ error: 'Failed to search by image crop' });
  }
});

// Helper function for vector search (moved from /api/products)
async function searchProductsByVector(vector, limit = 20) {
  // Use pgvector or meilisearch
  // Assuming pgvector for now based on previous context
  const vectorStr = `[${vector.join(',')}]`;
  const products = await prisma.$queryRawUnsafe(`
    SELECT id, name, price, image, "basePriceIQD", 
    1 - (("imageEmbedding" <=> '${vectorStr}')) as similarity
    FROM "Product"
    WHERE "imageEmbedding" IS NOT NULL
    ORDER BY "imageEmbedding" <=> '${vectorStr}'
    LIMIT ${limit}
  `);
  
  return {
    products: products.map(p => ({
      ...p,
      id: Number(p.id),
      similarity: Number(p.similarity)
    }))
  };
}

app.get('/api/products', async (req, res) => {
  const forcePerf = String(req.query.perf || req.headers['x-perf-log'] || '').trim() === '1';
  const perf = createPerfLog('products', ENABLE_SEARCH_PERF_LOGS || forcePerf);
  perf.log('start', { query: req.query });
  const cacheKey = JSON.stringify(req.query || {});
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
    const condition = req.query.condition || '';

    // Cache Store Settings for 60 seconds to reduce DB round-trips
    if (!cachedStoreSettings || (Date.now() - cachedStoreSettingsTime > 60000)) {
      try {
        cachedStoreSettings = await withDbRetry(() => prisma.storeSettings.findUnique({ where: { id: 1 } }));
        cachedStoreSettingsTime = Date.now();
      } catch (settingsError) {
        if (!isDbConnectionError(settingsError)) {
          throw settingsError;
        }
        if (!cachedStoreSettings) {
          cachedStoreSettings = null;
          cachedStoreSettingsTime = Date.now();
        }
      }
    }
    const storeSettings = cachedStoreSettings;
    perf.log('store_settings_ready', { cacheAgeMs: Date.now() - cachedStoreSettingsTime });

    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    const where = { 
      isActive: true,
      status: 'PUBLISHED'
    };

    if (maxPrice !== null && !isNaN(maxPrice)) {
      where.price = { lte: maxPrice };
    }
    
    if (condition) {
      if (condition === 'new') {
        where.neworold = true;
      } else if (condition === 'used') {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : []),
          {
            OR: [
              { neworold: false },
              { neworold: null }
            ]
          }
        ];
      }
    }

    const dbStartedAt = Date.now();
    const [products, total] = await withDbRetry(() => Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          price: true,
          basePriceIQD: true,
          image: true,
          aiMetadata: true,
          neworold: true,
          isFeatured: true,
          featuredSearchSentences: true,
          domesticShippingFee: true,
          deliveryTime: true,
          variants: {
            select: {
              id: true,
              combination: true,
              price: true,
              basePriceIQD: true,
              image: true,
            }
          }
        },
        skip,
        take: limit,
        orderBy: [{ isFeatured: 'desc' }, { updatedAt: 'desc' }]
      }),
      prisma.product.count({ where })
    ]));
    perf.log('db_query_done', { dbMs: Date.now() - dbStartedAt, productsCount: products.length, total });

    // If no products found, return empty result immediately to avoid processing overhead
    if (!products || products.length === 0) {
      return res.json({
        products: [],
        total: 0,
        page,
        totalPages: 0,
        engine: 'db'
      });
    }

    const payload = {
      products: products.map(p => {
        const aiMetadata = parseAiMetadata(p.aiMetadata);
        const processed = applyDynamicPricingToProduct(p, shippingRates);
        const isRealBrand = typeof aiMetadata?.isRealBrand === 'boolean' ? aiMetadata.isRealBrand : null;
        // Prefer DB value if present, otherwise extract from metadata
        const neworold = (p.neworold !== null && p.neworold !== undefined) 
          ? p.neworold 
          : extractNewOrOld(aiMetadata);
        return { ...processed, aiMetadata, isRealBrand, neworold };
      }),
      total,
      page,
      totalPages: Math.ceil(total / limit),
      engine: 'db'
    };
    productsResponseCache.set(cacheKey, { at: Date.now(), payload });
    res.json(payload);
    perf.log('response_sent', { engine: 'db', returned: products.length });
  } catch (error) {
    perf.log('error', { message: error?.message, name: error?.name });
    const cached = productsResponseCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) <= PRODUCTS_RESPONSE_TTL_MS && isDbConnectionError(error)) {
      perf.log('served_stale_cache', { ageMs: Date.now() - cached.at });
      return res.json({ ...cached.payload, stale: true });
    }
    console.error('[Products] Failed to fetch products:', error);
    try {
      const logPath = path.join(__dirname, 'server_error_full.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] Error in /api/products: ${error.message}\n${error.stack}\nQuery: ${JSON.stringify(req.query)}\n\n`);
    } catch (e) {
      console.error('Failed to write to error log:', e);
    }
    
    try {
      const publicErrorPath = path.join(__dirname, 'dist', 'server_error.txt');
      fs.mkdirSync(path.dirname(publicErrorPath), { recursive: true });
      fs.writeFileSync(publicErrorPath, `[${new Date().toISOString()}] Error in /api/products: ${error.message}\n${error.stack}\n`);
    } catch (e) {
      console.error('Failed to write to public error log:', e);
    }

    res.status(500).json({ 
      error: 'Failed to fetch products', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ADMIN: Get all products (including inactive and drafts)
app.get('/api/admin/products/check-existence', authenticateToken, isAdmin, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      select: {
        id: true,
        name: true,
        purchaseUrl: true
      }
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Failed to check product existence' });
  }
});

app.get('/api/admin/products', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  const startTime = Date.now();
  console.log('GET /api/admin/products hit', req.query);
  try { fs.appendFileSync('e:/mynewproject2/server/perf.log', `GET /api/admin/products hit at ${new Date().toISOString()}\n`); } catch (e) {}
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 21;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || 'ALL';

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    const where = {};
    
    if (search) {
      where.OR = [
        { name: { contains: search } }
      ];
      
      const searchAsInt = parseInt(search);
      if (!isNaN(searchAsInt)) {
        where.OR.push({ id: searchAsInt });
      }
    }
    
    if (status !== 'ALL') {
      where.status = status;
    } else {
      where.status = { not: 'DELETED' };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { 
          options: true,
          variants: { select: productVariantSelect },
          images: {
            orderBy: {
              order: 'asc'
            }
          }
        },
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.product.count({ where })
    ]);
    console.log(`DB Query took: ${Date.now() - startTime}ms`);
    try { fs.appendFileSync('e:/mynewproject2/server/perf.log', `DB Query took: ${Date.now() - startTime}ms\n`); } catch (e) {}

    // Handle empty products array gracefully
    if (!products || products.length === 0) {
      return res.json({
        products: [],
        total: total || 0,
        page,
        totalPages: 0
      });
    }

    res.json({
      products: products.map(p => applyDynamicPricingToProduct(p, shippingRates)),
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Fetch admin products error:', error);
    res.status(500).json({ error: 'Failed to fetch admin products' });
  }
});

app.post('/api/admin/check-links', authenticateToken, isAdmin, async (req, res) => {
  checkAllProductLinks();
  res.json({ message: 'Link check started in background' });
});

function emitBulkImportJobEvent(payload) {
  io.to('admin_notifications').emit('bulk_import_job', payload);
}

function getBulkImportJobSnapshot(job) {
  if (!job) return null;
  return {
    id: job.id,
    userId: job.userId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    results: job.results,
    error: job.error
  };
}

async function runBulkProductsImport(products, { onProgress } = {}) {
  const results = {
    total: products.length,
    imported: 0,
    skipped: 0,
    requeued: 0,
    failed: 0,
    errors: [],
    skippedDetails: []
  };

  const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
  const shippingRates = {
    airShippingRate: storeSettings?.airShippingRate,
    seaShippingRate: storeSettings?.seaShippingRate,
    airShippingMinFloor: storeSettings?.airShippingMinFloor,
    seaShippingMinFloor: storeSettings?.seaShippingMinFloor,
    minFloor: storeSettings?.seaShippingMinFloor // Alias for compatibility
  };

  const parsePriceCandidate = (val) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    const matches = String(val).match(/(\d+(\.\d+)?)/g);
    if (!matches) return 0;
    let max = 0;
    for (const m of matches) {
      const n = parseFloat(m);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  };

  const isUnnamed = (val) => {
    const s = String(val || '').trim().toLowerCase();
    if (!s) return true;
    if (s === 'unnamed') return true;
    if (s === 'unnamed product') return true;
    if (s.includes('unnamed')) return true;
    if (s === 'n/a' || s === 'na' || s === '-' || s === 'null' || s === 'undefined') return true;
    return false;
  };

  const cleanDeliveryTime = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    if (s === '10-15 يوم' || s === '3' || s === '10-15 days' || s === '10-15') return null;
    return s;
  };

  const RESTRICTED_KEYWORDS = [
    // Dangerous Goods (Batteries, Liquids, etc.)
    'battery', 'lithium', 'power bank', 'powerbank', 'batteries',
    'بطارية', 'ليثيوم', 'باور بانك', 'شاحن متنقل',
    'liquid', 'oil', 'cream', 'gel', 'paste', 'shampoo', 'perfume', 'spray', 'aerosol',
    'سائل', 'زيت', 'كريم', 'جل', 'معجون', 'شامبو', 'عطر', 'بخاخ',
    'powder', 'dust', 'مسحوق', 'بودرة',
    'magnet', 'magnetic', 'مغناطيس', 'مغناطيسي',
    'knife', 'sword', 'dagger', 'weapon', 'gun', 'rifle',
    'سكين', 'سيف', 'خنجر', 'سلاح', 'بندقية',
    'flammable', 'lighter', 'gas', 'قابل للاشتعال', 'ولاعة', 'غاز',
    // Furniture / Bulky Items
    'furniture', 'sofa', 'couch', 'chair', 'table', 'desk', 'wardrobe', 'cabinet', 'cupboard', 
    'bed', 'mattress', 'bookshelf', 'shelf', 'shelves', 'dresser', 'sideboard', 'stool', 'bench',
    'armchair', 'recliner', 'ottoman', 'bean bag', 'dining set', 'tv stand', 'shoe rack',
    'أثاث', 'كنبة', 'أريكة', 'كرسي', 'طاولة', 'مكتب', 'دولاب', 'خزانة', 'سرير', 'مرتبة', 
    'رف', 'ارفف', 'تسريحة', 'كومودينو', 'بوفيه', 'مقعد', 'بنش', 'طقم جلوس', 'طاولة طعام', 
    'حامل تلفزيون', 'جزامة', 'طقم صالون', 'غرفة نوم'
  ];
  const EXCEPTIONS = [
    'cover', 'cloth', 'slipcover', 'cushion case', 'pillow case', 'protector', 'accessory', 'accessories', 'toy', 'miniature', 'model',
    'غطاء', 'مفرش', 'تلبيسة', 'كيس وسادة', 'حماية', 'اكسسوار', 'لعبة', 'نموذج', 'مجسم'
  ];

  const detectAirRestriction = (text) => {
    if (!text) return false;
    const lowerText = String(text).toLowerCase();
    for (const keyword of RESTRICTED_KEYWORDS) {
      if (lowerText.includes(keyword.toLowerCase())) {
        const isException = EXCEPTIONS.some(ex => lowerText.includes(ex.toLowerCase()));
        if (!isException) return true;
      }
    }
    return false;
  };

  const fieldMapping = {
    'size': 'المقاس',
    'Size': 'المقاس',
    '尺码': 'المقاس',
    'color': 'اللون',
    'Color': 'اللون',
    '颜色': 'اللون',
    '颜色分类': 'اللون',
    'اللون': 'اللون',
    'تصنيف الألوان': 'اللون',
    'المقاس': 'المقاس',
    'style': 'الستايل',
    'material': 'الخامة',
    'type': 'النوع',
    'model': 'المقاس',
    'models': 'المقاس',
    'colors': 'اللون',
    'colours': 'اللون',
    'color': 'اللون',
    'colour': 'اللون',
    'size': 'المقاس',
    'sizes': 'المقاس'
  };

  const maybeReportProgress = () => {
    if (typeof onProgress !== 'function') return;
    const processed = results.imported + results.skipped + results.failed;
    onProgress({
      results,
      processed,
      total: results.total,
      progress: results.total > 0 ? Math.round((processed / results.total) * 100) : 100
    });
  };

  for (const p of products) {
    try {
      const name = cleanStr(p.name || p.product_name || 'Unnamed').replace(/\n/g, ' ').trim();
      const purchaseUrl = (p.purchaseUrl || p.url || '').replace(/[`"']/g, '').trim();
      const chineseName = cleanStr(p.chineseName) || '';
      const parseJsonObject = (val) => {
        if (!val) return null;
        if (typeof val === 'object') return val;
        if (typeof val === 'string') {
          try {
            const parsed = JSON.parse(val);
            return parsed && typeof parsed === 'object' ? parsed : null;
          } catch {
            return null;
          }
        }
        return null;
      };
      const aiMetadata = parseJsonObject(p.aiMetadata) || parseJsonObject(p.marketing_metadata) || parseJsonObject(p.aimetatags);
      
      let existingProduct = null;
      if (purchaseUrl && !isUnnamed(name)) {
        existingProduct = await prisma.product.findFirst({ where: { purchaseUrl, name } });
        if (!existingProduct && chineseName) {
          existingProduct = await prisma.product.findFirst({ where: { purchaseUrl, chineseName } });
        }
      } else if (purchaseUrl) {
        existingProduct = await prisma.product.findFirst({ where: { purchaseUrl } });
      } else if (chineseName && !isUnnamed(name)) {
        existingProduct = await prisma.product.findFirst({ where: { name, chineseName } });
      } else if (!isUnnamed(name)) {
        existingProduct = await prisma.product.findFirst({ where: { name } });
      }

      if (existingProduct) {
        results.skipped++;
        enqueueEmbeddingJob(existingProduct.id);
        enqueueImageEmbeddingJob(existingProduct.id);
        results.requeued++;
        if (Array.isArray(results.skippedDetails) && results.skippedDetails.length < 25) {
          const matchedBy = [];
          if (purchaseUrl && existingProduct.purchaseUrl === purchaseUrl) matchedBy.push('purchaseUrl');
          if (chineseName && existingProduct.chineseName === chineseName) matchedBy.push('chineseName');
          if (!isUnnamed(name) && existingProduct.name === name) matchedBy.push('name');
          results.skippedDetails.push({
            name,
            existingId: existingProduct.id,
            matchedBy: matchedBy.length ? matchedBy : ['unknown']
          });
        }
        maybeReportProgress();
        continue;
      }

      const parsePrice = parsePriceCandidate;

      const parseNum = (val, isWeight = false) => {
        if (val === undefined || val === null || val === '') return null;
        let cleanVal = String(val).replace(/[^\d.]/g, '');
        let num = parseFloat(cleanVal);
        if (isNaN(num)) return null;
        
        if (isWeight && num > 100) {
          num = num / 1000;
        }
        return num;
      };
      
      const domesticShippingFee = parsePrice(p.domestic_shipping_fee || p.domesticShippingFee || p.domestic_shipping) || 0;

      let rawPrice = 0;
      rawPrice = Math.max(
        rawPrice,
        parsePrice(p.general_price),
        parsePrice(p.price),
        parsePrice(p.basePriceIQD),
        parsePrice(p.rawPrice),
        parsePrice(p.rawRmbPrice)
      );

      if (rawPrice <= 0 && p.priceModel && typeof p.priceModel === 'object') {
        if (Array.isArray(p.priceModel.currentPrices)) {
          rawPrice = Math.max(rawPrice, ...p.priceModel.currentPrices.map(parsePrice));
        }
        if (Array.isArray(p.priceModel.skuPrices)) {
          rawPrice = Math.max(rawPrice, ...p.priceModel.skuPrices.map(parsePrice));
        }
      }

      if (rawPrice <= 0 && Array.isArray(p.variants_data)) {
        rawPrice = Math.max(rawPrice, ...p.variants_data.map(v => parsePrice(v?.price)));
      }

      if (rawPrice <= 0 && Array.isArray(p.generated_options)) {
        rawPrice = Math.max(rawPrice, ...p.generated_options.map(v => parsePrice(v?.price)));
      }

      const isPriceCombined = true;

      const priceInput = rawPrice;
      const price = isPriceCombined 
        ? rawPrice 
        : calculateBulkImportPrice(priceInput, domesticShippingFee, p.weight || p['重量'] || p.grossWeight, p.length || p['长'] || p['长度'], p.width || p['宽'] || p['宽度'], p.height || p['高'] || p['高度'], p.shippingMethod, shippingRates);

      if (price <= 0 || rawPrice <= 0) {
        console.log(`[Bulk Import] Failed product with 0 price: ${name}`);
        results.failed++;
        results.errors.push({ name, error: 'Invalid or missing price' });
        maybeReportProgress();
        continue;
      }

      const extractGeneratedOptionEntries = (opt) => {
        const out = [];
        if (!opt || typeof opt !== 'object') return out;

        const maybeParseJson = (val) => {
          if (!val) return null;
          if (typeof val === 'object') return val;
          if (typeof val === 'string') {
            try {
              const parsed = JSON.parse(val);
              return parsed && typeof parsed === 'object' ? parsed : null;
            } catch {
              return null;
            }
          }
          return null;
        };

        const metaKeys = new Set(['price', 'image', 'shippingmethod', 'method']);

        const pushEntry = (rawKey, rawVal) => {
          const cleanedKey = cleanStr(String(rawKey));
          if (!cleanedKey) return;
          const lower = cleanedKey.toLowerCase();
          if (metaKeys.has(lower)) return;

          if (lower === 'options' || lower === 'combination' || lower === 'variant' || lower === 'variants') {
            const nested = maybeParseJson(rawVal);
            if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
              for (const [k, v] of Object.entries(nested)) pushEntry(k, v);
              return;
            }
          }

          out.push([cleanedKey, rawVal]);
        };

        for (const [k, v] of Object.entries(opt)) pushEntry(k, v);
        return out;
      };

      let rawOptions = [];
      if (Array.isArray(p.options)) {
        rawOptions = [...p.options];
      } else if (p.variants && typeof p.variants === 'object') {
        for (const [rawKey, rawVal] of Object.entries(p.variants)) {
          const cleanedKey = cleanStr(String(rawKey));
          if (!cleanedKey) continue;
          if (!Array.isArray(rawVal)) continue;
          const mappedName = (() => {
            const lower = cleanedKey.toLowerCase();
            if (lower === 'color' || lower === 'colour') return 'اللون';
            if (lower === 'size' || lower === 'sizes') return 'المقاس';
            return fieldMapping[cleanedKey] || cleanedKey;
          })();
          const values = rawVal.map(v => cleanStr(String(v))).filter(Boolean);
          if (values.length > 0) rawOptions.push({ name: mappedName, values });
        }
      } else if (Array.isArray(p.generated_options)) {
        const valuesByName = new Map();
        for (const opt of p.generated_options) {
          for (const [cleanedKey, rawVal] of extractGeneratedOptionEntries(opt)) {
            const lower = cleanedKey.toLowerCase();
            const mappedName = (() => {
              if (lower === 'color' || lower === 'colour') return 'اللون';
              if (lower === 'size' || lower === 'sizes') return 'المقاس';
              return fieldMapping[cleanedKey] || cleanedKey;
            })();

            const rawValues = Array.isArray(rawVal) ? rawVal : [rawVal];
            const cleanedValues = rawValues
              .map(v => {
                if (v === null || v === undefined) return '';
                if (typeof v === 'object') return cleanStr(String(v.value ?? v.name ?? JSON.stringify(v)));
                return cleanStr(String(v));
              })
              .filter(Boolean);

            if (cleanedValues.length === 0) continue;
            if (!valuesByName.has(mappedName)) valuesByName.set(mappedName, new Set());
            for (const cv of cleanedValues) valuesByName.get(mappedName).add(cv);
          }
        }
        for (const [name, values] of valuesByName.entries()) {
          const list = [...values];
          if (list.length > 0) rawOptions.push({ name, values: list });
        }
      }

      Object.entries(fieldMapping).forEach(([field, standardName]) => {
        const val = p[field];
        if (val) {
          const existingOpt = rawOptions.find(o => o.name === standardName || o.name?.toLowerCase() === field.toLowerCase());
          const newValues = String(val).split(',').map(v => cleanStr(v)).filter(v => v !== '');
          if (newValues.length > 0) {
            if (!existingOpt) {
              rawOptions.push({ name: standardName, values: newValues });
            } else if (!existingOpt.values || existingOpt.values.length === 0) {
              existingOpt.values = newValues;
              existingOpt.name = standardName;
            }
          }
        }
      });

      let processedOptions = rawOptions.map(opt => {
        const optName = cleanStr(opt.name);
        return {
          name: fieldMapping[optName] || optName,
          values: (Array.isArray(opt.values) ? opt.values : [])
                  .map(v => cleanStr(String(v)))
                  .filter(v => v !== '')
        };
      }).filter(opt => opt.name !== '' && opt.values.length > 0);
      
      console.log(`[Bulk Debug] Product: ${name}`);
      console.log(`[Bulk Debug] Raw Options:`, JSON.stringify(rawOptions));
      console.log(`[Bulk Debug] Processed Options (before unique):`, JSON.stringify(processedOptions));
      
      // Ensure unique option names by merging values
      const uniqueOptionsMap = new Map();
      for (const opt of processedOptions) {
        if (!uniqueOptionsMap.has(opt.name)) {
          uniqueOptionsMap.set(opt.name, new Set(opt.values));
        } else {
          for (const v of opt.values) uniqueOptionsMap.get(opt.name).add(v);
        }
      }
      processedOptions = Array.from(uniqueOptionsMap.entries()).map(([name, valuesSet]) => ({
        name,
        values: Array.from(valuesSet)
      }));
      console.log(`[Bulk Debug] Processed Options (final):`, JSON.stringify(processedOptions));

      let specs = cleanStr(p.specs);
      if (!specs && p.product_details && typeof p.product_details === 'object') {
        specs = Object.entries(p.product_details)
          .map(([key, val]) => `${key}: ${val}`)
          .join('\n');
      }

      const hasReviews = (p.reviews && p.reviews.length > 0) || (p.detailedReviews && p.detailedReviews.length > 0);
      if (!specs?.includes('---REVIEW_SUMMARY---') && (p.reviewCountText || p.positiveRate || hasReviews)) {
        const reviewSummary = {
          countText: p.reviewCountText || (Array.isArray(p.reviews) ? String(p.reviews.length) : '0'),
          positiveRate: p.positiveRate || '100%',
          tags: Array.isArray(p.reviews) && typeof p.reviews[0] === 'string' ? p.reviews : [],
          reviews: Array.isArray(p.reviews) && typeof p.reviews[0] === 'object' ? p.reviews : [],
          detailedReviews: p.detailedReviews || []
        };
        specs = (specs || '') + '\n---REVIEW_SUMMARY---\n' + JSON.stringify(reviewSummary);
      }

      const rawImages = p.main_images || p.images || (p.image ? [p.image] : []);
      const imageUrls = (Array.isArray(rawImages) ? rawImages : [])
        .map(url => typeof url === 'string' ? url.replace(/[`"']/g, '').trim() : url)
        .filter(url => url && typeof url === 'string' && url.startsWith('http'));
      
      const mainImage = imageUrls.length > 0 ? imageUrls[0] : (p.image || '');

      let weight = parseNum(p.weight || p['重量'] || p.grossWeight, true);
      let length = parseNum(p.length || p['长'] || p['长度']);
      let width = parseNum(p.width || p['宽'] || p['宽度']);
      let height = parseNum(p.height || p['高'] || p['高度']);

      if (p.dimensions && (!length || !width || !height)) {
        const parts = String(p.dimensions).toLowerCase().split(/[x*]/).map(s => parseFloat(s.trim()));
        if (parts.length === 3) {
          if (!length) length = parts[0];
          if (!width) width = parts[1];
          if (!height) height = parts[2];
        }
      }

      if (!weight || !length || !width || !height) {
        try {
          console.log(`[AI] Estimating missing dimensions for: ${name}`);
          const estimates = await estimateProductPhysicals({
            name,
            image: mainImage,
            description: p.description
          });
          
          if (!weight) weight = estimates.weight;
          if (!length) length = estimates.length;
          if (!width) width = estimates.width;
          if (!height) height = estimates.height;
        } catch (aiErr) {
          console.error('[AI] Estimation failed:', aiErr);
        }
      }

      // Determine effective shipping method for consistency across variants
      // (Moved calculation below to capture all data)

      const variantsInput = Array.isArray(p.variants_data) ? p.variants_data : [];
      if (variantsInput.length === 0 && Array.isArray(p.generated_options)) {
        const generated = [];
        for (const opt of p.generated_options) {
          if (!opt || typeof opt !== 'object') continue;
          const optPrice = parsePrice(opt.price) || rawPrice;
          const optImage = cleanStr(opt.image);

          const dimensionsMap = new Map();
          for (const [cleanedKey, rawVal] of extractGeneratedOptionEntries(opt)) {
            const lower = cleanedKey.toLowerCase();
            const mappedName = (() => {
              if (lower === 'color' || lower === 'colour') return 'اللون';
              if (lower === 'size' || lower === 'sizes') return 'المقاس';
              return fieldMapping[cleanedKey] || cleanedKey;
            })();

            const rawValues = Array.isArray(rawVal) ? rawVal : [rawVal];
            const cleanedValues = rawValues
              .map(v => {
                if (v === null || v === undefined) return '';
                if (typeof v === 'object') return cleanStr(String(v.value ?? v.name ?? JSON.stringify(v)));
                return cleanStr(String(v));
              })
              .filter(Boolean);

            if (cleanedValues.length === 0) continue;
            if (!dimensionsMap.has(mappedName)) dimensionsMap.set(mappedName, []);
            dimensionsMap.get(mappedName).push(...cleanedValues);
          }

          const dimensions = [...dimensionsMap.entries()]
            .map(([k, vals]) => [k, [...new Set(vals)]])
            .filter(([, vals]) => vals.length > 0);

          if (dimensions.length === 0) continue;

          let combinations = [{}];
          for (const [dimName, dimVals] of dimensions) {
            const next = [];
            for (const combo of combinations) {
              for (const val of dimVals) {
                next.push({ ...combo, [dimName]: val });
              }
            }
            combinations = next;
          }

          for (const combo of combinations) {
            if (Object.keys(combo).length === 0) continue;
            generated.push({ 
              options: combo, 
              price: optPrice, 
              basePriceIQD: optPrice, // Explicitly set basePriceIQD
              isPriceCombined: false, // Explicitly allow dynamic pricing
              currency: 'IQD',
              image: optImage || null 
            });
          }
        }
        variantsInput.push(...generated);
      }
      
      const optionMap = new Map();
      const normalizeOptionName = (optName) => cleanStr(optName).toLowerCase();
      const addOptionValue = (optName, optValue) => {
        const name = cleanStr(optName);
        if (!name) return;
        const value = cleanStr(optValue);
        if (!value) return;
        const key = normalizeOptionName(name);
        if (!optionMap.has(key)) optionMap.set(key, { name, values: new Set() });
        optionMap.get(key).values.add(value);
      };
      
      for (const opt of processedOptions) {
        if (!opt?.name) continue;
        const vals = Array.isArray(opt.values) ? opt.values : [];
        for (const v of vals) addOptionValue(opt.name, v);
      }
      
      for (const v of variantsInput) {
        let combo = v?.options ?? v?.combination ?? {};
        if (typeof combo === 'string') {
          try { combo = JSON.parse(combo); } catch { combo = {}; }
        }
        if (!combo || typeof combo !== 'object') continue;
        for (const [k, rawVal] of Object.entries(combo)) {
          const valString = typeof rawVal === 'object' && rawVal !== null
            ? (rawVal.value ?? rawVal.name ?? JSON.stringify(rawVal))
            : String(rawVal);
          addOptionValue(fieldMapping[cleanStr(k)] || k, valString);
        }
      }
      
      processedOptions = [...optionMap.values()]
        .map((entry) => ({ name: entry.name, values: [...entry.values] }))
        .filter(opt => opt.name !== '' && opt.values.length > 0);

      // Determine effective shipping method for consistency across variants
      let effectiveMethod = p.shippingMethod;
      if (!effectiveMethod) {
        const volCbm = (length || 0) * (width || 0) * (height || 0) / 1000000;
        const w = weight || 0.5;
        console.log(`[Bulk Debug] ${name}: VolCBM=${volCbm}, Weight=${w}, Dims=${length}x${width}x${height}`);
        // If explicitly heavy or large volume, default to SEA
        if (w >= 1 || volCbm > 0.02) {
          effectiveMethod = 'sea';
        } else {
          effectiveMethod = 'air';
        }
        console.log(`[Bulk Debug] Effective Method: ${effectiveMethod}`);
      }

      // Extract new fields
      const shippingPriceIncluded = p.shipping_price_included !== undefined ? (p.shipping_price_included === true || String(p.shipping_price_included) === 'true') : true;

      // Re-calculate main price with resolved dimensions and effective method
      const finalPriceInput = rawPrice;
      let finalPrice;
      
      if (isPriceCombined) {
        finalPrice = rawPrice;
      } else if (!shippingPriceIncluded) {
        // Exclude shipping cost but keep markup and domestic fee
        // Formula: (Base + Domestic) * 1.25
        const domestic = domesticShippingFee || 0;
        const price = (finalPriceInput + domestic) * 1.25;
        finalPrice = Math.ceil(price / 250) * 250;
      } else {
        finalPrice = calculateBulkImportPrice(finalPriceInput, domesticShippingFee, weight, length, width, height, effectiveMethod, shippingRates);
      }
      console.log(`[Bulk Debug] Final Main Price: ${finalPrice} (Raw=${rawPrice})`);

      const product = await prisma.product.create({
        data: {
          name,
          // chineseName, // Removed as it is not in schema
          // description: cleanStr(p.description) || '',
          price: finalPrice,
          basePriceIQD: rawPrice,
          image: mainImage,
          purchaseUrl,
          status: 'PUBLISHED',
          isActive: true,
          isFeatured: !!p.isFeatured,
          specs: specs,
          neworold: typeof p.neworold === 'boolean' ? p.neworold : null,
          // storeEvaluation: p.storeEvaluation && typeof p.storeEvaluation === 'object' ? JSON.stringify(p.storeEvaluation) : (p.storeEvaluation || null),
          // reviewsCountShown: p.reviewsCountShown || null,
          // // videoUrl: p.videoUrl || null,
          aiMetadata: aiMetadata || null,
          // weight,
          // length,
          // width,
          // height,
          domesticShippingFee,
          isAirRestricted: p.isAirRestricted === true || p.isAirRestricted === 'true' || p.isAirRestricted === 1 || p.is_air_restricted === true || p.is_air_restricted === 'true' || p.is_air_restricted === 1 || p.IsAirRestricted === true || p.IsAirRestricted === 'true' || p.IsAirRestricted === 1 || detectAirRestriction(`${name} ${specs || ''}`),
          deliveryTime: cleanDeliveryTime(p.deliveryTime || p.delivery_time || p.Delivery_time),
          // shippingPriceIncluded: shippingPriceIncluded, // Removed as it is not in schema
          options: {
            create: processedOptions.map(opt => ({
              name: opt.name,
              values: JSON.stringify(opt.values)
            }))
          },
          variants: {
            create: variantsInput.map(v => {
              let variantRawPrice = parsePrice(v.price) || rawPrice;
              let variantBaseRaw = parsePrice(v.basePriceIQD);
              // Use explicit basePriceIQD if available (e.g. from generated options), otherwise fall back to price
              const finalBasePrice = (variantBaseRaw && variantBaseRaw > 0) ? variantBaseRaw : variantRawPrice;
              
              const isGenerated = v.currency === 'IQD';
              const variantIsPriceCombined = true !== undefined 
                 ? (String(true) === 'true' || true === true) 
                 : (isGenerated ? false : (isPriceCombined || variantRawPrice > 1000));
              
              const variantWeight = v.weight || weight || p['重量'] || p.grossWeight;
              
              let vPrice;
              if (variantIsPriceCombined) {
                 vPrice = finalBasePrice;
              } else if (!shippingPriceIncluded) {
                 const domestic = domesticShippingFee || 0;
                 const price = (finalBasePrice + domestic) * 1.25;
                 vPrice = Math.ceil(price / 250) * 250;
              } else {
                 vPrice = calculateBulkImportPrice(finalBasePrice, domesticShippingFee, variantWeight, v.length || length, v.width || width, v.height || height, v.shippingMethod || effectiveMethod, shippingRates);
              }

              console.log(`[Bulk Debug] Variant Price: ${vPrice} (Raw=${variantRawPrice}, Method=${v.shippingMethod || effectiveMethod}, Dims=${v.length || length}x${v.width || width}x${v.height || height})`);

              return {
                combination: typeof v.options === 'object' ? JSON.stringify(v.options) : 
                            (typeof v.combination === 'object' ? JSON.stringify(v.combination) : (v.combination || '{}')),
                price: vPrice,
                basePriceIQD: finalBasePrice,
                image: v.image || null,
                weight: variantWeight ? parseFloat(variantWeight) : null,
                length: v.length ? parseFloat(v.length) : null,
                width: v.width ? parseFloat(v.width) : null,
                height: v.height ? parseFloat(v.height) : null
              };
            })
          },
          images: {
            create: imageUrls.map((url, index) => ({
              url: url,
              order: index,
              type: 'GALLERY'
            }))
          }
        }
      });

      enqueueEmbeddingJob(product.id);
      enqueueImageEmbeddingJob(product.id);
      void syncProductToMeiliById(product.id).catch((meiliError) => {
        console.error('[Meili] bulk product sync failed:', meiliError?.message || meiliError);
      });

      results.imported++;
      maybeReportProgress();
    } catch (err) {
      console.error(`Failed to process bulk import product ${p.name || p.product_name}:`, err);
      results.failed++;
      if (results.errors.length < 50) {
        results.errors.push({ name: p.name || p.product_name, error: err.message });
      } else {
        results.errorsTruncated = true;
      }
      maybeReportProgress();
    }
  }

  return results;
}

function enqueueBulkImportJob({ userId, products }) {
  const id = randomUUID();
  const job = {
    id,
    userId,
    status: 'queued',
    total: Array.isArray(products) ? products.length : 0,
    processed: 0,
    products: Array.isArray(products) ? products : [],
    lastProgressEmitAt: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    results: null,
    error: null
  };

  bulkImportJobs.set(id, job);
  bulkImportJobQueue.push(id);

  emitBulkImportJobEvent(getBulkImportJobSnapshot(job));
  runBulkImportJobWorker();

  return getBulkImportJobSnapshot(job);
}

async function runBulkImportJobWorker() {
  if (bulkImportJobRunning) return;
  bulkImportJobRunning = true;

  try {
    while (bulkImportJobQueue.length > 0) {
      const jobId = bulkImportJobQueue.shift();
      const job = bulkImportJobs.get(jobId);
      if (!job) continue;

      job.status = 'processing';
      job.startedAt = new Date().toISOString();
      job.processed = 0;
      job.error = null;
      job.results = null;
      job.lastProgressEmitAt = 0;
      emitBulkImportJobEvent(getBulkImportJobSnapshot(job));

      try {
        const results = await runBulkProductsImport(job.products, {
          onProgress: ({ processed, total, progress }) => {
            job.processed = processed;
            const now = Date.now();
            const shouldEmit = processed === total || now - (job.lastProgressEmitAt || 0) >= 750;
            if (shouldEmit) {
              job.lastProgressEmitAt = now;
              emitBulkImportJobEvent({
                ...getBulkImportJobSnapshot(job),
                progress
              });
            }
          }
        });

        job.results = results;
        job.processed = results.imported + results.skipped + results.failed;
        job.status = 'completed';
        job.finishedAt = new Date().toISOString();
        emitBulkImportJobEvent({
          ...getBulkImportJobSnapshot(job),
          progress: 100
        });
      } catch (err) {
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.error = String(err?.message || err);
        emitBulkImportJobEvent({
          ...getBulkImportJobSnapshot(job),
          progress: job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0
        });
      }
    }
  } finally {
    bulkImportJobRunning = false;
  }
}

app.post('/api/admin/products/bulk-import-jobs', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { products } = req.body;
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }

    const job = enqueueBulkImportJob({ userId: req.user.id, products });
    res.json({ success: true, job });
  } catch (error) {
    console.error('[Bulk Import Jobs] Error:', error);
    res.status(500).json({ error: 'Failed to enqueue bulk import job' });
  }
});

app.get('/api/admin/products/bulk-import-jobs/:jobId', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  const { jobId } = req.params;
  const job = bulkImportJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, job: getBulkImportJobSnapshot(job) });
});

app.post('/api/products/bulk', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  const { products, useSSE = false } = req.body;

  if (!Array.isArray(products)) {
    return res.status(400).json({ error: 'Invalid products data' });
  }

  if (useSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }
  try {
    const results = await runBulkProductsImport(products, {
      onProgress: ({ results: r, processed, total }) => {
        if (!useSSE) return;
        if (processed % 5 !== 0 && processed !== total) return;
        res.write(`data: ${JSON.stringify({ 
          progress: total > 0 ? Math.round((processed / total) * 100) : 100,
          imported: r.imported,
          total
        })}\n\n`);
      }
    });

    if (useSSE) {
      res.write(`data: ${JSON.stringify({ complete: true, results })}\n\n`);
      res.end();
    } else {
      res.json(results);
    }
  } catch (error) {
    console.error('[Bulk Import] Error:', error);
    if (useSSE) {
      res.write(`data: ${JSON.stringify({ complete: true, error: error.message || 'Failed to bulk import products' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: error.message || 'Failed to bulk import products' });
    }
  }
});

app.post('/api/products', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { 
      name, chineseName, description, price, basePriceIQD, image, 
      isFeatured, isActive, status, purchaseUrl, videoUrl, 
      specs, images, detailImages, featuredSearchSentences,
      weight, length, width, height, domesticShippingFee, options, variants, aiMetadata, deliveryTime, isAirRestricted
    } = req.body;

    const normalizedFeaturedSearchSentences = sanitizeFeaturedSearchSentences(featuredSearchSentences);
    const parsedAiMetadata = (() => {
      const candidate = aiMetadata ?? req.body.marketing_metadata ?? req.body.aimetatags;
      if (!candidate) return null;
      if (typeof candidate === 'object') return candidate;
      if (typeof candidate === 'string') {
        try {
          const parsed = JSON.parse(candidate);
          return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
          return null;
        }
      }
      return null;
    })();
    
    // Process main images (gallery)
    let processedGalleryImages = [];
    let processedDetailImages = [];

    const rawImages = Array.isArray(images) ? images : (image ? [image] : []);
    
    for (const img of rawImages) {
      let url = typeof img === 'string' ? img : img.url;
      let type = typeof img === 'object' ? img.type : 'GALLERY';
      
      if (!url || typeof url !== 'string') continue;
      
      const cleanedUrl = url.replace(/[`"']/g, '').trim();
      let finalUrl = cleanedUrl;
      
      if (cleanedUrl.startsWith('data:image')) {
        finalUrl = await convertToWebP(cleanedUrl);
      }
      
      if (finalUrl && (finalUrl.startsWith('http') || finalUrl.startsWith('data:image'))) {
        if (type === 'DETAIL') {
          processedDetailImages.push(finalUrl);
        } else {
          processedGalleryImages.push(finalUrl);
        }
      }
    }

    // Process explicit detail images if provided
    if (Array.isArray(detailImages)) {
      for (const img of detailImages) {
        let url = typeof img === 'string' ? img : img.url;
        if (!url || typeof url !== 'string') continue;
        
        const cleanedUrl = url.replace(/[`"']/g, '').trim();
        let finalUrl = cleanedUrl;
        
        if (cleanedUrl.startsWith('data:image')) {
          finalUrl = await convertToWebP(cleanedUrl);
        }
        
        if (finalUrl && (finalUrl.startsWith('http') || finalUrl.startsWith('data:image'))) {
          processedDetailImages.push(finalUrl);
        }
      }
    }
    
    // Deduplicate and limit
    let imageUrls = [...new Set(processedGalleryImages)].slice(0, 200);
    let detailImageUrls = [...new Set(processedDetailImages)].slice(0, 200);
    
    const mainImage = imageUrls.length > 0 ? imageUrls[0] : (image || '');

    if (status === 'DRAFT') {
      return res.status(200).json({
        name,
        chineseName,
        description,
        price,
        basePriceIQD,
        image: mainImage,
        purchaseUrl,
        // videoUrl,
        isFeatured: normalizedFeaturedSearchSentences.length > 0,
        featuredSearchSentences: normalizedFeaturedSearchSentences,
        isActive: isActive !== undefined ? isActive : true,
        status: 'DRAFT',
        specs: specs && typeof specs === 'object' ? JSON.stringify(specs) : (specs || null),
        // storeEvaluation: storeEvaluation && typeof storeEvaluation === 'object' ? JSON.stringify(storeEvaluation) : (storeEvaluation || null),
        // reviewsCountShown: reviewsCountShown || null,
        weight: safeParseFloat(weight),
        length: safeParseFloat(length),
        width: safeParseFloat(width),
        height: safeParseFloat(height),
        domesticShippingFee: safeParseFloat(domesticShippingFee),
        deliveryTime: deliveryTime || null,
        images: [
          ...imageUrls.map((url, i) => ({ url, order: i, type: 'GALLERY' })),
          ...detailImageUrls.map((url, i) => ({ url, order: i, type: 'DETAIL' }))
        ]
      });
    }

    if (!name) {
      return res.status(400).json({ error: 'اسم المنتج مطلوب' });
    }

    const domesticFee = safeParseFloat(domesticShippingFee) || 0;
    // Determine if price is combined using explicit flag or heuristic (price > 1000 implies IQD final price)
    const isPriceCombined = true;
    
    // Extract new fields for shipping exclusion
    const shippingPriceIncluded = req.body.shippingPriceIncluded !== undefined ? (req.body.shippingPriceIncluded === true || String(req.body.shippingPriceIncluded) === 'true') : true;

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };
    
    // Use the same markup logic as bulk import
    const rawPrice = safeParseFloat(price) || 0;
    let finalPrice;
    
    if (isPriceCombined) {
      finalPrice = rawPrice;
    } else if (!shippingPriceIncluded) {
      // Exclude shipping cost but keep markup and domestic fee
      // Formula: (Base + Domestic) * 1.25
      const domestic = domesticFee || 0;
      const calculatedPrice = (rawPrice + domestic) * 1.25;
      finalPrice = Math.ceil(calculatedPrice / 250) * 250;
    } else {
      finalPrice = calculateBulkImportPrice(rawPrice, domesticFee, weight, length, width, height, req.body.shippingMethod, shippingRates);
    }

    const cleanDeliveryTime = (val) => {
      if (!val) return null;
      const s = String(val).trim();
      if (s === '10-15 يوم' || s === '3' || s === '10-15 days' || s === '10-15') return null;
      return s;
    };

    const product = await prisma.product.create({
      data: {
        name,
        // chineseName,
        // description,
        price: finalPrice,
        basePriceIQD: safeParseFloat(basePriceIQD),
        image: mainImage,
        purchaseUrl,
        // videoUrl,
        isFeatured: normalizedFeaturedSearchSentences.length > 0,
        featuredSearchSentences: normalizedFeaturedSearchSentences,
        isActive: isActive !== undefined ? isActive : true,
        status: status || 'PUBLISHED',
        specs: specs && typeof specs === 'object' ? JSON.stringify(specs) : (specs || null),
        // storeEvaluation: storeEvaluation && typeof storeEvaluation === 'object' ? JSON.stringify(storeEvaluation) : (storeEvaluation || null),
        // reviewsCountShown: reviewsCountShown || null,
        // weight: safeParseFloat(weight),
        // length: safeParseFloat(length),
        // width: safeParseFloat(width),
        // height: safeParseFloat(height),
        domesticShippingFee: domesticFee,
        // shippingPriceIncluded: shippingPriceIncluded,
        isAirRestricted: isAirRestricted === true || isAirRestricted === 'true' || isAirRestricted === 1,
        aiMetadata: stripLegacyFeaturedSearchTermsFromMetadata(parsedAiMetadata),
        deliveryTime: cleanDeliveryTime(deliveryTime),
        neworold: req.body.neworold !== undefined ? req.body.neworold : null,
        images: {
          create: [
            ...imageUrls.map((url, i) => ({
              url,
              order: i,
              type: 'GALLERY'
            })),
            ...detailImageUrls.map((url, i) => ({
              url,
              order: i,
              type: 'DETAIL'
            }))
          ]
        },
        options: {
          create: (Array.isArray(options) ? options : []).map(opt => ({
            name: opt.name || 'Unnamed Option',
            values: Array.isArray(opt.values) ? JSON.stringify(opt.values) : (opt.values || '[]')
          }))
        },
        variants: {
          create: (Array.isArray(variants) ? variants : []).map(v => {
            const variantRawPrice = safeParseFloat(v.price) || 0;
            // Determine if variant price is combined using explicit flag or heuristic
            const variantIsPriceCombined = true !== undefined 
                ? (String(true) === 'true' || true === true) 
                : (isPriceCombined || variantRawPrice > 1000);
            
            let vPrice;
            if (variantIsPriceCombined) {
               vPrice = variantRawPrice;
            } else if (!shippingPriceIncluded) {
               const domestic = domesticFee || 0;
               const calculatedPrice = (variantRawPrice + domestic) * 1.25;
               vPrice = Math.ceil(calculatedPrice / 250) * 250;
            } else {
               vPrice = calculateBulkImportPrice(variantRawPrice, domesticFee, v.weight || weight, v.length || length, v.width || width, v.height || height, v.shippingMethod, shippingRates);
            }

            return {
              combination: typeof v.options === 'object' ? JSON.stringify(v.options) : 
                          (typeof v.combination === 'object' ? JSON.stringify(v.combination) : (v.combination || '{}')),
              price: vPrice,
              image: v.image || null,
              weight: v.weight ? safeParseFloat(v.weight) : null,
              height: v.height ? safeParseFloat(v.height) : null,
              length: v.length ? safeParseFloat(v.length) : null,
              width: v.width ? safeParseFloat(v.width) : null,
            };
          })
        }
      }
    });

    enqueueEmbeddingJob(product.id);
    enqueueImageEmbeddingJob(product.id);
    void syncProductToMeiliById(product.id).catch((meiliError) => {
      console.error('[Meili] create product sync failed:', meiliError?.message || meiliError);
    });

    res.status(201).json(product);
  } catch (error) {
    console.error('[Create Product] Error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// ADMIN: Bulk Import Products (Step 1)
app.post('/api/admin/products/bulk-import', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  // Increase timeout for bulk import to prevent connection timeout
  req.setTimeout(0);
  
  try {
    const { products } = req.body;
    console.log(`[Bulk Import] Request received for ${products?.length} products`);
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      console.warn('[Bulk Import] No products provided in request');
      return res.status(400).json({ error: 'No products provided' });
    }

    // --- Duplicate Check ---
    const normalizeUrl = (u) => (typeof u === 'string' ? u.replace(/[`"']/g, '').trim() : u);
    const purchaseUrls = [...new Set(products
      .map(p => normalizeUrl(p.purchaseUrl ?? p.url))
      .filter(url => !!url))];
    const chineseNames = [...new Set(products
      .map(p => cleanStr(p.chineseName))
      .filter(name => !!name))];

    const duplicateWhereOr = [];
    if (purchaseUrls.length > 0) duplicateWhereOr.push({ purchaseUrl: { in: purchaseUrls } });
    if (chineseNames.length > 0) duplicateWhereOr.push({ chineseName: { in: chineseNames } });

    const existingProducts = duplicateWhereOr.length > 0
      ? await prisma.product.findMany({
          where: { OR: duplicateWhereOr },
          select: { purchaseUrl: true, chineseName: true, name: true }
        })
      : [];

    const existingUrlsSet = new Set(existingProducts.map(p => p.purchaseUrl).filter(Boolean));
    const existingNamesSet = new Set(existingProducts.flatMap(p => [p.chineseName, p.name]).filter(Boolean));

    const seenInRequest = new Set();
    const uniqueProductsToImport = [];

    for (const p of products) {
      const normalizedPurchaseUrl = normalizeUrl(p.purchaseUrl ?? p.url);
      const candidateName = cleanStr(p.chineseName) || cleanStr(p.name) || cleanStr(p.product_name);
      const isDuplicateInDB =
        (!!candidateName && existingNamesSet.has(candidateName)) ||
        (normalizedPurchaseUrl && existingUrlsSet.has(normalizedPurchaseUrl) && !!candidateName && existingNamesSet.has(candidateName));
      
      const urlId = normalizedPurchaseUrl;
      const nameId = candidateName;
      const productLocalId = cleanStr(p.product_id || p.productId || p.id);
      const requestDedupKey = urlId && productLocalId ? `${urlId}::${productLocalId}` : (urlId || nameId);
      
      const isDuplicateInRequest = requestDedupKey ? seenInRequest.has(requestDedupKey) : false;
      
      if (!isDuplicateInDB && !isDuplicateInRequest) {
        uniqueProductsToImport.push(p);
        if (requestDedupKey) seenInRequest.add(requestDedupKey);
      }
    }

    console.log(`[Bulk Import] Filtered out ${products.length - uniqueProductsToImport.length} duplicates. Processing ${uniqueProductsToImport.length} new products.`);

    if (uniqueProductsToImport.length === 0) {
      return res.json({ success: true, count: 0, message: 'All products already exist' });
    }

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    // Create products as DRAFT in batches
    const drafts = [];
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < uniqueProductsToImport.length; i += BATCH_SIZE) {
      const batch = uniqueProductsToImport.slice(i, i + BATCH_SIZE);
      console.log(`[Bulk Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniqueProductsToImport.length / BATCH_SIZE)} (${batch.length} products)`);
      
      const batchResults = await Promise.all(batch.map(async (p, idx) => {
        const productIndex = i + idx;
        try {
          // ... (same processing logic as before, but without prisma.product.create)
          // I will simplify the replacement by just changing the return behavior
          
          // Actually, I should probably keep this one as is if it's meant for "bulk publishing"
          // but the user said "don't add it to supabase database untill i hit publish".
          // So even bulk imports should be local drafts.
          
          // I'll skip modifying this one for now unless I'm sure it's used for drafts.
          // In lines 2987-2988: status: 'DRAFT', isActive: false.
          // Yes, it creates drafts. So it SHOULD be moved to local storage too.
          // Enhanced price parsing to handle various formats
          const parsePrice = (val) => {
            if (val === undefined || val === null || val === '') return 0;
            const cleanVal = String(val).replace(/[^\d.]/g, '');
            return parseFloat(cleanVal) || 0;
          };
          const parseJsonObject = (val) => {
            if (!val) return null;
            if (typeof val === 'object') return val;
            if (typeof val === 'string') {
              try {
                const parsed = JSON.parse(val);
                return parsed && typeof parsed === 'object' ? parsed : null;
              } catch {
                return null;
              }
            }
            return null;
          };
          
          const domesticFee = parsePrice(p.domestic_shipping_fee || p.domesticShippingFee || p.domestic_shipping) || 0;
          
          let rawPrice = 0;
          rawPrice = Math.max(
            rawPrice,
            parsePrice(p.general_price),
            parsePrice(p.price),
            parsePrice(p.basePriceIQD),
            parsePrice(p.rawPrice),
            parsePrice(p.rawRmbPrice)
          );
          
          if (rawPrice <= 0 && p.priceModel && typeof p.priceModel === 'object') {
            if (Array.isArray(p.priceModel.currentPrices)) {
              rawPrice = Math.max(rawPrice, ...p.priceModel.currentPrices.map(parsePrice));
            }
            if (Array.isArray(p.priceModel.skuPrices)) {
              rawPrice = Math.max(rawPrice, ...p.priceModel.skuPrices.map(parsePrice));
            }
          }
          
          if (rawPrice <= 0 && Array.isArray(p.variants_data)) {
            rawPrice = Math.max(rawPrice, ...p.variants_data.map(v => parsePrice(v?.price)));
          }
          
          if (rawPrice <= 0 && Array.isArray(p.generated_options)) {
            rawPrice = Math.max(rawPrice, ...p.generated_options.map(v => parsePrice(v?.price)));
          }
          
          // Determine if price is combined (default to true if not specified, based on user feedback)
          // Heuristic: If explicitly set, use it. If > 1000, assume final IQD to avoid inflation.
          const isPriceCombined = true;
           
          // Extract new fields
          const shippingPriceIncluded = p.shipping_price_included !== undefined ? (p.shipping_price_included === true || String(p.shipping_price_included) === 'true') : true;
          const estimatedShippingCost = p.estimated_shipping_cost ? parseFloat(p.estimated_shipping_cost) : null;

           // Use the new calculation logic with 25% markup
          // WARNING: rawPrice is typically RMB from 1688. calculateBulkImportPrice expects IQD if we want to add IQD shipping.
          // But calculateBulkImportPrice adds domestic (IQD) and shipping (IQD) to rawPrice.
          // So rawPrice MUST be converted to IQD before passing if it is RMB.
          // heuristic: if !isPriceCombined (meaning rawPrice < 1000), it is likely RMB.
          // UPDATE: User requested to REMOVE automatic conversion. Input is guaranteed to be IQD.
          const priceInput = rawPrice;
          
          let price;
          if (isPriceCombined) {
            price = rawPrice;
          } else if (!shippingPriceIncluded) {
            const domestic = domesticFee || 0;
            const calculatedPrice = (priceInput + domestic) * 1.25;
            price = Math.ceil(calculatedPrice / 250) * 250;
          } else {
            price = calculateBulkImportPrice(priceInput, domesticFee, p.weight, p.length, p.width, p.height, p.shippingMethod, shippingRates);
          }
          
          // Skip products with 0 price
          if (price <= 0 || rawPrice <= 0) {
            console.log(`[Bulk Import] Skipping product with 0 price: ${p.name || 'Unnamed'}`);
            return null;
          }
          
          console.log(`[Bulk Import] Processing product ${productIndex + 1}/${uniqueProductsToImport.length}: "${p.name?.substring(0, 30)}...", price=${price} (original=${rawPrice}, domestic=${domesticFee})`);
          
          // Use original names/descriptions without translation and clean 'empty'
          const name = cleanStr(p.name) || cleanStr(p.product_name) || `Draft ${Date.now()}`;
          const description = cleanStr(p.description);
          const chineseName = cleanStr(p.chineseName) || cleanStr(p.name) || cleanStr(p.product_name);
          const aiMetadata = parseJsonObject(p.aiMetadata) || parseJsonObject(p.marketing_metadata);

          // Map Delivery_time from input to deliveryTime
          const deliveryTime = cleanStr(p.Delivery_time || p.deliveryTime || p.delivery_time);

          // Enhanced Options processing - extract from p.options OR p.variants OR direct properties
          let rawOptions = [];
          if (Array.isArray(p.options)) {
            rawOptions = [...p.options];
          } else if (typeof p.options === 'string' && p.options.trim().startsWith('[')) {
            try {
              rawOptions = JSON.parse(p.options);
            } catch (e) {
              console.warn(`[Bulk Import] Failed to parse options string for product ${productIndex + 1}`);
            }
          } else if (p.variants && typeof p.variants === 'object') {
            // Support user's "variants": { "sizes": [...], "colors": [...] } format
            for (const [rawKey, rawVal] of Object.entries(p.variants)) {
              const cleanedKey = cleanStr(String(rawKey));
              if (!cleanedKey) continue;
              if (!Array.isArray(rawVal)) continue;

              const lower = cleanedKey.toLowerCase();
              const mappedName =
                (lower === 'color' || lower === 'colour' || lower === 'colors' || lower === 'colours') ? 'اللون'
                  : (lower === 'size' || lower === 'sizes') ? 'المقاس'
                    : cleanedKey;

              const values = rawVal.map(v => cleanStr(String(v))).filter(Boolean);
              if (values.length > 0) rawOptions.push({ name: mappedName, values });
            }
          } else if (Array.isArray(p.generated_options)) {
            const valuesByName = new Map();
            for (const opt of p.generated_options) {
              if (!opt || typeof opt !== 'object') continue;
              for (const [rawKey, rawVal] of Object.entries(opt)) {
                const cleanedKey = cleanStr(String(rawKey));
                if (!cleanedKey) continue;
                const lower = cleanedKey.toLowerCase();
                if (lower === 'price' || lower === 'image' || lower === 'shippingmethod' || lower === 'method') continue;

                const mappedName =
                  (lower === 'color' || lower === 'colour' || lower === 'colors' || lower === 'colours') ? 'اللون'
                    : (lower === 'size' || lower === 'sizes') ? 'المقاس'
                      : cleanedKey;

                const rawValues = Array.isArray(rawVal) ? rawVal : [rawVal];
                const cleanedValues = rawValues
                  .map(v => {
                    if (v === null || v === undefined) return '';
                    if (typeof v === 'object') return cleanStr(String(v.value ?? v.name ?? JSON.stringify(v)));
                    return cleanStr(String(v));
                  })
                  .filter(Boolean);

                if (cleanedValues.length === 0) continue;
                if (!valuesByName.has(mappedName)) valuesByName.set(mappedName, new Set());
                for (const cv of cleanedValues) valuesByName.get(mappedName).add(cv);
              }

              const dimensions = [...dimensionsMap.entries()]
                .map(([k, vals]) => [k, [...new Set(vals)]])
                .filter(([, vals]) => vals.length > 0);

              if (dimensions.length === 0) continue;

              let combinations = [{}];
              for (const [dimName, dimVals] of dimensions) {
                const next = [];
                for (const combo of combinations) {
                  for (const val of dimVals) {
                    next.push({ ...combo, [dimName]: val });
                  }
                }
                combinations = next;
              }

              for (const combo of combinations) {
                if (Object.keys(combo).length === 0) continue;
                generated.push({ 
                  options: combo, 
                  price: optPrice, 
                  basePriceIQD: optPrice, // Explicitly set basePriceIQD
                  currency: 'IQD',
                  image: optImage || null 
                });
              }
            }
            for (const [name, values] of valuesByName.entries()) {
              const list = [...values];
              if (list.length > 0) rawOptions.push({ name, values: list });
            }
          }
          
          // Mapping of common fields to standardized names (Arabic preferred)
          const fieldMapping = {
            'size': 'المقاس',
            'sizes': 'المقاس',
            'Size': 'المقاس',
            '尺码': 'المقاس',
            'color': 'اللون',
            'colour': 'اللون',
            'Color': 'اللون',
            '颜色': 'اللون',
            '颜色分类': 'اللون',
            'اللون': 'اللون',
            'تصنيف الألوان': 'اللون',
            'المقاس': 'المقاس',
            'model': 'الموديل',
            'Model': 'الموديل',
            '型号': 'الموديل',
            'style': 'الستايل',
            'material': 'الخامة',
            'type': 'النوع'
          };

          // Try to extract from direct properties if not already present or if present but empty
          Object.entries(fieldMapping).forEach(([field, standardName]) => {
            const val = p[field];
            if (val) {
              const existingOpt = rawOptions.find(o => o.name === standardName || o.name?.toLowerCase() === field.toLowerCase());
              const newValues = String(val).split(',').map(v => cleanStr(v)).filter(v => v !== '');
              
              if (newValues.length > 0) {
                if (!existingOpt) {
                  rawOptions.push({ name: standardName, values: newValues });
                } else if (!existingOpt.values || existingOpt.values.length === 0) {
                  existingOpt.values = newValues;
                  existingOpt.name = standardName; // Standardize name
                }
              }
            }
          });

          let processedOptions = rawOptions.map((opt, optIdx) => {
            const name = cleanStr(opt.name);
            // Standardize name if it matches our mapping
            const standardName = fieldMapping[name] || name;
            return {
              id: `opt-${Date.now()}-${productIndex}-${optIdx}-${Math.floor(Math.random() * 1000)}`,
              name: standardName,
              values: (Array.isArray(opt.values) ? opt.values : [])
                      .map(v => cleanStr(String(v)))
                      .filter(v => v !== '')
            };
          }).filter(opt => opt.name !== '' && opt.values.length > 0);

          // Specifications - clean 'empty'
          let specs = cleanStr(p.specs);
          
          // Handle product_details if it's an object (user's format)
          if (!specs && p.product_details && typeof p.product_details === 'object') {
            specs = Object.entries(p.product_details)
              .map(([key, val]) => `${key}: ${val}`)
              .join('\n');
          }
          
          // If we have review summary data, and it's not already in specs, append it
          const hasReviews = (p.reviews && p.reviews.length > 0) || (p.detailedReviews && p.detailedReviews.length > 0);
          if (!specs?.includes('---REVIEW_SUMMARY---') && (p.reviewCountText || p.positiveRate || hasReviews)) {
            const isDetailedReviews = Array.isArray(p.reviews) && 
                                     p.reviews.length > 0 && 
                                     typeof p.reviews[0] === 'object';
                                     
            const reviewSummary = {
              countText: p.reviewCountText || (Array.isArray(p.reviews) ? String(p.reviews.length) : '0'),
              positiveRate: p.positiveRate || '100%',
              tags: isDetailedReviews ? [] : (p.reviews || []),
              reviews: isDetailedReviews ? p.reviews : [],
              comments: p.reviewComments || [],
              images: p.reviewImages || [],
              detailedReviews: p.detailedReviews || []
            };
            specs = (specs || '') + '\n---REVIEW_SUMMARY---\n' + JSON.stringify(reviewSummary);
          }

          // Handle multiple images - Max 200
          const rawImages = p.images || p.main_images || (p.image ? [p.image] : []);
          let imageUrls = (Array.isArray(rawImages) ? rawImages : [])
            .map(url => typeof url === 'string' ? url.replace(/[`"']/g, '').trim() : url)
            .filter(url => url && typeof url === 'string' && url.startsWith('http'));
            
          if (imageUrls.length > 200) imageUrls = imageUrls.slice(0, 200);
          
          let detailImageUrls = (Array.isArray(p.detailImages) ? p.detailImages : [])
            .map(url => typeof url === 'string' ? url.replace(/[`"']/g, '').trim() : url)
            .filter(url => url && typeof url === 'string' && url.startsWith('http'));
            
          if (detailImageUrls.length > 200) detailImageUrls = detailImageUrls.slice(0, 200);
          
          const mainImage = imageUrls.length > 0 ? imageUrls[0] : (typeof p.image === 'string' ? p.image.replace(/[`"']/g, '').trim() : '');
          
          const basePriceIQD = extractNumber(p.basePriceIQD) || extractNumber(p.base_price) || rawPrice || 0;
          
          // Try to parse dimensions and weight using robust extractor
          const productWeight = extractNumber(p.weight) || extractNumber(p.shipping_weight);
          const weightVariations = parseVariantValues(p.weight) || {};
          
          let length = extractNumber(p.length) || extractNumber(p.shipping_length);
          let width = extractNumber(p.width) || extractNumber(p.shipping_width);
          let height = extractNumber(p.height) || extractNumber(p.shipping_height);
          
          if (!length && !width && !height && p.dimensions && typeof p.dimensions === 'string') {
            const dimMatch = p.dimensions.match(/(\d+(\.\d+)?)\s*[x*×]\s*(\d+(\.\d+)?)\s*[x*×]\s*(\d+(\.\d+)?)/i);
            if (dimMatch) {
              length = parseFloat(dimMatch[1]);
              width = parseFloat(dimMatch[3]);
              height = parseFloat(dimMatch[5]);
            }
          }

          const variantsInput = Array.isArray(p.variants_data) ? p.variants_data : [];
          if (variantsInput.length === 0 && Array.isArray(p.generated_options)) {
            const generated = [];
            for (const opt of p.generated_options) {
              if (!opt || typeof opt !== 'object') continue;
              const optPrice = parsePrice(opt.price) || rawPrice;
              const optImage = cleanStr(opt.image);
              const dimensionsMap = new Map();
              for (const [rawKey, rawVal] of Object.entries(opt)) {
                const cleanedKey = cleanStr(String(rawKey));
                if (!cleanedKey) continue;
                const lower = cleanedKey.toLowerCase();
                if (lower === 'price' || lower === 'image' || lower === 'shippingmethod' || lower === 'method') continue;

                const mappedName = fieldMapping[cleanedKey] || (lower === 'color' || lower === 'colour' ? 'اللون' : (lower === 'size' || lower === 'sizes' ? 'المقاس' : cleanedKey));
                const rawValues = Array.isArray(rawVal) ? rawVal : [rawVal];
                const cleanedValues = rawValues
                  .map(v => {
                    if (v === null || v === undefined) return '';
                    if (typeof v === 'object') return cleanStr(String(v.value ?? v.name ?? JSON.stringify(v)));
                    return cleanStr(String(v));
                  })
                  .filter(Boolean);

                if (cleanedValues.length === 0) continue;
                if (!dimensionsMap.has(mappedName)) dimensionsMap.set(mappedName, []);
                dimensionsMap.get(mappedName).push(...cleanedValues);
              }

              const dimensions = [...dimensionsMap.entries()]
                .map(([k, vals]) => [k, [...new Set(vals)]])
                .filter(([, vals]) => vals.length > 0);

              if (dimensions.length === 0) continue;

              let combinations = [{}];
              for (const [dimName, dimVals] of dimensions) {
                const next = [];
                for (const combo of combinations) {
                  for (const val of dimVals) {
                    next.push({ ...combo, [dimName]: val });
                  }
                }
                combinations = next;
              }

              for (const combo of combinations) {
                if (Object.keys(combo).length === 0) continue;
                generated.push({ 
                  options: combo, 
                  price: optPrice, 
                  basePriceIQD: optPrice, // Explicitly set basePriceIQD
                  isPriceCombined: false, // Explicitly allow dynamic pricing
                  currency: 'IQD',
                  image: optImage || null 
                });
              }
            }
            variantsInput.push(...generated);
          }
          
          const optionMap = new Map();
          const normalizeOptionName = (optName) => cleanStr(optName).toLowerCase();
          const addOptionValue = (optName, optValue, optId) => {
            const name = cleanStr(optName);
            if (!name) return;
            const value = cleanStr(optValue);
            if (!value) return;
            const key = normalizeOptionName(name);
            if (!optionMap.has(key)) {
              optionMap.set(key, { id: optId || null, name, values: new Set() });
            } else if (!optionMap.get(key).id && optId) {
              optionMap.get(key).id = optId;
            }
            optionMap.get(key).values.add(value);
          };
          
          for (const opt of processedOptions) {
            if (!opt?.name) continue;
            const vals = Array.isArray(opt.values) ? opt.values : [];
            for (const v of vals) addOptionValue(opt.name, v, opt.id);
          }
          
          for (const v of variantsInput) {
            let combo = v?.options ?? v?.combination ?? {};
            if (typeof combo === 'string') {
              try { combo = JSON.parse(combo); } catch { combo = {}; }
            }
            if (!combo || typeof combo !== 'object') continue;
            for (const [k, rawVal] of Object.entries(combo)) {
              const mappedName = fieldMapping[cleanStr(k)] || k;
              const valString = typeof rawVal === 'object' && rawVal !== null
                ? (rawVal.value ?? rawVal.name ?? JSON.stringify(rawVal))
                : String(rawVal);
              addOptionValue(mappedName, valString);
            }
          }
          
          processedOptions = [...optionMap.values()]
            .map((entry, optIdx) => ({
              id: entry.id || `opt-${Date.now()}-${productIndex}-${optIdx}-${Math.floor(Math.random() * 1000)}`,
              name: entry.name,
              values: [...entry.values]
            }))
            .filter(opt => opt.name !== '' && opt.values.length > 0);

          // Return as a draft object instead of creating in database
          return {
            id: `local-${Date.now()}-${productIndex}-${Math.floor(Math.random() * 1000000)}`,
            name: name,
            chineseName: chineseName,
            description: description,
            price: price,
            shippingPriceIncluded: shippingPriceIncluded,
            estimatedShippingCost: estimatedShippingCost,
            basePriceIQD: basePriceIQD,
            image: mainImage,
            purchaseUrl: p.purchaseUrl ? p.purchaseUrl.replace(/[`"']/g, '').trim() : (p.url ? p.url.replace(/[`"']/g, '').trim() : null),
            videoUrl: p.videoUrl ? p.videoUrl.replace(/[`"']/g, '').trim() : null,
            status: 'DRAFT',
            isActive: false,
            isFeatured: !!p.isFeatured,
            isLocal: true,
            specs: specs,
            aiMetadata: aiMetadata || null,
            deliveryTime: deliveryTime || null,
            weight: productWeight,
            length: length,
            width: width,
            height: height,
            domesticShippingFee: domesticFee,
            images: imageUrls.map((url, i) => ({ url, order: i, type: 'GALLERY' })),
            detailImages: detailImageUrls.map((url, i) => ({ url, order: i, type: 'DETAIL' })),
            options: processedOptions,
            variants: variantsInput.map(v => {
              const variantRawPrice = parsePrice(v.price) || rawPrice;
              const variantBaseRaw = parsePrice(v.basePriceIQD);
              // Use explicit basePriceIQD if available (e.g. from generated options), otherwise fall back to price
              const finalBasePrice = (variantBaseRaw && variantBaseRaw > 0) ? variantBaseRaw : variantRawPrice;
              
              // Find weight for this variant if specified in variations
              let variantWeight = v.weight || null;
              if (!variantWeight && typeof v.options === 'object') {
                // Try to match any option value (e.g., "S", "XL", "Red") to weight variations
                for (const optVal of Object.values(v.options)) {
                  if (weightVariations[optVal] !== undefined) {
                    variantWeight = weightVariations[optVal];
                    break;
                  }
                }
              }

              // Respect explicit isPriceCombined flag
              // If v.currency is 'IQD' (generated), default to false unless explicitly true
              const isGenerated = v.currency === 'IQD';
              const variantIsPriceCombined = true !== undefined 
                ? (String(true) === 'true' || true === true) 
                : (isGenerated ? false : (isPriceCombined || variantRawPrice > 1000));

              let vPrice;
              if (variantIsPriceCombined) {
                 vPrice = finalBasePrice;
              } else if (!shippingPriceIncluded) {
                 const domestic = domesticFee || 0;
                 const calculatedPrice = (finalBasePrice + domestic) * 1.25;
                 vPrice = Math.ceil(calculatedPrice / 250) * 250;
              } else {
                 vPrice = calculateBulkImportPrice(finalBasePrice, domesticFee, variantWeight || productWeight, v.length || p.length, v.width || p.width, v.height || p.height, v.shippingMethod || p.shippingMethod, shippingRates);
              }

              return {
                combination: typeof v.options === 'object' ? v.options : {},
                basePriceIQD: finalBasePrice,
                price: vPrice,
                image: v.image || null,
                weight: variantWeight,
                height: v.height || null,
                length: v.length || null,
                width: v.width || null
              };
            })
          };
        } catch (err) {
          console.error(`[Bulk Import] Error processing product at index ${productIndex}:`, err);
          return null;
        }
      }));
      
      drafts.push(...batchResults.filter(p => p !== null));
      
      // Minimal delay between batches to allow the event loop to breathe - further reduced
      if (i + BATCH_SIZE < uniqueProductsToImport.length) {
        await new Promise(r => setTimeout(r, 100)); // Reduced from 200ms to 100ms
      }
    }

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_IMPORT_DRAFTS',
      { count: drafts.length },
      'PRODUCT'
    );

    res.json({ 
      success: true, 
      count: drafts.length, 
      imported: drafts.length,
      skipped: products.length - uniqueProductsToImport.length,
      failed: uniqueProductsToImport.length - drafts.length,
      drafts 
    });
  } catch (error) {
    console.error('[Bulk Import] Critical error:', error);
    res.status(500).json({ error: error.message || 'Failed to bulk import products' });
  }
});

// ADMIN: Bulk Import Reviews
app.post('/api/admin/products/bulk-import-reviews', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { reviews } = req.body;
    console.log(`[Bulk Import Reviews] Request received for ${reviews?.length} review objects`);

    if (!reviews || !Array.isArray(reviews)) {
      return res.status(400).json({ error: 'Invalid reviews data' });
    }

    let updatedCount = 0;
    const results = [];

    for (const reviewData of reviews) {
      // Find the product by purchaseUrl or name
      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { purchaseUrl: reviewData.purchaseUrl ? reviewData.purchaseUrl : undefined },
            { chineseName: reviewData.chineseName ? reviewData.chineseName : undefined },
            { name: reviewData.name ? reviewData.name : undefined }
          ].filter(Boolean)
        },
        include: { images: true },
        orderBy: { createdAt: 'desc' } // Get the most recently imported one if multiple exist
      });

      if (product) {
        // If reviews is an array of objects, it's detailed reviews
        const isDetailedReviews = Array.isArray(reviewData.reviews) && 
                                 reviewData.reviews.length > 0 && 
                                 typeof reviewData.reviews[0] === 'object';

        const summary = {
          countText: reviewData.reviewCountText || (Array.isArray(reviewData.reviews) ? String(reviewData.reviews.length) : '0'),
          positiveRate: reviewData.positiveRate || '100%',
          tags: isDetailedReviews ? [] : (reviewData.reviews || []),
          reviews: isDetailedReviews ? reviewData.reviews : [],
          comments: reviewData.reviewComments || [],
          images: reviewData.reviewImages || [],
          detailedReviews: reviewData.detailedReviews || []
        };

        // Clear existing summary if present and replace
        let newSpecs = product.specs || '';
        if (newSpecs.includes('---REVIEW_SUMMARY---')) {
          newSpecs = newSpecs.split('---REVIEW_SUMMARY---')[0].trim();
        }
        newSpecs += '\n---REVIEW_SUMMARY---\n' + JSON.stringify(summary);

        // Only publish if it already has extra photos (DETAIL images) or is already published
        const hasExtraPhotos = product.images.some(img => img.type === 'DETAIL');
        const isAlreadyPublished = product.status === 'PUBLISHED';

        await prisma.product.update({
          where: { id: product.id },
          data: { 
            specs: newSpecs,
            ...((hasExtraPhotos || isAlreadyPublished) ? { isActive: true, status: 'PUBLISHED' } : {})
          }
        });

        updatedCount++;
        results.push({ productName: product.name, status: 'success' });
      } else {
        results.push({ productName: reviewData.name, status: 'not_found' });
      }
    }

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_IMPORT_REVIEWS',
      { count: updatedCount },
      'PRODUCT'
    );

    res.json({ success: true, count: updatedCount, results });
  } catch (error) {
    console.error('[Bulk Import Reviews] Error:', error);
    res.status(500).json({ error: 'Failed to import reviews' });
  }
});

// ADMIN: Save Product Options and Variants (Step 4)
app.put('/api/admin/products/:id/options', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { id } = req.params;
    const { options = [], variants = [] } = req.body;

    // Clear existing options and variants
    await prisma.productVariant.deleteMany({ where: { productId: safeParseId(id) } });
    await prisma.productOption.deleteMany({ where: { productId: safeParseId(id) } });

    // Use original names/values without translation and clean 'empty'
    const processedOptions = options.map(opt => ({
      name: opt.name.replace(/\bempty\b/gi, '').trim(),
      values: (Array.isArray(opt.values) ? opt.values : [])
               .map(v => {
                 const val = typeof v === 'object' ? (v.value || JSON.stringify(v)) : String(v);
                 return val.replace(/\bempty\b/gi, '').trim();
               })
               .filter(v => v !== '')
    })).filter(opt => opt.name !== '' && opt.values.length > 0);

    // Create new options
    if (processedOptions && processedOptions.length > 0) {
      await prisma.productOption.createMany({
        data: processedOptions.map(opt => ({
          productId: safeParseId(id),
          name: opt.name,
          values: JSON.stringify(opt.values)
        }))
      });
    }

    // Create new variants
    if (variants && Array.isArray(variants)) {
      const product = await prisma.product.findUnique({
        where: { id: safeParseId(id) },
        select: {
          weight: true,
          length: true,
          width: true,
          height: true,
          domesticShippingFee: true
        }
      });
      const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
      const shippingRates = {
        airShippingRate: storeSettings?.airShippingRate,
        seaShippingRate: storeSettings?.seaShippingRate,
        airShippingMinFloor: storeSettings?.airShippingMinFloor
      };

      await prisma.productVariant.createMany({
        data: variants.map(v => ({
          productId: safeParseId(id),
          combination: JSON.stringify(v.combination),
          price: (() => {
            const raw = safeParseFloat(v.basePriceIQD);
            if (raw && raw > 0) {
              const domesticFee = safeParseFloat(product?.domesticShippingFee) || 0;
              const vWeight = safeParseFloat(v.weight) ?? product?.weight;
              const vLength = safeParseFloat(v.length) ?? product?.length;
              const vWidth = safeParseFloat(v.width) ?? product?.width;
              const vHeight = safeParseFloat(v.height) ?? product?.height;
              return calculateBulkImportPrice(raw, domesticFee, vWeight, vLength, vWidth, vHeight, null, shippingRates);
            }
            return safeParseFloat(v.price) || 0;
          })(),
          weight: v.weight ? parseFloat(v.weight) : null,
          height: v.height ? parseFloat(v.height) : null,
          length: v.length ? parseFloat(v.length) : null,
          width: v.width ? parseFloat(v.width) : null,
          image: v.image,
        }))
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Save options error:', error);
    res.status(500).json({ error: 'Failed to save options and variants' });
  }
});

app.put('/api/admin/products/update-price', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { productId, variantId, newPrice, orderItemId } = req.body;
    console.log('[UpdatePrice] Request:', { productId, variantId, newPrice, orderItemId });

    const parsedProductId = safeParseId(productId);
    const parsedVariantId = (variantId !== undefined && variantId !== null && variantId !== '') ? safeParseId(variantId) : null;

    // 1. Get current product and its variants
    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      include: { variants: { select: productVariantSelect } }
    });

    if (!product) {
      console.error('[UpdatePrice] Product not found:', parsedProductId);
      return res.status(404).json({ error: 'Product not found' });
    }

    let oldPrice;
    if (parsedVariantId) {
      const targetVariant = product.variants.find(v => v.id === parsedVariantId);
      if (!targetVariant) {
        console.error('[UpdatePrice] Variant not found in product variants:', parsedVariantId);
        const v = await prisma.productVariant.findUnique({ where: { id: parsedVariantId }, select: productVariantSelect });
        if (!v) return res.status(404).json({ error: 'Variant not found' });
        oldPrice = v.price;
      } else {
        oldPrice = targetVariant.price;
      }
    } else {
      oldPrice = product.price;
    }

    console.log('[UpdatePrice] Found old price:', oldPrice);

    const roundedNewPrice = Math.ceil(newPrice / 250) * 250;

    // 2. Update the specific variant OR product first
    if (parsedVariantId) {
      await prisma.productVariant.update({
        where: { id: parsedVariantId },
        data: { price: roundedNewPrice }
      });
    } else {
      await prisma.product.update({
        where: { id: parsedProductId },
        data: { price: roundedNewPrice }
      });
    }

    // 3. Update all other variants with the same old price
    const priceTolerance = 0.01;
    await prisma.productVariant.updateMany({
      where: {
        productId: parsedProductId,
        price: {
          gte: oldPrice - priceTolerance,
          lte: oldPrice + priceTolerance
        },
        NOT: parsedVariantId ? { id: parsedVariantId } : undefined
      },
      data: { price: roundedNewPrice }
    });

    // 4. Update product base price if it matches the old price
    if (parsedVariantId && Math.abs(product.price - oldPrice) < priceTolerance) {
      await prisma.product.update({
        where: { id: parsedProductId },
        data: { price: roundedNewPrice }
      });
    }

    // 5. Update the specific OrderItem if provided and recalculate total
    if (orderItemId) {
      const updatedOrderItem = await prisma.orderItem.update({
        where: { id: safeParseId(orderItemId) },
        data: { price: roundedNewPrice },
        include: { order: true }
      });

      // Recalculate order total
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId: updatedOrderItem.orderId }
      });
      
      const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const total = subtotal + (updatedOrderItem.order.internationalShippingFee || 0);
      
      await prisma.order.update({
        where: { id: updatedOrderItem.orderId },
        data: { total }
      });
    }

    console.log('[UpdatePrice] Successfully updated prices to:', newPrice);
    res.json({ success: true, message: 'Prices updated successfully' });
  } catch (error) {
    console.error('Error updating product prices:', error);
    res.status(500).json({ error: 'Failed to update product prices' });
  }
});

app.post('/api/admin/products/bulk-ai-metadata', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { products, overwrite = false } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }

    const cleanUrl = (u) => (typeof u === 'string' ? u.replace(/[`"']/g, '').trim() : '');
    const parseJsonObject = (val) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
          return null;
        }
      }
      return null;
    };
    const extractOfferId = (u) => {
      if (!u) return null;
      const match = String(u).match(/[?&]offerId=(\d+)/i);
      return match ? match[1] : null;
    };

    const results = {
      total: products.length,
      matched: 0,
      updated: 0,
      skipped: 0,
      notFound: 0
    };

    for (const p of products) {
      const purchaseUrlRaw = p?.purchaseUrl ?? p?.url ?? '';
      const purchaseUrl = cleanUrl(purchaseUrlRaw);
      const offerId = extractOfferId(purchaseUrl) || extractOfferId(purchaseUrlRaw);
      const aiMetadata = parseJsonObject(p?.aiMetadata) || parseJsonObject(p?.marketing_metadata);

      if (!purchaseUrl || !aiMetadata) {
        results.skipped++;
        continue;
      }

      const product = await prisma.product.findFirst({
        where: {
          OR: [
            { purchaseUrl: purchaseUrl },
            { purchaseUrl: String(purchaseUrlRaw) },
            ...(offerId ? [{ purchaseUrl: { contains: `offerId=${offerId}` } }] : [])
          ]
        },
        select: { id: true, aiMetadata: true, purchaseUrl: true }
      });

      if (!product) {
        results.notFound++;
        continue;
      }

      results.matched++;

      const alreadyHasMetadata = product.aiMetadata !== null && product.aiMetadata !== undefined;
      if (alreadyHasMetadata && !overwrite) {
        results.skipped++;
        continue;
      }

      await prisma.product.update({
        where: { id: product.id },
        data: {
          aiMetadata,
          purchaseUrl: purchaseUrl
        }
      });

      results.updated++;
    }

    return res.json({ success: true, results });
  } catch (error) {
    console.error('[Bulk AI Metadata] Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to update aiMetadata' });
  }
});

app.post('/api/admin/products/queue-missing-embeddings', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const rawLimit = req.body?.limit;
    const limit = Math.min(1000, Math.max(1, Number(rawLimit ?? 200) || 200));
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Product" WHERE embedding IS NULL ORDER BY id DESC LIMIT ${limit}`
    );
    for (const row of rows || []) {
      enqueueEmbeddingJob(row.id);
      enqueueImageEmbeddingJob(row.id);
    }
    res.json({ success: true, queued: (rows || []).length, running: embeddingJobRunning, queueSize: embeddingJobQueue.length });
  } catch (error) {
    console.error('[Queue Missing Embeddings] Error:', error);
    res.status(500).json({ error: 'Failed to queue embeddings' });
  }
});

// ADMIN: Bulk Publish (Step 5)
app.post('/api/admin/products/bulk-publish', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const rawIds = req.body.ids;
    if (!Array.isArray(rawIds)) return res.status(400).json({ error: 'Invalid IDs' });
    
    // Ensure all IDs are numbers (Prisma requires Int for ID field)
    const ids = rawIds.map(id => safeParseId(id)).filter(id => typeof id === 'number');

    if (ids.length === 0) {
      return res.json({ success: true });
    }

    await prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { 
        status: 'PUBLISHED',
        isActive: true
      }
    });

    ids.forEach((id) => enqueueEmbeddingJob(id));
    ids.forEach((id) => enqueueImageEmbeddingJob(id));

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_PUBLISH_PRODUCTS',
      { ids },
      'PRODUCT'
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Bulk publish error:', error);
    res.status(500).json({ error: 'Failed to bulk publish products' });
  }
});

// ADMIN: Bulk Create Products (Optimized for publishing local drafts)
app.post('/api/admin/products/bulk-create', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { products } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }

    const createdResults = [];
    
    // 1. Process images SEQUENTIALLY to avoid timeouts/memory issues during bulk
    const processedProducts = [];
    console.log(`Starting bulk processing for ${products.length} products...`);
    
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const product = { ...p };
      
      if (product.image && (product.image.startsWith('data:') || product.image.length > 1000)) {
        try {
          console.log(`Processing image for product ${i + 1}/${products.length}: ${product.name}`);
          product.image = await convertToWebP(product.image);
        } catch (err) {
          console.error(`Failed to convert image for product ${product.name}:`, err);
          // Keep original image if conversion fails
        }
      }
      
      // Also process secondary images if they are base64
      if (product.images && Array.isArray(product.images)) {
        const processedImages = [];
        for (let j = 0; j < product.images.length; j++) {
          let img = product.images[j];
          let url = typeof img === 'string' ? img : img?.url;
          
          if (url && (url.startsWith('data:') || url.length > 1000)) {
            try {
              url = await convertToWebP(url);
              if (typeof img === 'string') {
                img = url;
              } else {
                img.url = url;
              }
            } catch (err) {
              console.error(`Failed to convert secondary image ${j} for ${product.name}:`, err);
            }
          }
          processedImages.push(img);
        }
        product.images = processedImages;
      }
      
      processedProducts.push(product);
    }

    console.log('Images processed. Starting database transaction...');

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    // 2. We process DB operations in a transaction to ensure data consistency
    // Added explicit timeout for large bulk operations (60 seconds)
    await prisma.$transaction(async (tx) => {
      for (const p of processedProducts) {
        // Exclude local-only fields and relational fields
        let { 
          id, 
          productId,
          isLocal, 
          createdAt, 
          updatedAt, 
          options = [], 
          variants = [], 
          images = [], 
          ...rawProductData 
        } = p;

        // Map alias fields from scraper payloads
        if (!rawProductData.name && rawProductData.product_name) rawProductData.name = rawProductData.product_name;
        if (!rawProductData.price && rawProductData.general_price) rawProductData.price = rawProductData.general_price;
        if (!rawProductData.purchaseUrl && rawProductData.url) rawProductData.purchaseUrl = rawProductData.url;
        // Fix: Restore domesticShippingFee if it was destructured out, or map from snake_case
        if (!rawProductData.domesticShippingFee) {
          if (domesticShippingFee) rawProductData.domesticShippingFee = domesticShippingFee;
          else if (rawProductData.domestic_shipping) rawProductData.domesticShippingFee = rawProductData.domestic_shipping;
        }

        const extractGeneratedOptionEntries = (opt) => {
          const out = [];
          if (!opt || typeof opt !== 'object') return out;
          
          const metaKeys = new Set(['price', 'image', 'shippingmethod', 'method', 'stock', 'weight', 'sku', 'skuid', 'specid']);
          
          const pushEntry = (rawKey, rawVal) => {
            const cleanedKey = cleanStr(String(rawKey));
            if (!cleanedKey) return;
            const lower = cleanedKey.toLowerCase();
            if (metaKeys.has(lower)) return;
            
            // Recurse into nested objects like "combination" or "options"
            if (lower === 'options' || lower === 'combination' || lower === 'variant' || lower === 'variants') {
               if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
                 for (const [k, v] of Object.entries(rawVal)) pushEntry(k, v);
                 return;
               }
            }
            
            out.push([cleanedKey, rawVal]);
          };
          
          for (const [k, v] of Object.entries(opt)) pushEntry(k, v);
          return out;
        };

        // Handle generated_options - Prioritize it if available as it contains detailed pricing/combinations
        if (Array.isArray(rawProductData.generated_options) && rawProductData.generated_options.length > 0) {
          const valuesByName = new Map();
          const genVariants = [];
          
          for (const opt of rawProductData.generated_options) {
            if (!opt || typeof opt !== 'object') continue;
            
            const optPrice = safeParseFloat(opt.price);
            const optImage = cleanStr(opt.image);
            const combination = {};
            
            for (const [cleanedKey, rawVal] of extractGeneratedOptionEntries(opt)) {
            const lower = cleanedKey.toLowerCase();
            const mappedName = (() => {
              // Force common English terms to Arabic
              if (lower.includes('color') || lower.includes('colour') || lower === 'yanse') return 'اللون';
              if (lower.includes('size') || lower.includes('chima')) return 'المقاس';
              
              if (lower === 'model' || lower === 'models') return 'المقاس';
              if (lower === 'style' || lower === 'styles') return 'الستايل';
              
              return fieldMapping[cleanedKey] || fieldMapping[lower] || cleanedKey;
            })();
              
              const rawValues = Array.isArray(rawVal) ? rawVal : [rawVal];
              const cleanedValues = rawValues.map(v => {
                 if (v === null || v === undefined) return '';
                 if (typeof v === 'object') return cleanStr(String(v.value ?? v.name ?? JSON.stringify(v)));
                 return cleanStr(String(v));
              }).filter(Boolean);
              
              if (cleanedValues.length > 0) {
                if (!valuesByName.has(mappedName)) valuesByName.set(mappedName, new Set());
                for (const cv of cleanedValues) valuesByName.get(mappedName).add(cv);
                
                // For variant combination, take the first value
                combination[mappedName] = cleanedValues[0];
              }
            }
            
            if (Object.keys(combination).length > 0) {
              const rmbPrice = (optPrice && optPrice > 0) ? optPrice : (safeParseFloat(opt.price) || 0);
            
            // Check for explicit currency/unit instruction
            // User guarantees input is IQD. No x200 conversion.
            const iqdBase = rmbPrice;
            
            console.log(`[DEBUG V4 GenVariant] optPriceRaw=${opt.price}, parsed=${optPrice}, iqdBase=${iqdBase}`);

            // Calculate initial price using product dimensions as fallback
              // This ensures the stored price is reasonably accurate even before user interaction
              const initialPrice = calculateBulkImportPrice(
                iqdBase, 
                rawProductData.domesticShippingFee || 0,
                rawProductData.weight,
                rawProductData.length,
                rawProductData.width,
                rawProductData.height,
                null, // Auto-detect Air/Sea based on weight
                shippingRates
              );
              
              // Ensure basePriceIQD is never null if we have a price
              const finalBasePrice = iqdBase > 0 ? iqdBase : (initialPrice > 0 ? initialPrice : 0);

              genVariants.push({
                combination,
                price: initialPrice,
                image: optImage, // Allow dynamic pricing based on shipping method
                basePriceIQD: finalBasePrice, // Always store IQD value in basePriceIQD for consistency with frontend logic
                currency: 'IQD' // Explicitly flag as IQD so variants loop doesn't double-convert
              });
            }
          }
          
          // Populate options
          if (valuesByName.size > 0) {
            options = [];
            for (const [name, values] of valuesByName.entries()) {
              options.push({ name, values: [...values] });
            }
          }
          
          // Populate variants
          if (genVariants.length > 0) {
            variants = genVariants;
          }
        }
        
        const domesticFee = safeParseFloat(rawProductData.domesticShippingFee) || 0;
        // Determine if price is combined using explicit flag
        const isPriceCombined = true;
        
        const parsedAiMetadata = (() => {
          const candidate = rawProductData.aiMetadata ?? rawProductData.marketing_metadata;
          if (!candidate) return null;
          if (typeof candidate === 'object') return candidate;
          if (typeof candidate === 'string') {
            try {
              const parsed = JSON.parse(candidate);
              return parsed && typeof parsed === 'object' ? parsed : null;
            } catch {
              return null;
            }
          }
          return null;
        })();
        
        // Use the new calculation logic with 90% markup for air items
        const rawPrice = safeParseFloat(rawProductData.price) || 0;
        
        console.log(`[DEBUG] Pricing calc for ${rawProductData.name}: rawPrice=${rawPrice}, domestic=${domesticFee}=${isPriceCombined}, weight=${rawProductData.weight}`);

        // Determine if input is IQD or RMB
        // User guarantees input is IQD. No x200 conversion.
        const iqdPrice = rawPrice;

        const calculatedPrice = isPriceCombined ? rawPrice : calculateBulkImportPrice(iqdPrice, domesticFee, rawProductData.weight, rawProductData.length, rawProductData.width, rawProductData.height, rawProductData.shippingMethod, shippingRates);

        // Skip products with 0 price
        if (calculatedPrice <= 0 || rawPrice <= 0) {
          console.log(`[Bulk Create] Skipping product with 0 price: ${rawProductData.name || 'Unnamed'}`);
          continue;
        }

        // Determine final basePriceIQD in IQD (User confirmed input is IQD)
        let finalBasePriceRMB = safeParseFloat(rawProductData.basePriceIQD);
        if (!finalBasePriceRMB) {
           finalBasePriceRMB = rawPrice;
        }
        
        console.log(`[DEBUG] BasePriceRMB calc: raw=${rawProductData.basePriceIQD}, final=${finalBasePriceRMB} (Force IQD)`);

        // Pick only valid Prisma fields to avoid "Unknown arg" errors
        const productData = {
          name: rawProductData.name || 'Untitled Product',
          chineseName: rawProductData.chineseName || null,
          description: rawProductData.description || '',
          price: calculatedPrice,
          basePriceIQD: finalBasePriceRMB,
          image: rawProductData.image || (images && images[0]) || '',
          purchaseUrl: rawProductData.purchaseUrl || null,
          videoUrl: rawProductData.videoUrl || null,
          status: 'PUBLISHED',
          isFeatured: rawProductData.isFeatured || false,
          isActive: rawProductData.isActive !== undefined ? rawProductData.isActive : true,
          specs: rawProductData.specs || '',
          storeEvaluation: rawProductData.storeEvaluation || null,
          reviewsCountShown: rawProductData.reviewsCountShown || null,
          weight: safeParseFloat(rawProductData.weight),
          length: safeParseFloat(rawProductData.length),
          width: safeParseFloat(rawProductData.width),
          height: safeParseFloat(rawProductData.height),
          domesticShippingFee: domesticFee,
          aiMetadata: parsedAiMetadata,
          deliveryTime: rawProductData.deliveryTime || rawProductData.delivery_time || rawProductData.Delivery_time || null
        };
        
        // Create the product
        const product = await tx.product.create({
          data: productData
        });

        // Create secondary images if they exist
        if (images && Array.isArray(images) && images.length > 0) {
          const processedImages = images.map((img, index) => {
            const url = typeof img === 'string' ? img : img.url;
            const type = typeof img === 'object' ? (img.type || 'GALLERY') : 'GALLERY';
            const order = typeof img === 'object' ? (img.order !== undefined ? img.order : index) : index;
            return { url, type, order };
          }).filter(img => img.url && typeof img.url === 'string' && img.url.length > 0);

          if (processedImages.length > 0) {
            await tx.productImage.createMany({
              data: processedImages.map(img => ({
                productId: product.id,
                url: img.url,
                order: img.order,
                type: img.type
              }))
            });
          }
        }

        const optionMap = new Map();
        const normalizeOptionName = (optName) => {
          const cleaned = cleanStr(optName);
          const lower = cleaned.toLowerCase();
          
          if (lower.includes('color') || lower.includes('colour')) return 'اللون';
          if (lower.includes('size') || lower.includes('chima')) return 'المقاس';
          
          if (lower === 'model' || lower === 'models') return 'المقاس';
          
          return fieldMapping[cleaned] || fieldMapping[lower] || cleaned;
        };
        const addOptionValue = (optName, optValue) => {
          const name = cleanStr(optName);
          if (!name) return;
          const value = cleanStr(optValue);
          if (!value) return;
          const key = normalizeOptionName(name);
          // Use 'key' (normalized name) as the display name to ensure consistency and Arabic output
          if (!optionMap.has(key)) optionMap.set(key, { name: key, values: new Set() });
          optionMap.get(key).values.add(value);
        };

        if (options && Array.isArray(options)) {
          for (const opt of options) {
            const optName = cleanStr(opt?.name);
            if (!optName) continue;
            let vals = opt?.values;
            if (typeof vals === 'string') {
              try { vals = JSON.parse(vals); } catch { vals = []; }
            }
            if (!Array.isArray(vals)) vals = [];
            for (const v of vals) addOptionValue(optName, String(v));
          }
        }

        const normalizeVariantKey = (rawKey) => {
          const cleaned = cleanStr(String(rawKey));
          const lower = cleaned.toLowerCase();
          
          if (lower.includes('color') || lower.includes('colour')) return 'اللون';
          if (lower.includes('size') || lower.includes('chima')) return 'المقاس';
          
          if (lower === 'model' || lower === 'models') return 'المقاس';
          
          if (fieldMapping[cleaned]) return fieldMapping[cleaned];
          if (fieldMapping[lower]) return fieldMapping[lower];
          return cleaned;
        };

        if (variants && Array.isArray(variants)) {
          for (const v of variants) {
            let combo = v?.combination ?? v?.options ?? v?.variant ?? {};
            if (typeof combo === 'string') {
              try { combo = JSON.parse(combo); } catch { combo = {}; }
            }
            if (!combo || typeof combo !== 'object' || Array.isArray(combo)) continue;
            for (const [k, rawVal] of Object.entries(combo)) {
              const valString = typeof rawVal === 'object' && rawVal !== null
                ? (rawVal.value ?? rawVal.name ?? JSON.stringify(rawVal))
                : String(rawVal);
              addOptionValue(normalizeVariantKey(k), valString);
            }
          }
        }

        const normalizedOptions = [...optionMap.values()]
          .map((entry) => ({ name: entry.name, values: [...entry.values] }))
          .filter(opt => opt.name !== '' && opt.values.length > 0);

        if (normalizedOptions.length > 0) {
          await tx.productOption.createMany({
            data: normalizedOptions.map(opt => ({
              productId: product.id,
              name: opt.name,
              values: JSON.stringify(opt.values)
            }))
          });
        }

        // Create variants
        if (variants && Array.isArray(variants) && variants.length > 0) {
          const validVariants = variants.filter(v => v && (v.combination || v.options));
          if (validVariants.length > 0) {
            await tx.productVariant.createMany({
              data: validVariants.map(v => {
                const variantRawPrice = safeParseFloat(v.price) || 0;
                const variantBaseRaw = safeParseFloat(v.basePriceIQD);
                const rawVal = (variantBaseRaw && variantBaseRaw > 0) ? variantBaseRaw : variantRawPrice;
                
                // User guarantees input is IQD. No x200 conversion.
                const iqdBase = rawVal;
                
                // FORCE isPriceCombined to FALSE if this is a generated variant (currency='IQD')
                // This overrides any accidental inheritance from the main product
                // Also ensure we handle the string/boolean type mismatch correctly
                const isGeneratedVariant = v.currency === 'IQD';
                const variantIsPriceCombined = isGeneratedVariant 
                  ? false 
                  : (true !== undefined 
                      ? (String(true) === 'true' || true === true) 
                      : (isPriceCombined));

                console.log(`[DEBUG V4 Variant] price=${v.price}, iqdBase=${iqdBase}, isCombined=${variantIsPriceCombined} (Was: ${isPriceCombined})`);

                // FORCE basePriceIQD to be present if iqdBase is present
                // This handles the case where safeParseFloat might have returned null/0 but we have a rawVal
                const finalVariantBasePrice = iqdBase > 0 ? iqdBase : (safeParseFloat(product.basePriceIQD) || rawVal || 0);

                // Use safeParseFloat(product.price) as fallback, not product.price directly
                const fallbackPrice = safeParseFloat(product.price) || 0;

                const finalVariantPrice = (() => {
                  // If base price is valid, use it for calculation
                  if (finalVariantBasePrice && finalVariantBasePrice > 0) {
                     // If explicit instruction to combine price, return base
                     if (variantIsPriceCombined) return finalVariantBasePrice;
                     
                     // Otherwise calculate dynamic price
                     return calculateBulkImportPrice(
                        finalVariantBasePrice, 
                        domesticFee, 
                        v.weight || rawProductData.weight, 
                        v.length || rawProductData.length, 
                        v.width || rawProductData.width, 
                        v.height || rawProductData.height, 
                        v.shippingMethod || rawProductData.shippingMethod, 
                        shippingRates
                     );
                  }
                  
                  // Fallback to product price if no variant base price
                  return fallbackPrice;
                })();

                return {
                  productId: product.id,
                  combination: (() => {
                    let combo = v.combination ?? v.options ?? {};
                    if (typeof combo === 'string') {
                      try { combo = JSON.parse(combo); } catch { return combo; }
                    }
                    if (!combo || typeof combo !== 'object' || Array.isArray(combo)) return '{}';
                    const normalizedCombo = {};
                    for (const [k, rawVal] of Object.entries(combo)) {
                      const valString = typeof rawVal === 'object' && rawVal !== null
                        ? (rawVal.value ?? rawVal.name ?? JSON.stringify(rawVal))
                        : String(rawVal);
                      normalizedCombo[normalizeVariantKey(k)] = cleanStr(valString);
                    }
                    return JSON.stringify(normalizedCombo);
                  })(),
                  price: finalVariantPrice,
                  weight: safeParseFloat(v.weight),
                  height: safeParseFloat(v.height),
                  length: safeParseFloat(v.length),
                  width: safeParseFloat(v.width),
                  basePriceIQD: finalVariantBasePrice,
                  image: v.image || product.image || ''
                };
              })
            });
          }
        }

        createdResults.push(product);
      }
    }, {
      timeout: 60000 
    });

    await logActivity(
      req.user.id,
      req.user.name,
      'BULK_CREATE_PRODUCTS',
      { count: products.length },
      'PRODUCT'
    );

    res.json({ success: true, count: createdResults.length, products: createdResults });

    createdResults.forEach((product) => enqueueEmbeddingJob(product.id));
    createdResults.forEach((product) => enqueueImageEmbeddingJob(product.id));
  } catch (error) {
    console.error('Detailed Bulk Create Error:', error);
    res.status(500).json({ 
      error: 'Failed to bulk create products', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[DEBUG] Fetching product ${id}`);
    const product = await prisma.product.findUnique({
      where: { id: safeParseId(id) },
      select: {
        id: true,
        name: true,
        price: true,
        basePriceIQD: true,
        image: true,
        purchaseUrl: true,
        status: true,
        isFeatured: true,
        featuredSearchSentences: true,
        isActive: true,
        specs: true,
        createdAt: true,
        updatedAt: true,
        aiMetadata: true,
        scrapedReviews: true,
        generated_options: true,
        domesticShippingFee: true,
        isAirRestricted: true,
        deliveryTime: true,
        options: true,
        variants: { select: productVariantSelect },
        images: {
          orderBy: {
            order: 'asc'
          }
        },
        reviews: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    
    const aiMetadata = parseAiMetadata(product.aiMetadata);
    const description = cleanStr(
      aiMetadata?.translatedDescription
        ?? aiMetadata?.translatedDesc
        ?? aiMetadata?.descriptionAr
        ?? aiMetadata?.description_ar
        ?? aiMetadata?.product_description
        ?? aiMetadata?.description
        ?? ''
    );
    const enrichedProduct = {
      ...product,
      aiMetadata,
      neworold: extractNewOrOld(aiMetadata),
      description
    };

    console.log('[DEBUG] Product found, applying pricing...');
    try {
        const processed = applyDynamicPricingToProduct(enrichedProduct, null);
        console.log('[DEBUG] Pricing applied successfully');
        res.json(processed);
    } catch (pricingError) {
        console.error('[DEBUG] Pricing error:', pricingError);
        throw pricingError;
    }
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Check if user has purchased a product
app.get('/api/products/:id/check-purchase', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const orderItem = await prisma.orderItem.findFirst({
      where: {
        productId: safeParseId(id),
        order: {
          userId: userId,
          // We allow reviews if the order is COMPLETED or SHIPPED or DELIVERED
          status: { in: ['COMPLETED', 'SHIPPED', 'DELIVERED'] }
        }
      }
    });

    res.json({ purchased: !!orderItem });
  } catch (error) {
    console.error('Error checking purchase status:', error);
    res.json({ purchased: false }); // Fallback to false on error
  }
});

app.get('/api/admin/search/reindex-status', authenticateToken, isAdmin, hasPermission('manage_products'), async (_req, res) => {
  return res.json({
    ok: true,
    engine: 'meili',
    ...getMeiliReindexStatus()
  });
});

app.post('/api/admin/search/reindex', authenticateToken, isAdmin, hasPermission('manage_products'), async (_req, res) => {
  try {
    const shouldReset = String(_req.query.reset || _req.body?.reset || '').trim() === '1'
      || _req.body?.reset === true;
    const started = startMeiliReindexInBackground({ reset: shouldReset });
    return res.json({
      ok: true,
      engine: 'meili',
      started,
      reset: shouldReset,
      ...getMeiliReindexStatus()
    });
  } catch (error) {
    console.error('[Meili] reindex failed to start:', error);
    return res.status(503).json({
      error: 'Meilisearch reindex failed to start',
      details: error?.message || 'Unknown error'
    });
  }
});

app.get('/api/search', async (req, res) => {
  const forcePerf = String(req.query.perf || req.headers['x-perf-log'] || '').trim() === '1';
  const perf = createPerfLog('search', ENABLE_SEARCH_PERF_LOGS || forcePerf);
  perf.log('start', { query: req.query });
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const maxPrice = req.query.maxPrice ? Number.parseFloat(String(req.query.maxPrice)) : null;
    const condition = String(req.query.condition || '').trim();

    if (!q) {
      perf.log('empty_query');
      return res.json({ products: [], total: 0, page, totalPages: 0, hasMore: false, engine: 'meili' });
    }

    const normalizedQuery = normalizeSearchText(q);
    const expandedSearchTerms = expandSearchTermsForIraqiSlang(q);
    const keywordSearchTerms = buildKeywordSearchTerms(q);
    const exactFeaturedQueryVariants = buildExactFeaturedSentenceVariants(q);
    const productSelect = {
      id: true,
      name: true,
      price: true,
      basePriceIQD: true,
      image: true,
      aiMetadata: true,
      neworold: true,
      isFeatured: true,
      featuredSearchSentences: true,
      domesticShippingFee: true,
      deliveryTime: true,
      updatedAt: true,
      variants: {
        select: {
          id: true,
          combination: true,
          price: true,
          basePriceIQD: true,
          image: true
        }
      }
    };

    if (!cachedStoreSettings || (Date.now() - cachedStoreSettingsTime > 60000)) {
      try {
        cachedStoreSettings = await withDbRetry(() => prisma.storeSettings.findUnique({ where: { id: 1 } }));
        cachedStoreSettingsTime = Date.now();
      } catch (settingsError) {
        if (!isDbConnectionError(settingsError)) {
          throw settingsError;
        }
        if (!cachedStoreSettings) {
          cachedStoreSettings = null;
          cachedStoreSettingsTime = Date.now();
        }
      }
    }
    const storeSettings = cachedStoreSettings;
    perf.log('store_settings_ready', { cacheAgeMs: Date.now() - cachedStoreSettingsTime });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };
    const featuredWhere = {
      status: 'PUBLISHED',
      isActive: true,
      featuredSearchSentences: {
        isEmpty: false
      },
      ...(Number.isFinite(maxPrice) && maxPrice > 0 ? { price: { lte: maxPrice } } : {}),
      ...(condition === 'new'
        ? { neworold: true }
        : condition === 'used'
          ? { OR: [{ neworold: false }, { neworold: null }] }
          : {})
    };
    const featuredCandidates = await withDbRetry(() => prisma.product.findMany({
      where: featuredWhere,
      select: productSelect
    }));
    const featuredMatchedProducts = featuredCandidates
      .filter((product) => isFeaturedMatchForQuery(product, exactFeaturedQueryVariants, condition))
      .sort((a, b) => {
        const aUpdated = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bUpdated = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bUpdated - aUpdated;
      });
    const featuredMatchedIdSet = new Set(featuredMatchedProducts.map((product) => Number(product.id)).filter((id) => Number.isFinite(id)));
    perf.log('featured_matches_ready', { featuredMatches: featuredMatchedProducts.length });

    try {
      const meiliSetupStartedAt = Date.now();
      const index = await getMeiliSearchIndex();
      perf.log('meili_index_ready', { setupMs: Date.now() - meiliSetupStartedAt });
      const filters = ['status = PUBLISHED', 'isActive = true'];
      if (Number.isFinite(maxPrice) && maxPrice > 0) {
        filters.push(`price <= ${maxPrice}`);
      }
      if (condition === 'new') {
        filters.push('neworold = true');
      } else if (condition === 'used') {
        filters.push('(neworold = false OR neworold IS NULL)');
      }

      const meiliSearchStartedAt = Date.now();
      const meiliQuery = expandedSearchTerms.join(' ').trim() || normalizedQuery || q;
      const meiliCandidateLimit = Math.min(1000, Math.max(limit * 5, offset + limit + 100));
      const searchResult = await index.search(meiliQuery, {
        limit: meiliCandidateLimit,
        offset: 0,
        filter: filters
      });
      perf.log('meili_search_done', {
        meiliMs: Date.now() - meiliSearchStartedAt,
        estimatedTotalHits: Number(searchResult?.estimatedTotalHits || 0),
        candidateLimit: meiliCandidateLimit
      });

      const hitIds = Array.isArray(searchResult?.hits)
        ? searchResult.hits.map((hit) => Number(hit?.id)).filter((id) => Number.isFinite(id))
        : [];
      perf.log('meili_hits_ready', { hitIdsCount: hitIds.length });

      const dbFetchStartedAt = Date.now();
      const productsFromDb = await withDbRetry(() => prisma.product.findMany({
        where: {
          id: { in: hitIds },
          status: 'PUBLISHED',
          isActive: true
        },
        select: productSelect
      }));
      perf.log('db_fetch_for_meili_done', { dbMs: Date.now() - dbFetchStartedAt, productsCount: productsFromDb.length });

      const rankIndex = new Map(hitIds.map((id, indexPosition) => [id, indexPosition]));
      const rankedProducts = productsFromDb
        .slice()
        .sort((a, b) => {
          const aFeaturedMatch = isFeaturedMatchForQuery(a, exactFeaturedQueryVariants, condition);
          const bFeaturedMatch = isFeaturedMatchForQuery(b, exactFeaturedQueryVariants, condition);
          const featuredMatchDiff = Number(bFeaturedMatch) - Number(aFeaturedMatch);
          if (featuredMatchDiff !== 0) return featuredMatchDiff;
          return (rankIndex.get(a.id) ?? 999999) - (rankIndex.get(b.id) ?? 999999);
        })
        .map((product) => {
          const aiMetadata = parseAiMetadata(product.aiMetadata);
          const processed = applyDynamicPricingToProduct(product, shippingRates);
          const isRealBrand = typeof aiMetadata?.isRealBrand === 'boolean' ? aiMetadata.isRealBrand : null;
          const neworold = (product.neworold !== null && product.neworold !== undefined)
            ? product.neworold
            : extractNewOrOld(aiMetadata);
          return { ...processed, aiMetadata, isRealBrand, neworold };
        });
      const conditionFilteredProducts = condition === 'new'
        ? rankedProducts.filter((product) => inferProductCondition(product) !== false)
        : condition === 'used'
          ? rankedProducts.filter((product) => inferProductCondition(product) !== true)
          : rankedProducts;
      const mergedProducts = [];
      const mergedSeenIds = new Set();
      for (const product of featuredMatchedProducts) {
        const id = Number(product?.id);
        if (!Number.isFinite(id) || mergedSeenIds.has(id)) continue;
        mergedSeenIds.add(id);
        mergedProducts.push(product);
      }
      for (const product of conditionFilteredProducts) {
        const id = Number(product?.id);
        if (!Number.isFinite(id) || mergedSeenIds.has(id)) continue;
        mergedSeenIds.add(id);
        mergedProducts.push(product);
      }
      const pagedProducts = mergedProducts.slice(offset, offset + limit);
      const additionalFeaturedCount = Array.from(featuredMatchedIdSet).filter((id) => !rankIndex.has(id)).length;
      const estimatedTotal = Number(searchResult?.estimatedTotalHits || 0) + additionalFeaturedCount;
      const total = Math.max(estimatedTotal, mergedProducts.length);
      perf.log('response_sent', { engine: 'meili', returned: pagedProducts.length, total });
      return res.json({
        products: pagedProducts,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + pagedProducts.length < total,
        engine: 'meili'
      });
    } catch (meiliError) {
      perf.log('meili_fallback', { reason: meiliError?.message || String(meiliError) });
      console.warn('[Meili] search fallback to db:', meiliError?.message || meiliError);
      const searchTerms = Array.from(new Set([
        ...expandedSearchTerms,
        q,
        normalizedQuery
      ].map((v) => String(v || '').trim()).filter(Boolean)));
      const andFilters = [];
      if (searchTerms.length > 0) {
        andFilters.push({
          OR: [
            ...searchTerms.map((term) => ({ name: { contains: term, mode: 'insensitive' } })),
            ...(keywordSearchTerms.length > 0 ? [{ keywords: { hasSome: keywordSearchTerms } }] : [])
          ]
        });
      }
      if (Number.isFinite(maxPrice) && maxPrice > 0) {
        andFilters.push({ price: { lte: maxPrice } });
      }
      if (condition === 'new') {
        andFilters.push({ neworold: true });
      } else if (condition === 'used') {
        andFilters.push({ OR: [{ neworold: false }, { neworold: null }] });
      }

      const where = {
        status: 'PUBLISHED',
        isActive: true,
        ...(andFilters.length > 0 ? { AND: andFilters } : {})
      };

      const dbCountStartedAt = Date.now();
      const total = await withDbRetry(() => prisma.product.count({ where }));
      perf.log('db_fallback_count_done', { dbCountMs: Date.now() - dbCountStartedAt, total });
      if (!total) {
        perf.log('response_sent', { engine: 'db', returned: 0, total: 0 });
        return res.json({ products: [], total: 0, page, totalPages: 0, hasMore: false, engine: 'db' });
      }

      const dbFindStartedAt = Date.now();
      const productsFromDb = await withDbRetry(() => prisma.product.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ updatedAt: 'desc' }],
        select: productSelect
      }));
      perf.log('db_fallback_find_done', { dbFindMs: Date.now() - dbFindStartedAt, productsCount: productsFromDb.length });

      const processedProducts = productsFromDb.map((product) => {
        const aiMetadata = parseAiMetadata(product.aiMetadata);
        const processed = applyDynamicPricingToProduct(product, shippingRates);
        const isRealBrand = typeof aiMetadata?.isRealBrand === 'boolean' ? aiMetadata.isRealBrand : null;
        const neworold = (product.neworold !== null && product.neworold !== undefined)
          ? product.neworold
          : extractNewOrOld(aiMetadata);
        return { ...processed, aiMetadata, isRealBrand, neworold };
      });
      const rankedFallbackProducts = processedProducts
        .slice()
        .sort((a, b) => {
          const aFeaturedMatch = isFeaturedMatchForQuery(a, exactFeaturedQueryVariants, condition);
          const bFeaturedMatch = isFeaturedMatchForQuery(b, exactFeaturedQueryVariants, condition);
          return Number(bFeaturedMatch) - Number(aFeaturedMatch);
        });
      const conditionFilteredProducts = condition === 'new'
        ? rankedFallbackProducts.filter((product) => inferProductCondition(product) !== false)
        : condition === 'used'
          ? rankedFallbackProducts.filter((product) => inferProductCondition(product) !== true)
          : rankedFallbackProducts;

      const mergedProducts = [];
      const mergedSeenIds = new Set();
      for (const product of featuredMatchedProducts) {
        const id = Number(product?.id);
        if (!Number.isFinite(id) || mergedSeenIds.has(id)) continue;
        mergedSeenIds.add(id);
        mergedProducts.push(product);
      }
      for (const product of conditionFilteredProducts) {
        const id = Number(product?.id);
        if (!Number.isFinite(id) || mergedSeenIds.has(id)) continue;
        mergedSeenIds.add(id);
        mergedProducts.push(product);
      }
      const pagedProducts = mergedProducts.slice(offset, offset + limit);
      const combinedTotal = Math.max(total + Array.from(featuredMatchedIdSet).filter((id) => !processedProducts.some((product) => Number(product?.id) === id)).length, mergedProducts.length);
      perf.log('response_sent', { engine: 'db', returned: pagedProducts.length, total: combinedTotal });
      return res.json({
        products: pagedProducts,
        total: combinedTotal,
        page,
        totalPages: Math.ceil(combinedTotal / limit),
        hasMore: offset + pagedProducts.length < combinedTotal,
        engine: 'db'
      });
    }
  } catch (error) {
    perf.log('error', { message: error?.message, name: error?.name });
    console.error('[Meili] search failed:', error);
    return res.status(503).json({
      error: 'Meilisearch search failed',
      details: error?.message || 'Unknown error'
    });
  }
});

// Search products
app.get('/api/search-legacy-disabled', async (req, res) => {
  try {
    // Ensure fresh responses for search (avoid 304 Not Modified)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    const { q, page = 1, limit = 20, condition = '', maxPrice } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const parsedMaxPrice = typeof maxPrice === 'string' ? Number.parseFloat(maxPrice) : NaN;
    const hasMaxPriceFilter = Number.isFinite(parsedMaxPrice) && parsedMaxPrice > 0;
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const startTime = Date.now();
    const log = (stage, data = {}) => {
      console.log(`[SEARCH ${requestId}] ${stage}`, { ...data, elapsedMs: Date.now() - startTime });
    };

    if (!q || typeof q !== 'string') {
      log('invalid_query', { qType: typeof q });
      return res.json({ products: [], total: 0, engine: 'none' });
    }
    const isArabicQuery = /[\u0600-\u06FF]/.test(q);
    const cleanQuery = q.replace(/[\\\/.,()!?;:]/g, ' ').trim();
    const normalizeArabicResult = normalizeArabic(cleanQuery);
    const normalizedArabicString = typeof normalizeArabicResult === 'string'
      ? normalizeArabicResult
      : String(normalizeArabicResult?.fullString || '').trim();
    const normalizedKeywords = normalizedArabicString
      .split(/\s+/)
      .map(k => k.trim())
      .filter(k => k.length > 1);
    const keywords = cleanQuery.split(/\s+/).filter(k => k.length > 1);
    const baseKeywords = Array.from(new Set([...keywords, ...normalizedKeywords]));
    log('start', {
      qLength: q.length,
      page: pageNum,
      limit: limitNum,
      isArabicQuery,
      keywordsCount: keywords.length,
      maxPrice: hasMaxPriceFilter ? parsedMaxPrice : null
    });

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    const useFastArabicSearch = false;
    const searchProductSelect = {
      id: true,
      name: true,
      specs: true,
      price: true,
      basePriceIQD: true,
      image: true,
      purchaseUrl: true,
      status: true,
      isFeatured: true,
      featuredSearchSentences: true,
      isActive: true,
      neworold: true,
      aiMetadata: true,
      domesticShippingFee: true,
      deliveryTime: true,
      isAirRestricted: true,
      variants: { select: productVariantSelect },
      images: {
        take: 1,
        orderBy: { order: 'asc' }
      }
    };
    delete searchProductSelect.chineseName;
    delete searchProductSelect.description;

    const keywordTokens = Array.from(new Set(
      keywords
        .map((token) => String(token || '').trim().toLowerCase())
        .map((token) => token
          .replace(/[أإآ]/g, 'ا')
          .replace(/ٱ/g, 'ا')
          .replace(/ء/g, '')
          .replace(/ؤ/g, 'و')
          .replace(/ئ/g, 'ي')
          .replace(/ة/g, 'ه')
          .replace(/ى/g, 'ي')
          .replace(/تيشريت/g, 'تيشيرت')
          .replace(/تيشرت/g, 'تيشيرت')
          .replace(/تشيرت/g, 'تيشيرت')
          .replace(/[\u064B-\u0652]/g, '')
          .replace(/ـ/g, '')
          .replace(/\s+/g, '')
          .trim()
        )
        .filter((token) => token.length > 1)
    )).slice(0, 8);

    if (keywordTokens.length === 0) {
      return res.json({ products: [], total: 0, hasMore: false, engine: 'keywords_only' });
    }

    const keywordOnlyStart = Date.now();
    const singleTokenMode = keywordTokens.length === 1;
    const keywordCompactExpr = `lower(regexp_replace(kw, '\\s+', '', 'g'))`;
    const keywordSpacedExpr = `lower(trim(regexp_replace(kw, '\\s+', ' ', 'g')))`;
    const tokenMatchCondition = singleTokenMode
      ? `(${keywordSpacedExpr} = t.token OR ${keywordCompactExpr} = t.token)`
      : `(${keywordSpacedExpr} = t.token OR ${keywordSpacedExpr} LIKE t.token || ' %' OR ${keywordSpacedExpr} LIKE '% ' || t.token || ' %' OR ${keywordSpacedExpr} LIKE '% ' || t.token OR ${keywordCompactExpr} = t.token)`;
    const tokenExactCondition = singleTokenMode
      ? `(${keywordSpacedExpr} = t.token OR ${keywordCompactExpr} = t.token)`
      : `${keywordCompactExpr} = t.token`;
    const compactKeywordQuery = String(cleanQuery || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ٱ/g, 'ا')
      .replace(/ء/g, '')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/تيشريت/g, 'تيشيرت')
      .replace(/تيشرت/g, 'تيشيرت')
      .replace(/تشيرت/g, 'تيشيرت')
      .replace(/[\u064B-\u0652]/g, '')
      .replace(/ـ/g, '')
      .replace(/\s+/g, '')
      .trim();
    const primaryKeywordTokens = keywordTokens.length > 0 ? [keywordTokens[0]] : keywordTokens;
    const secondaryKeywordTokens = keywordTokens.length > 1 ? keywordTokens.slice(1) : [];
    const requireAllTokens = keywordTokens.length > 1;
    const hasMaleIntent = keywordTokens.some((token) =>
      token.includes('رجال') || token.includes('رجالي') || token === 'men' || token === 'male' || token === 'man'
    );
    const hasFemaleIntent = keywordTokens.some((token) =>
      token.includes('نسائ') || token.includes('نساء') || token.includes('بنات') || token.includes('حريمي') || token === 'women' || token === 'female' || token === 'girl'
    );
    const hasFurnitureIntent = singleTokenMode && keywordTokens.some((token) =>
      token === 'اثاث' || token === 'عفش' || token.includes('مفروش')
    );
    const genderConflictClause = hasMaleIntent && !hasFemaleIntent
      ? `
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
        WHERE lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%نسائي%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%نسائيه%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%نساء%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%بنات%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%حريمي%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%women%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%female%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%girl%'
      )`
      : (hasFemaleIntent && !hasMaleIntent
        ? `
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
        WHERE lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%رجالي%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%رجال%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%للرجال%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%men%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%male%'
           OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%man%'
      )`
        : '');
    const furnitureIntentClause = hasFurnitureIntent
      ? `
      AND (
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
          WHERE lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%كنب%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%سرير%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%طاوله%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%طاولة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%كرسي%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%خزانه%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%خزانة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%دولاب%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مكتب%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%رف%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%تسريحه%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%تسريحة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%كومدينه%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%كومودينه%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%انتريه%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مجلس%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مرتبه%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مرتبة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مخده%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مخدة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%وساده%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%وسادة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%سجاد%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%ستاره%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%ستارة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مفروش%'
        )
      )
      AND NOT (
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
          WHERE lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%تنس%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%pingpong%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%tabletennis%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%كره%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%كرة%'
             OR lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%مضرب%'
        )
      )`
      : '';
    const conditionClause = String(condition || '').trim() === 'new'
      ? `
      AND (
        p.neworold = true
        OR (
          p.neworold IS NULL
          AND (
            lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"neworold":true%'
            OR lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"neworold": true%'
            OR lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"condition":"new"%'
            OR lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"condition": "new"%'
          )
        )
      )`
      : (String(condition || '').trim() === 'used'
        ? `
      AND (
        p.neworold = false
        OR p.neworold IS NULL
        OR (
          p.neworold IS NULL
          AND (
            lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"neworold":false%'
            OR lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"neworold": false%'
            OR lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"condition":"used"%'
            OR lower(COALESCE(p."aiMetadata"::text, '')) LIKE '%"condition": "used"%'
          )
        )
      )`
        : '');
    const allTokensClause = requireAllTokens
      ? `
      AND (
        SELECT count(*)
        FROM unnest($1::text[]) AS t(token)
        WHERE EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
          WHERE ${tokenMatchCondition}
        )
      ) = ${keywordTokens.length}
    `
      : '';
    const maxPriceClause = hasMaxPriceFilter ? `AND COALESCE(p.price, 0) <= ${parsedMaxPrice}` : '';
    const keywordWhereSql = `
      p.status = 'PUBLISHED'
      AND p."isActive" = true
      AND EXISTS (
        SELECT 1
        FROM unnest($5::text[]) AS t(token)
        WHERE EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
          WHERE ${tokenMatchCondition}
        )
      )
      ${allTokensClause}
      ${maxPriceClause}
      ${genderConflictClause}
      ${furnitureIntentClause}
      ${conditionClause}
    `;

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        p.id,
        CASE
          WHEN $4 <> '' AND EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
            WHERE lower(regexp_replace(kw, '\\s+', '', 'g')) LIKE '%' || $4 || '%'
          )
          THEN 1
          ELSE 0
        END AS phrase_match,
        (
          SELECT count(*)
          FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
          WHERE NOT EXISTS (
            SELECT 1
            FROM unnest($1::text[]) AS t(token)
            WHERE lower(regexp_replace(kw, '\\s+', '', 'g')) NOT LIKE '%' || t.token || '%'
          )
        ) AS keyword_combo_matches,
        (
          SELECT count(*)
          FROM unnest($1::text[]) AS t(token)
          WHERE EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
            WHERE ${tokenExactCondition}
          )
        ) AS exact_token_matches,
        (
          SELECT count(*)
          FROM unnest($6::text[]) AS t(token)
          WHERE EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
            WHERE ${tokenMatchCondition}
          )
        ) AS secondary_token_matches,
        (
          SELECT count(*)
          FROM unnest($1::text[]) AS t(token)
          WHERE EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p."keywords", ARRAY[]::text[])) AS kw
            WHERE ${tokenMatchCondition}
          )
        ) AS partial_token_matches
      FROM "Product" p
      WHERE ${keywordWhereSql}
      ORDER BY phrase_match DESC, secondary_token_matches DESC, keyword_combo_matches DESC, exact_token_matches DESC, partial_token_matches DESC, p.id DESC
      LIMIT $2 OFFSET $3
    `, keywordTokens, limitNum, skip, compactKeywordQuery, primaryKeywordTokens, secondaryKeywordTokens);

    const totalRows = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS total
      FROM "Product" p
      WHERE ${keywordWhereSql}
    `, keywordTokens, limitNum, skip, compactKeywordQuery, primaryKeywordTokens);

    const keywordOnlyTotal = Number(Array.isArray(totalRows) && totalRows[0]?.total ? totalRows[0].total : 0);
    const orderedIds = (Array.isArray(rows) ? rows : [])
      .map((row) => Number(row?.id))
      .filter((id) => Number.isFinite(id));

    if (orderedIds.length === 0) {
      log('keywords_only_done', { total: keywordOnlyTotal, returned: 0, dbMs: Date.now() - keywordOnlyStart, tokens: keywordTokens });
      return res.json({ products: [], total: keywordOnlyTotal, hasMore: false, engine: 'keywords_only' });
    }

    const foundProducts = await prisma.product.findMany({
      where: {
        id: { in: orderedIds },
        status: 'PUBLISHED',
        isActive: true
      },
      select: searchProductSelect
    });

    const byId = new Map(foundProducts.map((p) => [p.id, p]));
    const keywordOnlyProducts = orderedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((p) => {
        const processed = applyDynamicPricingToProduct(p, shippingRates);
        const aiMetadata = parseAiMetadata(p.aiMetadata);
        const neworold = (p.neworold !== null && p.neworold !== undefined) ? p.neworold : extractNewOrOld(aiMetadata);
        return { ...processed, neworold };
      });

    log('keywords_only_done', {
      total: keywordOnlyTotal,
      returned: keywordOnlyProducts.length,
      dbMs: Date.now() - keywordOnlyStart,
      tokens: keywordTokens,
      primaryToken: primaryKeywordTokens[0] || null,
      requireAllTokens,
      hasMaleIntent,
      hasFemaleIntent,
      hasFurnitureIntent,
      condition: String(condition || '').trim() || null,
      singleTokenMode,
      returnedProductPreview: keywordOnlyProducts.slice(0, 20).map((p) => ({
        id: p.id,
        name: p.name
      }))
    });
    return res.json({
      products: keywordOnlyProducts,
      total: keywordOnlyTotal,
      hasMore: skip + limitNum < keywordOnlyTotal,
      engine: 'keywords_only'
    });

    if (useFastArabicSearch) {
      log('fast_arabic_start', { cleanQueryLength: cleanQuery.length, keywordsCount: keywords.length });
      const where = {
        status: 'PUBLISHED',
        isActive: true,
        OR: [
          { name: { contains: cleanQuery, mode: 'insensitive' } },
          { specs: { contains: cleanQuery, mode: 'insensitive' } },
          ...(normalizedArabicString ? [
            { name: { contains: normalizedArabicString, mode: 'insensitive' } },
            { specs: { contains: normalizedArabicString, mode: 'insensitive' } }
          ] : []),
          ...baseKeywords.flatMap(term => [
            { name: { contains: term, mode: 'insensitive' } },
            { specs: { contains: term, mode: 'insensitive' } }
          ])
        ]
      };
      const fastStart = Date.now();
      const [total, products] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          select: searchProductSelect,
          skip,
          take: limitNum
        })
      ]);
      log('fast_arabic_done', { total, returned: products.length, dbMs: Date.now() - fastStart });
      return res.json({
        products: products.map(p => {
          const processed = applyDynamicPricingToProduct(p, shippingRates);
          const aiMetadata = parseAiMetadata(p.aiMetadata);
          const neworold = (p.neworold !== null && p.neworold !== undefined) ? p.neworold : extractNewOrOld(aiMetadata);
          return { ...processed, neworold };
        }),
        total,
        hasMore: skip + limitNum < total,
        engine: 'db'
      });
    }

    const shouldPreferKeywordEngine = isArabicQuery && normalizedKeywords.length >= 2;

    // Use AI Hybrid Search if API keys are available
    if (ENABLE_SEMANTIC_SEARCH && !shouldPreferKeywordEngine && (process.env.DEEPINFRA_API_KEY || process.env.HUGGINGFACE_API_KEY)) {
      try {
        log('hybrid_start', {});
        const hybridStart = Date.now();
        const results = await hybridSearch(q, 500, 0);
        log('hybrid_done', { total: results.length, hybridMs: Date.now() - hybridStart });
        const paginatedResults = results.slice(skip, skip + limitNum);

        const paginatedIds = paginatedResults.map(r => Number(r.id)).filter(id => !Number.isNaN(id));
        const hybridFetchStart = Date.now();
        const productsWithDetails = await prisma.product.findMany({
          where: {
            id: { in: paginatedIds },
            status: 'PUBLISHED',
            isActive: true
          },
          include: {
            variants: { select: productVariantSelect },
            images: {
              take: 1,
              orderBy: { order: 'asc' }
            }
          }
        });
        log('hybrid_products_done', { returned: productsWithDetails.length, dbMs: Date.now() - hybridFetchStart });

        const productsById = new Map(productsWithDetails.map(p => [p.id, p]));
        const scoresById = new Map(paginatedResults.map(r => [Number(r.id), {
          semantic_score: r.semantic_score,
          keyword_score: r.keyword_score,
          final_rank: r.final_rank
        }]));

        const mergedResults = paginatedIds
          .map(id => {
            const product = productsById.get(id);
            if (!product) return null;
            const scores = scoresById.get(id);
            return scores ? { ...product, ...scores } : product;
          })
          .filter(Boolean);

        return res.json({ 
          products: mergedResults.map(p => {
            const processed = applyDynamicPricingToProduct(p, shippingRates);
            const aiMetadata = parseAiMetadata(p.aiMetadata);
            const neworold = (p.neworold !== null && p.neworold !== undefined) ? p.neworold : extractNewOrOld(aiMetadata);
          return { ...processed, neworold };
          }), 
          total: results.length,
          hasMore: skip + limitNum < results.length,
          engine: 'hybrid'
        });
      } catch (aiError) {
        console.error(`[SEARCH ${requestId}] hybrid_error`, aiError);
      }
    }

    // Highly flexible Arabic and Iraqi Dialect normalization and variation generation
    const getVariations = (word) => {
      const variations = new Set([word]);
      
      // Basic normalization function
      const normalize = (w) => w
        .replace(/[أإآ]/g, 'ا')
        .replace(/ٱ/g, 'ا')
        .replace(/ء/g, '')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[\u064B-\u0652]/g, '')
        .replace(/ـ/g, '')
        .replace(/ناسائ/g, 'نسائ')
        .replace(/ناسا/g, 'نسا');

      const base = normalize(word);
      variations.add(base);
      if (base.includes('ناسائ')) {
        variations.add(base.replace(/ناسائ/g, 'نسائ'));
      }
    if (base.includes('ناسا')) {
      variations.add(base.replace(/ناسا/g, 'نسا'));
    }

      // 1. Iraqi Dialect & Character-level variations
      const generateCharVariations = (w) => {
        let results = [w];
        
        // Alef variations
        const alefs = ['ا', 'أ', 'إ', 'آ'];
        alefs.forEach(a => {
          const currentLen = results.length;
          for (let i = 0; i < currentLen; i++) {
            const item = results[i];
            if (item.includes(a)) {
              alefs.forEach(targetA => {
                results.push(item.replace(new RegExp(a, 'g'), targetA));
              });
            }
          }
        });

        // Teh Marbuta / Heh variations
        const tehs = ['ة', 'ه'];
        tehs.forEach(t => {
          const currentLen = results.length;
          for (let i = 0; i < currentLen; i++) {
            const item = results[i];
            if (item.endsWith(t)) {
              tehs.forEach(targetT => {
                results.push(item.slice(0, -1) + targetT);
              });
            }
          }
        });

        // Yeh / Alef Maqsura variations
        const yehs = ['ي', 'ى'];
        yehs.forEach(y => {
          const currentLen = results.length;
          for (let i = 0; i < currentLen; i++) {
            const item = results[i];
            if (item.endsWith(y)) {
              yehs.forEach(targetY => {
                results.push(item.slice(0, -1) + targetY);
              });
            }
          }
        });

        // Iraqi / Persian / Urdu character mappings to Standard Arabic
        // گ (Gaf) -> ق or ك
        // چ (Che) -> ج or ك
        // پ (Pe) -> ب
        // ڤ (Ve) -> ف
        const currentLenBeforeIraqi = results.length;
        for (let i = 0; i < currentLenBeforeIraqi; i++) {
          const item = results[i];
          if (item.includes('گ')) {
            results.push(item.replace(/گ/g, 'ق'));
            results.push(item.replace(/گ/g, 'ك'));
          }
          if (item.includes('چ')) {
            results.push(item.replace(/چ/g, 'ج'));
            results.push(item.replace(/چ/g, 'ك'));
          }
          if (item.includes('پ')) results.push(item.replace(/پ/g, 'ب'));
          if (item.includes('ڤ')) results.push(item.replace(/ڤ/g, 'ف'));
          
          // Phonetic swaps common in Iraqi dialect
          if (item.includes('ق')) {
            results.push(item.replace(/ق/g, 'ك'));
            results.push(item.replace(/ق/g, 'گ'));
            results.push(item.replace(/ق/g, 'ج')); // Iraqi 'G' sound sometimes written as J or pronounced close to it
          }
          if (item.includes('ك')) {
            results.push(item.replace(/ك/g, 'ق'));
            results.push(item.replace(/ك/g, 'چ')); // k -> ch swap (e.g. kaff -> chaff)
          }
          if (item.includes('ج')) {
            results.push(item.replace(/ج/g, 'ي')); // j -> y swap (e.g. dajaj -> dayay)
            results.push(item.replace(/ج/g, 'چ'));
          }

          // More Iraqi phonetic swaps
          if (item.includes('ط')) results.push(item.replace(/ط/g, 'ت'));
          if (item.includes('ت')) results.push(item.replace(/ت/g, 'ط'));
          if (item.includes('ض')) results.push(item.replace(/ض/g, 'د'));
          if (item.includes('د')) results.push(item.replace(/د/g, 'ض'));
          if (item.includes('ظ')) results.push(item.replace(/ظ/g, 'ض'));
          if (item.includes('ث')) {
            results.push(item.replace(/ث/g, 'ت'));
            results.push(item.replace(/ث/g, 'س'));
          }
          if (item.includes('ذ')) {
            results.push(item.replace(/ذ/g, 'د'));
            results.push(item.replace(/ذ/g, 'ز'));
          }
          if (item.includes('ص')) results.push(item.replace(/ص/g, 'س'));
          if (item.includes('س')) results.push(item.replace(/س/g, 'ص'));
          
          // Additional Iraqi dialect character swaps
          if (item.includes('غ')) results.push(item.replace(/غ/g, 'ق')); // Common in some Iraqi regions
          if (item.includes('ق') && !results.includes(item.replace(/ق/g, 'غ'))) results.push(item.replace(/ق/g, 'غ'));
          
          // Hamza on Yeh/Waw common variations
          if (item.includes('ئ')) results.push(item.replace(/ئ/g, 'ي'));
          if (item.includes('ؤ')) results.push(item.replace(/ؤ/g, 'و'));
          if (item.includes('ي') && !results.includes(item.replace(/ي/g, 'ئ'))) results.push(item.replace(/ي/g, 'ئ'));
          if (item.includes('و') && !results.includes(item.replace(/و/g, 'ؤ'))) results.push(item.replace(/و/g, 'ؤ'));
        }

        return Array.from(new Set(results));
      };

      // 1.5 Word-level Iraqi dialect mappings
      const dialectMappings = {
        'شلون': ['كيف', 'حالة'],
        'خوش': ['جيد', 'ممتاز', 'اصلي'],
        'هوايه': ['كثير', 'جدا'],
        'ماكو': ['ليس', 'لا يوجد'],
        'اكو': ['يوجد', 'موجود'],
        'هسه': ['الان', 'حاليا'],
        'اريد': ['اطلب', 'احتاج'],
        'بلاش': ['مجاني', 'رخيص'],
        'هدوم': ['ملابس', 'ازياء'],
        'قندرة': ['حذاء'],
        'جواتي': ['حذاء', 'رياضي'],
        'دشدشة': ['ثوب', 'ملابس'],
        'عركية': ['قبعة'],
        'ياخة': ['ياقة', 'قميص']
      };

      if (dialectMappings[base]) {
        dialectMappings[base].forEach(m => variations.add(m));
      }
      
      // Check if word is a standard word that has an Iraqi dialect equivalent
      Object.entries(dialectMappings).forEach(([dialect, standards]) => {
        if (standards.includes(base)) {
          variations.add(dialect);
        }
      });

      // Apply character variations
      generateCharVariations(word).forEach(v => variations.add(v));
      generateCharVariations(base).forEach(v => variations.add(v));

      // 2. Handle Common Prefixes (ال، و، ب)
      const currentTermsForPrefix = Array.from(variations);
      currentTermsForPrefix.forEach(v => {
        // Al- (ال)
        if (v.startsWith('ال')) {
          variations.add(v.substring(2));
        } else if (v.length > 2) {
          variations.add('ال' + v);
        }
        
        // W- (و) conjunction
        if (v.startsWith('و') && v.length > 3) {
          variations.add(v.substring(1));
        }
        
        // Bi- (ب) preposition (common in Iraqi)
        if (v.startsWith('ب') && v.length > 3) {
          variations.add(v.substring(1));
        }
      });

      // 3. Handle Common Suffixes (Plurals, Gender, Possessives)
      const currentTermsForSuffix = Array.from(variations);
      currentTermsForSuffix.forEach(v => {
        // Feminine/Adjective suffixes: 'يه', 'ية' -> 'ي'
        if (v.endsWith('يه') || v.endsWith('ية')) {
          variations.add(v.slice(0, -2));
          variations.add(v.slice(0, -2) + 'ي');
          variations.add(v.slice(0, -1)); // Keep base but change teh to heh/vice versa via variations
        }
        
        // 'ي' -> 'يه', 'ية' (e.g., رجالي -> رجاليه)
        if (v.endsWith('ي')) {
          variations.add(v + 'ه');
          variations.add(v + 'ة');
        }

        // Plural suffixes: 'ات', 'ون', 'ين', 'ية'
        const pluralSuffixes = ['ات', 'ون', 'ين', 'ية'];
        for (const suffix of pluralSuffixes) {
          if (v.endsWith(suffix) && v.length > suffix.length + 2) {
            variations.add(v.slice(0, -suffix.length));
          }
        }

        // Iraqi specific plural/possessive or common endings
        // 'ات' is very common for plurals in Iraq even for masculine items sometimes in slang
        if (v.length > 3 && !v.endsWith('ات')) {
          variations.add(v + 'ات');
        }
        
        // Removing common Iraqi possessive 'نا' (our) or 'كم' (your) - rare in search but possible
        if (v.endsWith('نا') && v.length > 4) variations.add(v.slice(0, -2));
        if (v.endsWith('كم') && v.length > 4) variations.add(v.slice(0, -2));
      });

      // 4. Final step: ensure all generated terms are normalized to avoid duplicates and missing matches
      const finalVariations = new Set();
      variations.forEach(v => {
        if (v && v.length > 1) {
          finalVariations.add(v);
          finalVariations.add(normalize(v));
        }
      });

      const finalArray = Array.from(finalVariations);
      if (finalArray.length > 80) {
        return finalArray.slice(0, 80);
      }
      return finalArray;
    };

    function normalizeForSearch(text) {
      return (text || '').toLowerCase()
        .replace(/[أإآ]/g, 'ا')
        .replace(/ٱ/g, 'ا')
        .replace(/ء/g, '')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[گ]/g, 'ق')
        .replace(/[چ]/g, 'ج')
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/ناسائ/g, 'نسائ')
        .replace(/ناسا/g, 'نسا')
        .replace(/[\u064B-\u0652]/g, '')
        .replace(/ـ/g, '')
        .replace(/[\\\/.,()!?;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function expandAlefVariants(term) {
      const base = String(term || '').trim();
      if (!base) return [];
      const positions = [];
      for (let i = 0; i < base.length; i += 1) {
        if (base[i] === 'ا') positions.push(i);
      }
      if (positions.length === 0) return [base];
      const variants = new Set();
      const alefs = ['ا', 'أ', 'إ', 'آ'];
      const maxVariants = 24;
      const chars = base.split('');
      const build = (idx) => {
        if (variants.size >= maxVariants) return;
        if (idx >= positions.length) {
          variants.add(chars.join(''));
          return;
        }
        const pos = positions[idx];
        for (const a of alefs) {
          chars[pos] = a;
          build(idx + 1);
          if (variants.size >= maxVariants) return;
        }
        chars[pos] = 'ا';
      };
      build(0);
      return Array.from(variants);
    }

    function simpleArabicVariants(term) {
      const variations = new Set();
      const original = String(term || '').trim();
      if (original) variations.add(original);
      const base = normalizeForSearch(original);
      if (base) variations.add(base);
      expandAlefVariants(base).forEach(v => variations.add(v));
      if (base.endsWith('ه')) variations.add(base.slice(0, -1) + 'ة');
      if (base.endsWith('ة')) variations.add(base.slice(0, -1) + 'ه');
      if (base.endsWith('ه') || base.endsWith('ة')) {
        const stem = base.slice(0, -1);
        if (stem.length > 1) variations.add(stem + 'ات');
      }
      if (base.endsWith('ات')) {
        const stem = base.slice(0, -2);
        if (stem.length > 1) {
          variations.add(stem);
          variations.add(stem + 'ه');
          variations.add(stem + 'ة');
        }
      }
      return Array.from(variations).filter(v => v && v.length > 1);
    }

    const stopWords = ['ال', 'في', 'من', 'على', 'مع', 'لـ', 'بـ', 'و', 'عن', 'الى', 'او'];
    const searchKeywords = Array.from(new Set(baseKeywords
      .map(k => normalizeForSearch(k))
      .flatMap(k => k.split(/\s+/))
      .map(k => k.trim())
      .filter(k => k.length > 1 && !stopWords.includes(k))
    ));
    const primaryKeyword = searchKeywords[0] || '';
    const useReducedSearch = isArabicQuery || baseKeywords.length > 3 || cleanQuery.length > 24;
    const primaryKeywordVariants = Array.from(new Set(
      (primaryKeyword
        ? (isArabicQuery ? simpleArabicVariants(primaryKeyword) : getVariations(primaryKeyword))
        : []
      )
        .map(v => normalizeForSearch(v))
        .filter(v => v && v.length > 1)
    )).slice(0, 24);
    
    const allSearchTerms = new Set();
    searchKeywords.forEach((k) => allSearchTerms.add(k));
    primaryKeywordVariants.forEach((k) => allSearchTerms.add(k));
    baseKeywords.forEach(k => {
      if (useReducedSearch) {
        simpleArabicVariants(k).forEach(v => allSearchTerms.add(v));
      } else {
        getVariations(k).forEach(v => allSearchTerms.add(v));
      }
    });
    [q, cleanQuery, normalizedArabicString].filter(Boolean).forEach((term) => {
      if (useReducedSearch) {
        simpleArabicVariants(term).forEach(v => allSearchTerms.add(v));
      } else {
        getVariations(term).forEach(v => allSearchTerms.add(v));
      }
    });

    let searchTermsArray = Array.from(allSearchTerms);
    const compactArabicQueryLength = normalizedArabicString.replace(/\s+/g, '').length;
    const isShortArabicQuery = isArabicQuery && compactArabicQueryLength <= 5;
    const maxTerms = useReducedSearch
      ? (isArabicQuery ? (isShortArabicQuery ? 12 : 20) : 40)
      : 120;
    if (searchTermsArray.length > maxTerms) {
      const prioritized = Array.from(new Set([
        ...searchKeywords,
        primaryKeyword,
        ...primaryKeywordVariants
      ].filter(Boolean)));
      const prioritizedSet = new Set(prioritized);
      const remainder = searchTermsArray.filter(term => !prioritizedSet.has(term));
      searchTermsArray = [...prioritized, ...remainder].slice(0, maxTerms);
    }
    const queryTokensForCoverage = Array.from(new Set(normalizedKeywords.filter(Boolean)));
    log('keyword_terms_ready', { useReducedSearch, termsCount: searchTermsArray.length, queryTokens: queryTokensForCoverage });

    const normalizedQ = normalizeForSearch(q);
    const compactNormalizedQ = normalizedQ.replace(/\s+/g, '');

    const scoreAndSortProducts = (products) => {
      const scoringStart = Date.now();
      const scoredProducts = products.map(product => {
        let score = 0;
        const name = normalizeForSearch(product.name);
        const compactName = name.replace(/\s+/g, '');
        const aiMetadata = parseAiMetadata(product.aiMetadata);
        const productKeywords = Array.isArray(aiMetadata?.keywords)
          ? aiMetadata.keywords.flatMap(k => normalizeForSearch(k).split(/\s+/)).filter(Boolean)
          : [];
        const productKeywordsCompact = productKeywords.map((kw) => kw.replace(/\s+/g, ''));
        const productKeywordsSet = new Set(productKeywords);
        const specs = normalizeForSearch(product.specs);
        const compactSpecs = specs.replace(/\s+/g, '');
        const aiTextRaw = aiMetadata ? JSON.stringify(aiMetadata) : '';
        const aiText = normalizeForSearch(aiTextRaw);
        const keywordExactMatchCount = queryTokensForCoverage.filter((k) => {
          const compactToken = k.replace(/\s+/g, '');
          return productKeywordsSet.has(k) || productKeywordsCompact.includes(compactToken);
        }).length;
        const keywordPartialMatchCount = queryTokensForCoverage.filter((k) => {
          const compactToken = k.replace(/\s+/g, '');
          return productKeywords.some((kw) => kw.includes(k)) || productKeywordsCompact.some((kw) => kw.includes(compactToken));
        }).length;
        const fullKeywordCoverage = queryTokensForCoverage.length > 0 && keywordExactMatchCount >= queryTokensForCoverage.length;
        
        if (name === normalizedQ) score += 10000;
        
        if (name.includes(normalizedQ)) score += 5000;
        if (compactNormalizedQ && name.replace(/\s+/g, '').includes(compactNormalizedQ)) score += 3500;
        if (specs && specs.includes(normalizedQ)) score += 1500;
        if (productKeywords.some(k => k.includes(normalizedQ))) score += 3000;
        if (aiText && aiText.includes(normalizedQ)) score += 1200;

        let nameMatches = 0;
        
        normalizedKeywords.forEach((k, idx) => {
          if (name.includes(k)) {
            nameMatches++;
            score += 600; 
            if (name.startsWith(k)) score += 200;
            
            if (idx < normalizedKeywords.length - 1) {
              const nextK = normalizedKeywords[idx + 1];
              if (name.includes(k + ' ' + nextK) || name.includes(k + nextK)) {
                score += 1200;
              }
            }
          }

          if (specs && specs.includes(k)) {
            score += 40;
          }
          if (productKeywordsSet.has(k) || productKeywords.some(kw => kw.includes(k))) {
            score += 300;
          }
          if (aiText && aiText.includes(k)) {
            score += 150;
          }
        });

        const nameCoverage = normalizedKeywords.length > 0 ? nameMatches / normalizedKeywords.length : 0;
        score += nameCoverage * 4000;

        const totalUniqueMatches = new Set();
        normalizedKeywords.forEach(k => {
          if (name.includes(k) || (specs && specs.includes(k)) || productKeywordsSet.has(k) || productKeywords.some(kw => kw.includes(k))) {
            totalUniqueMatches.add(k);
          }
        });
        const matchCount = totalUniqueMatches.size;
        const totalCoverage = normalizedKeywords.length > 0 ? matchCount / normalizedKeywords.length : 0;
        score += totalCoverage * 2000;

        if (normalizedKeywords.length >= 2 && totalCoverage >= 0.8) {
          score += 1000;
        }

        if (product.id.toString() === q.trim()) score += 15000;
        const tokenMatchCount = queryTokensForCoverage.filter((k) => {
          const compactToken = k.replace(/\s+/g, '');
          return name.includes(k)
            || compactName.includes(compactToken)
            || (specs && specs.includes(k))
            || (compactSpecs && compactSpecs.includes(compactToken))
            || productKeywordsSet.has(k)
            || productKeywords.some((kw) => kw.includes(k))
            || productKeywordsCompact.includes(compactToken)
            || productKeywordsCompact.some((kw) => kw.includes(compactToken));
        }).length;
        const fullTokenCoverage = queryTokensForCoverage.length > 0 && tokenMatchCount >= queryTokensForCoverage.length;
        if (queryTokensForCoverage.length >= 2) {
          if (fullKeywordCoverage) score += 12000;
          if (keywordPartialMatchCount >= queryTokensForCoverage.length) score += 2800;
          if (queryTokensForCoverage.every((k) => name.includes(k))) score += 4200;
          score += tokenMatchCount * 1800;
          if (fullTokenCoverage) score += 9000;
        } else if (queryTokensForCoverage.length === 1 && keywordExactMatchCount > 0) {
          score += 2400;
        }

        return {
          ...product,
          searchScore: score,
          matchCount,
          keywordExactMatchCount,
          fullKeywordCoverage,
          tokenMatchCount,
          fullTokenCoverage
        };
      });
      const sortedProducts = scoredProducts
        .filter(p => p.searchScore > 0)
        .sort((a, b) => {
          if (Number(Boolean(b.fullTokenCoverage)) !== Number(Boolean(a.fullTokenCoverage))) {
            return Number(Boolean(b.fullTokenCoverage)) - Number(Boolean(a.fullTokenCoverage));
          }
          if ((b.tokenMatchCount || 0) !== (a.tokenMatchCount || 0)) {
            return (b.tokenMatchCount || 0) - (a.tokenMatchCount || 0);
          }
          if (Number(Boolean(b.fullKeywordCoverage)) !== Number(Boolean(a.fullKeywordCoverage))) {
            return Number(Boolean(b.fullKeywordCoverage)) - Number(Boolean(a.fullKeywordCoverage));
          }
          if ((b.keywordExactMatchCount || 0) !== (a.keywordExactMatchCount || 0)) {
            return (b.keywordExactMatchCount || 0) - (a.keywordExactMatchCount || 0);
          }
          if (b.matchCount !== a.matchCount) {
            return b.matchCount - a.matchCount;
          }
          if (b.searchScore !== a.searchScore) {
            return b.searchScore - a.searchScore;
          }
          return b.id - a.id;
        });
      const topRankingPreview = sortedProducts.slice(0, 5).map((p) => ({
        id: p.id,
        score: p.searchScore,
        matchCount: p.matchCount,
        tokenMatchCount: p.tokenMatchCount || 0,
        fullTokenCoverage: Boolean(p.fullTokenCoverage),
        keywordExactMatchCount: p.keywordExactMatchCount || 0,
        fullKeywordCoverage: Boolean(p.fullKeywordCoverage),
        name: String(p.name || '').slice(0, 80)
      }));
      log('keyword_scoring_done', {
        scored: scoredProducts.length,
        kept: sortedProducts.length,
        scoringMs: Date.now() - scoringStart,
        topRankingPreview
      });
      return sortedProducts;
    };

    if (isArabicQuery && useReducedSearch) {
      const buildArabicVariants = (term) => {
        const variations = new Set();
        const base = normalizeForSearch(term);
        if (base) variations.add(base);
        expandAlefVariants(base).forEach(v => variations.add(v));
        if (base.endsWith('ه')) variations.add(base.slice(0, -1) + 'ة');
        if (base.endsWith('ة')) variations.add(base.slice(0, -1) + 'ه');
        if (base.endsWith('ه') || base.endsWith('ة')) {
          const stem = base.slice(0, -1);
          if (stem.length > 1) variations.add(stem + 'ات');
        }
        if (base.endsWith('ات')) {
          const stem = base.slice(0, -2);
          if (stem.length > 1) {
            variations.add(stem + 'ه');
            variations.add(stem + 'ة');
            variations.add(stem);
          }
        }
        return Array.from(variations).filter(v => v.length > 1);
      };

      const seedTerms = Array.from(new Set([cleanQuery, normalizedArabicString, ...normalizedKeywords]))
        .filter(t => t && t.length > 1)
        .slice(0, 3);
      const prefixTermLimit = isShortArabicQuery ? 4 : 6;
      const prefixTerms = Array.from(new Set(seedTerms.flatMap(buildArabicVariants))).slice(0, prefixTermLimit);
      if (prefixTerms.length > 0) {
        const prefixWhere = {
          status: 'PUBLISHED',
          isActive: true,
          OR: prefixTerms.map(term => ({ name: { startsWith: term, mode: 'insensitive' } }))
        };
        const prefixStart = Date.now();
        const prefixTake = Math.max(skip + limitNum, limitNum * 2, isShortArabicQuery ? 40 : 60);
        const prefixProducts = await prisma.product.findMany({
          where: prefixWhere,
          select: searchProductSelect,
          take: prefixTake
        });
        log('arabic_prefix_done', { returned: prefixProducts.length, dbMs: Date.now() - prefixStart, termsCount: prefixTerms.length });

        const shouldBroaden = prefixProducts.length < Math.max(skip + limitNum, limitNum * (isShortArabicQuery ? 2 : 3));
        let combinedProducts = prefixProducts;

        if (shouldBroaden) {
          const broadenTerms = Array.from(new Set(searchTermsArray.filter(Boolean))).slice(0, isShortArabicQuery ? 5 : 8);
          const containsWhere = {
            status: 'PUBLISHED',
            isActive: true,
            OR: broadenTerms.flatMap(term => ([
              { name: { contains: term, mode: 'insensitive' } },
              { specs: { contains: term, mode: 'insensitive' } }
            ]))
          };
          const containsStart = Date.now();
          const containsTake = Math.max(skip + limitNum, limitNum * 2, isShortArabicQuery ? 40 : 60);
          const containsProducts = await prisma.product.findMany({
            where: containsWhere,
            select: searchProductSelect,
            take: containsTake
          });
          log('arabic_contains_done', { returned: containsProducts.length, dbMs: Date.now() - containsStart, termsCount: prefixTerms.length });
          if (containsProducts.length > 0) {
            const seen = new Set(combinedProducts.map(p => String(p.id)));
            containsProducts.forEach((p) => {
              const key = String(p.id);
              if (seen.has(key)) return;
              seen.add(key);
              combinedProducts.push(p);
            });
          }
        }

        if (combinedProducts.length > 0) {
          const sortedProducts = scoreAndSortProducts(combinedProducts);
          const total = sortedProducts.length;
          if (total <= skip) {
            log('keyword_done', { total, returned: 0 });
            return res.json({
              products: [],
              total,
              hasMore: false,
              engine: 'db'
            });
          }
          const paginatedProducts = sortedProducts.slice(skip, skip + limitNum);
          log('keyword_done', { total, returned: paginatedProducts.length });
      return res.json({ 
        products: paginatedProducts.map(p => {
          const processed = applyDynamicPricingToProduct(p, shippingRates);
          const aiMetadata = parseAiMetadata(p.aiMetadata);
          const neworold = (p.neworold !== null && p.neworold !== undefined) ? p.neworold : extractNewOrOld(aiMetadata);
          return { ...processed, neworold };
        }), 
        total,
        hasMore: sortedProducts.length > skip + limitNum,
        engine: 'db'
      });
        }
      }
    }

    const searchFields = isArabicQuery ? ['name', 'specs'] : (useReducedSearch ? ['name'] : ['name', 'specs']);
    const effectiveSearchTerms = isArabicQuery ? searchTermsArray.slice(0, 16) : searchTermsArray;
    const keywordFetchStart = Date.now();
    const keywordWhere = {
      status: 'PUBLISHED',
      isActive: true,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        ...(normalizedArabicString ? [{ name: { contains: normalizedArabicString, mode: 'insensitive' } }] : []),
        ...effectiveSearchTerms.flatMap(term =>
          [
            ...searchFields.map(field => ({ [field]: { contains: term, mode: 'insensitive' } }))
          ]
        )
      ]
    };
    const keywordTake = Math.max(
      skip + limitNum,
      useReducedSearch ? (isArabicQuery ? 80 : 200) : 500
    );
    const products = await prisma.product.findMany({
      where: keywordWhere,
      select: searchProductSelect,
      take: keywordTake + 1
    });
    log('keyword_products_done', { returned: products.length, dbMs: Date.now() - keywordFetchStart });

    const hasMoreCandidates = products.length > keywordTake;
    const sortedProducts = scoreAndSortProducts(products.slice(0, keywordTake));
    const total = sortedProducts.length + (hasMoreCandidates ? 1 : 0);
    if (total <= skip) {
      log('keyword_done', { total, returned: 0 });
      return res.json({
        products: [],
        total,
        hasMore: false,
        engine: 'db'
      });
    }
    const paginatedProducts = sortedProducts.slice(skip, skip + limitNum);

    log('keyword_done', { total, returned: paginatedProducts.length });
    res.json({ 
      products: paginatedProducts.map(p => {
        const processed = applyDynamicPricingToProduct(p, shippingRates);
        const aiMetadata = parseAiMetadata(p.aiMetadata);
        const neworold = (p.neworold !== null && p.neworold !== undefined) ? p.neworold : extractNewOrOld(aiMetadata);
          return { ...processed, neworold };
      }), 
      total,
      hasMore: skip + limitNum < total,
      engine: 'db'
    });
  } catch (error) {
    console.error('Search error:', error);
    console.log(`[SEARCH ${typeof requestId === 'string' ? requestId : 'unknown'}] error`, { message: error?.message, name: error?.name });
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/search/suggestions-legacy-disabled', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(300, Math.max(1, parseInt(String(req.query.limit || '120'), 10) || 120));
    if (q.length < 1) return res.json({ suggestions: [] });
    const { list } = buildCategoryIndex();
    const normalizedQuery = normalizeArabic(q).fullString.toLowerCase();
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    const literalQuery = q.toLowerCase();
    const matchesLiteral = (value) => value.toLowerCase().includes(literalQuery);
    const ranked = list
      .map((entry) => {
        const normalizedPath = normalizeArabic(entry.pathAr).fullString.toLowerCase();
        const normalizedName = normalizeArabic(entry.nameAr).fullString.toLowerCase();
        const compactPath = normalizedPath.replace(/\s+/g, '');
        const compactName = normalizedName.replace(/\s+/g, '');
        const literalPathMatch = matchesLiteral(entry.pathAr);
        const literalNameMatch = matchesLiteral(entry.nameAr);
        const normalizedPathMatch = normalizedPath.includes(normalizedQuery);
        const normalizedNameMatch = normalizedName.includes(normalizedQuery);
        const compactPathMatch = compactQuery && compactPath.includes(compactQuery);
        const compactNameMatch = compactQuery && compactName.includes(compactQuery);
        const matchScore = (literalNameMatch || normalizedNameMatch || compactNameMatch)
          ? 3
          : ((literalPathMatch || normalizedPathMatch || compactPathMatch) ? 2 : 0);
        return { entry, matchScore };
      })
      .filter((row) => row.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore || a.entry.pathAr.length - b.entry.pathAr.length);
    const suggestions = [];
    const seen = new Set();
    for (const row of ranked) {
      if (seen.has(row.entry.id)) continue;
      seen.add(row.entry.id);
      const parts = row.entry.pathAr.split(' > ');
      const parent = parts.length > 1 ? parts[parts.length - 2] : '';
      suggestions.push({
        id: row.entry.id,
        label: row.entry.nameAr,
        name: row.entry.nameAr,
        path: row.entry.pathAr,
        parent: parent
      });
      if (suggestions.length >= limit) break;
    }
    return res.json({ suggestions });
  } catch (error) {
    console.error('[Search Suggestions] error:', error);
    return res.json({ suggestions: [] });
  }
});

// ADMIN: Create Product
// ADMIN: Update Product

app.put('/api/products/:id/archive', authenticateToken, isAdmin, async (req, res) => {
  try {
    const rawId = String(req.params.id || '').trim();
    
    // We don't want to break if it's a local draft ID accidentally sent here
    if (rawId.startsWith('local-')) {
        return res.json({ success: true });
    }

    const id = rawId.replace(/^rapid-/i, '');

    const product = await prisma.product.update({
      where: { id: safeParseId(id) },
      data: { isActive: false }
    });
    
    res.json({ success: true, message: 'Product archived', product });
  } catch (error) {
    console.error('Error archiving product:', error);
    res.status(500).json({ error: 'Failed to archive product' });
  }
});

app.put('/api/products/:id', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, chineseName, price, basePriceIQD, description, image, 
      isFeatured, isActive, status, purchaseUrl, videoUrl, 
      specs, images, detailImages, featuredSearchSentences, featuredSearchTerms,
      weight, length, width, height, domesticShippingFee, deliveryTime
    } = req.body;
    
    // Handle main image conversion if needed
    let finalMainImage = image;
    if (image && typeof image === 'string' && image.startsWith('data:image')) {
      finalMainImage = await convertToWebP(image);
    }

    // Handle additional images conversion in parallel
    let processedGalleryImages = images;
    if (images && Array.isArray(images)) {
      processedGalleryImages = await Promise.all(images.map(async (img) => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && typeof url === 'string' && url.startsWith('data:image')) {
          const webpUrl = await convertToWebP(url);
          return typeof img === 'string' ? webpUrl : { ...img, url: webpUrl };
        }
        return img;
      }));
    }

    let processedDetailImages = detailImages;
    if (detailImages && Array.isArray(detailImages)) {
      processedDetailImages = await Promise.all(detailImages.map(async (img) => {
        const url = typeof img === 'string' ? img : img.url;
        if (url && typeof url === 'string' && url.startsWith('data:image')) {
          const webpUrl = await convertToWebP(url);
          return typeof img === 'string' ? webpUrl : { ...img, url: webpUrl };
        }
        return img;
      }));
    }

    const updateData = {
      name,
      chineseName,
      price: price !== undefined ? parseFloat(price) : undefined,
      basePriceIQD: basePriceIQD !== undefined ? (basePriceIQD ? parseFloat(basePriceIQD) : null) : undefined,
      description,
      image: finalMainImage,
      purchaseUrl,
      videoUrl,
      isFeatured: isFeatured !== undefined ? !!isFeatured : undefined,
      isActive: isActive !== undefined ? !!isActive : undefined,
      status: status !== undefined ? status : undefined,
      specs: specs !== undefined ? (specs && typeof specs === 'object' ? JSON.stringify(specs) : specs) : undefined,
      weight: weight !== undefined ? (weight === '' ? null : parseFloat(weight)) : undefined,
      length: length !== undefined ? (length === '' ? null : parseFloat(length)) : undefined,
      width: width !== undefined ? (width === '' ? null : parseFloat(width)) : undefined,
      height: height !== undefined ? (height === '' ? null : parseFloat(height)) : undefined,
      domesticShippingFee: domesticShippingFee !== undefined ? (domesticShippingFee === '' ? null : parseFloat(domesticShippingFee)) : undefined,
      deliveryTime: deliveryTime !== undefined ? (deliveryTime === '' ? null : deliveryTime) : undefined
    };

    const rawFeaturedSearchSentences = featuredSearchSentences !== undefined
      ? featuredSearchSentences
      : featuredSearchTerms;

    if (rawFeaturedSearchSentences !== undefined) {
      const normalizedFeaturedTerms = sanitizeFeaturedSearchSentences(rawFeaturedSearchSentences);
      const currentProduct = await prisma.product.findUnique({
        where: { id: safeParseId(id) },
        select: { aiMetadata: true }
      });
      const currentMetadata = stripLegacyFeaturedSearchTermsFromMetadata(parseAiMetadata(currentProduct?.aiMetadata) || {});
      updateData.aiMetadata = currentMetadata;
      updateData.featuredSearchSentences = normalizedFeaturedTerms;
      updateData.isFeatured = normalizedFeaturedTerms.length > 0;
    } else if (isFeatured === false) {
      const currentProduct = await prisma.product.findUnique({
        where: { id: safeParseId(id) },
        select: { aiMetadata: true }
      });
      updateData.aiMetadata = stripLegacyFeaturedSearchTermsFromMetadata(parseAiMetadata(currentProduct?.aiMetadata) || {});
      updateData.featuredSearchSentences = [];
      updateData.isFeatured = false;
    }

    // Remove undefined fields
    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    const product = await prisma.$transaction(async (tx) => {
      console.log('[Update Product] Updating ID:', id, 'Data:', updateData);
      const updated = await tx.product.update({
        where: { id: safeParseId(id) },
        data: updateData
      });

      // Handle images update if provided
      if ((processedGalleryImages && Array.isArray(processedGalleryImages)) || (processedDetailImages && Array.isArray(processedDetailImages))) {
        console.log('[Update Product] Updating images for product:', id);
        
        // Simple approach: delete existing and recreate
        await tx.productImage.deleteMany({
          where: { productId: safeParseId(id) }
        });

        const imagesToCreate = [];
        
        if (processedGalleryImages && Array.isArray(processedGalleryImages)) {
          processedGalleryImages.forEach((img, idx) => {
            imagesToCreate.push({
              productId: safeParseId(id),
              url: typeof img === 'string' ? img : img.url,
              type: typeof img === 'string' ? 'GALLERY' : (img.type || 'GALLERY'),
              order: typeof img === 'string' ? idx : (img.order || idx)
            });
          });
        }
        
        if (processedDetailImages && Array.isArray(processedDetailImages)) {
          processedDetailImages.forEach((img, idx) => {
            imagesToCreate.push({
              productId: safeParseId(id),
              url: typeof img === 'string' ? img : img.url,
              type: 'DETAIL',
              order: (processedGalleryImages ? processedGalleryImages.length : 0) + idx
            });
          });
        }
        
        if (imagesToCreate.length > 0) {
          await tx.productImage.createMany({
            data: imagesToCreate
          });
        }
      }

      return updated;
    });

    enqueueEmbeddingJob(product.id);
    enqueueImageEmbeddingJob(product.id);
    void syncProductToMeiliById(product.id).catch((meiliError) => {
      console.error('[Meili] update product sync failed:', meiliError?.message || meiliError);
    });

    res.json(product);
  } catch (error) {
    console.error('[Update Product] Error:', error);
    res.status(500).json({ error: 'Failed to update product', details: error.message });
  }
});

// ADMIN: Delete Product
app.delete('/api/products/:id', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { id } = req.params;
    const productId = safeParseId(id);

    // Delete related records first (Prisma doesn't have cascade delete for all relations by default)
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { productId } }), // Delete OrderItems first to satisfy foreign key constraints
      prisma.productImage.deleteMany({ where: { productId } }),
      prisma.productOption.deleteMany({ where: { productId } }),
      prisma.productVariant.deleteMany({ where: { productId } }),
      prisma.cartItem.deleteMany({ where: { productId } }),
      prisma.wishlistItem.deleteMany({ where: { productId } }),
      prisma.review.deleteMany({ where: { productId } }),
    ]);

    await prisma.product.delete({ where: { id: productId } });
    void deleteProductFromMeiliById(productId).catch((meiliError) => {
      console.error('[Meili] delete product sync failed:', meiliError?.message || meiliError);
    });

    await logActivity(
      req.user.id,
      req.user.name,
      'DELETE_PRODUCT',
      { id: productId },
      'PRODUCT'
    );

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Bulk delete products
// Bulk update products status (isActive)


// ADMIN: Trigger AI dimension estimation for products without them
app.post('/api/admin/products/estimate-dimensions', authenticateToken, isAdmin, hasPermission('manage_products'), async (req, res) => {
  try {
    const { productIds } = req.body;
    
    // If no specific IDs provided, find all products with missing physical data
    let productsToProcess = [];
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      productsToProcess = await prisma.product.findMany({
        where: {
          OR: [
            { weight: null },
            { length: null },
            { width: null },
            { height: null }
          ]
        },
        select: { id: true }
      });
    } else {
      productsToProcess = productIds.map(id => ({ id: safeParseId(id) }));
    }

    console.log(`[AI Dimensions] Processing ${productsToProcess.length} products...`);
    
    // Process in background to avoid timeout
    (async () => {
      for (const p of productsToProcess) {
        try {
          await processProductAI(p.id);
          // Small delay to be safe with rate limits
          await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
          console.error(`[AI Dimensions] Failed for product ${p.id}:`, err.message);
        }
      }
      console.log(`[AI Dimensions] Completed processing ${productsToProcess.length} products.`);
    })();

    res.json({ 
      success: true, 
      message: `Started AI estimation for ${productsToProcess.length} products in background.` 
    });
  } catch (error) {
    console.error('[AI Dimensions] Error:', error);
    res.status(500).json({ error: 'Failed to trigger AI estimation' });
  }
});

// --- Addresses routes ---
app.get('/api/addresses', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; 
    const addresses = await prisma.address.findMany({
      where: { userId }
    });
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch addresses' });
  }
});

app.post('/api/addresses', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, name, phone, street, city, buildingNo, floorNo, isDefault } = req.body;
    
    console.log('Creating address for user:', userId, 'Data:', { type, name, phone, street, city, buildingNo, floorNo, isDefault });

    // Check if address already exists for this user to avoid duplicates
    const existing = await prisma.address.findFirst({
      where: {
        userId,
        street,
        city,
        phone
      }
    });

    if (existing) {
      console.log('Address already exists, returning existing:', existing.id);
      return res.status(200).json(existing);
    }

    // If setting as default, unset others
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false }
      });
    }

    const address = await prisma.address.create({
      data: {
        userId,
        type: type || 'المنزل',
        name,
        phone,
        street,
        city,
        buildingNo: buildingNo || '',
        floorNo: floorNo || '',
        isDefault: !!isDefault
      }
    });
    res.status(201).json(address);
  } catch (error) {
    console.error('Create address error:', error);
    res.status(500).json({ error: 'Failed to create address' });
  }
});

app.delete('/api/addresses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Ensure address belongs to user
    const address = await prisma.address.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!address || address.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.address.delete({
      where: { id: safeParseId(id) }
    });

    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

app.put('/api/addresses/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { type, name, phone, street, city, buildingNo, floorNo, isDefault } = req.body;

    // Ensure address belongs to user
    const existingAddress = await prisma.address.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!existingAddress || existingAddress.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // If setting as default, unset others
    if (isDefault) {
      await prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false }
      });
    }

    const updatedAddress = await prisma.address.update({
      where: { id: safeParseId(id) },
      data: {
        type,
        name,
        phone,
        street,
        city,
        buildingNo,
        floorNo,
        isDefault: !!isDefault
      }
    });
    res.json(updatedAddress);
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

// --- Cart routes ---
app.get('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cartItems = await prisma.cartItem.findMany({
      where: { userId },
      include: { 
        product: true,
        variant: { select: productVariantSelect }
      }
    });
    res.json(cartItems);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity = 1, variantId, selectedOptions, shippingMethod = 'air' } = req.body;
    
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    const pId = typeof productId === 'number' ? productId : parseInt(productId);
    let vId = variantId ? (typeof variantId === 'number' ? variantId : parseInt(variantId)) : null;
    if (isNaN(vId)) vId = null;
    const qty = parseInt(quantity) || 1;
    
    const sOptions = typeof selectedOptions === 'object' ? JSON.stringify(selectedOptions) : (selectedOptions || null);

    if (!pId || isNaN(pId)) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const product = await prisma.product.findUnique({
      where: { id: pId },
      include: { variants: { select: productVariantSelect } }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const variant = vId ? product.variants.find(v => v.id === vId) : null;

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    // Calculate inclusive price (base price + shipping)
    const dbPrice = variant ? variant.price : product.price;
    const adjustedBasePrice = getAdjustedPrice(
      dbPrice,
      variant?.weight || product.weight,
      variant?.length || product.length);
    const shippingFee = await calculateProductShipping(product, shippingMethod, true, variant);
    const inclusivePrice = Math.ceil((adjustedBasePrice + shippingFee) / 250) * 250;

    // Use a more robust approach since Prisma upsert doesn't like nulls in compound unique keys
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        userId,
        productId: pId,
        variantId: vId,
        selectedOptions: sOptions,
        shippingMethod: shippingMethod
      }
    });

    let cartItem;
    if (existingItem) {
      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { 
          quantity: existingItem.quantity + qty,
          price: inclusivePrice
        },
        include: { 
          product: true,
          variant: { select: productVariantSelect }
        }
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: {
          userId,
          productId: pId,
          variantId: vId,
          selectedOptions: sOptions,
          quantity: qty,
          price: inclusivePrice,
          shippingMethod: shippingMethod
        },
        include: { 
          product: true,
          variant: { select: productVariantSelect }
        }
      });
    }
    
    res.json(cartItem);
  } catch (error) {
    console.error('Add to cart error details:', {
      message: error.message,
      stack: error.stack,
      body: req.body,
      userId: req.user?.id
    });
    res.status(500).json({ error: `Failed to add to cart: ${error.message}` });
  }
});

app.put('/api/cart/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const qty = parseInt(req.body.quantity);
    const userId = req.user.id;
    
    if (isNaN(qty)) {
      return res.status(400).json({ error: 'Invalid quantity' });
    }
    
    // Ensure item belongs to user
    const itemId = safeParseId(id);
    const existingItem = await prisma.cartItem.findUnique({
      where: { id: itemId }
    });

    if (!existingItem || existingItem.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (qty <= 0) {
      await prisma.cartItem.delete({ where: { id: itemId } });
      return res.json({ message: 'Item removed from cart' });
    }

    const cartItem = await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: qty },
      include: { 
        product: true,
        variant: { select: productVariantSelect }
      }
    });
    res.json(cartItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update cart' });
  }
});

app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Ensure item belongs to user
    const existingItem = await prisma.cartItem.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!existingItem || existingItem.userId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.cartItem.delete({
      where: { id: safeParseId(id) }
    });
    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from cart' });
  }
});

// --- Order routes ---
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId, shippingMethod = 'air', paymentMethod = 'zain_cash', couponCode, items: bodyItems } = req.body;
    const INT4_MAX = 2147483647;
    const parseInt4 = (value) => {
      const parsed = Number.parseInt(String(value ?? ''), 10);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > INT4_MAX) return null;
      return parsed;
    };

    if (!addressId) {
      return res.status(400).json({ error: 'Address is required' });
    }

    // 1. Resolve order items
    // Prefer trusted DB cart rows. If body items are malformed/non-DB IDs, we fallback to DB cart.
    const hasBodyItems = Array.isArray(bodyItems) && bodyItems.length > 0;

    let cartItems;
    if (hasBodyItems) {
      cartItems = await Promise.all(bodyItems.map(async (item) => {
        const rawProductId = item?.productId ?? item?.product?.id;
        const rawVariantId = item?.variantId ?? item?.variant?.id;
        const sourceProductKey = String(rawProductId ?? '').trim();
        const productId = parseInt4(rawProductId);
        const variantId = parseInt4(rawVariantId);
        const dbProduct = productId ? await prisma.product.findUnique({ where: { id: productId } }) : null;
        const product = dbProduct || item?.product || null;
        let variant = null;
        if (variantId) {
          variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: productVariantSelect });
        }
        if (!variant && item?.variant) variant = item.variant;
        const safeQuantity = Math.max(1, Number.parseInt(String(item.quantity ?? 1), 10) || 1);
        const safeBodyPrice = Number(item?.price);
        const safeProductPrice = Number(item?.product?.price);
        const inferredPurchaseUrl = sourceProductKey
          ? `https://item.taobao.com/item.htm?id=${encodeURIComponent(sourceProductKey.replace(/^rapid-/i, ''))}`
          : undefined;
        const purchaseUrl = item?.product?.purchaseUrl || item?.purchaseUrl || inferredPurchaseUrl;
        return {
          ...item,
          productId,
          variantId: variant?.id ?? null,
          quantity: safeQuantity,
          price: Number.isFinite(safeBodyPrice) && safeBodyPrice > 0
            ? safeBodyPrice
            : (Number.isFinite(safeProductPrice) && safeProductPrice > 0 ? safeProductPrice : 0),
          product,
          variant,
          image: item?.product?.image || item?.image || '',
          name: item?.product?.name || item?.name || 'Product',
          sourceProductKey,
          purchaseUrl
        };
      }));
    } else {
      cartItems = await prisma.cartItem.findMany({
        where: {
          userId,
          shippingMethod: shippingMethod
        },
        include: {
          product: true,
          variant: { select: productVariantSelect }
        }
      });
    }

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }
    const missingProductItem = cartItems.find((item) => !item?.product);
    if (missingProductItem && !hasBodyItems) {
      return res.status(400).json({ error: 'تعذر تحميل بيانات منتج من السلة. يرجى تحديث السلة ثم المحاولة مرة أخرى.' });
    }

    const storeSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const shippingRates = {
      airShippingRate: storeSettings?.airShippingRate,
      seaShippingRate: storeSettings?.seaShippingRate,
      airShippingMinFloor: storeSettings?.airShippingMinFloor
    };

    // 2. Prepare items with correct prices (adjusted based on shipping method)
    const processedItems = cartItems.map(item => {
      const product = item.product;
      const variant = item.variant;

      if (!product) return null;

      const bodyPrice = Number(item?.price);
      const dbPrice = variant?.price || (Number.isFinite(bodyPrice) && bodyPrice > 0 ? bodyPrice : 0) || product.price || 0;
      const method = item.shippingMethod || shippingMethod || 'air';
      
      const adjustedPrice = getAdjustedPrice(
        dbPrice,
        variant?.weight || product.weight,
        variant?.length || product.length);
      
      // Ensure selectedOptions is a string for Prisma
      let sOptions = item.selectedOptions;
      if (sOptions && typeof sOptions === 'object') {
        sOptions = JSON.stringify(sOptions);
      }

      return { 
        ...item, 
        price: adjustedPrice,
        selectedOptions: sOptions
      };
    }).filter(Boolean);

    // 3. Calculate international shipping fee for the entire order
    const shippingInfo = await calculateOrderShipping(processedItems, shippingMethod);
    
    // Check minimum order thresholds
    if (!shippingInfo.isThresholdMet) {
      return res.status(400).json({ 
        error: `الحد الأدنى للطلب هو ${shippingInfo.threshold?.toLocaleString() || '30,000'} د.ع. مجموع طلبك الحالي هو ${shippingInfo.subtotal.toLocaleString()} د.ع.`
      });
    }

    const internationalShippingFee = shippingInfo.fee;

    // 4. Calculate subtotal using item prices
    const subtotal = processedItems.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);

    // 5. Handle Coupon
    let discountAmount = 0;
    let couponId = null;

    if (couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: couponCode, isActive: true }
      });

      if (coupon) {
        // Check if user has already used this coupon
        const usage = await prisma.couponUsage.findFirst({
          where: {
            couponId: coupon.id,
            userId: userId
          }
        });

        const now = new Date();
        const isExpired = now < coupon.startDate || now > coupon.endDate;
        const isBelowMinAmount = subtotal < coupon.minOrderAmount;
        const isAlreadyUsedByUser = !!usage;
        const isPrivateAndUsed = !coupon.isPublic && coupon.usageCount >= 1;
        const isLimitReached = coupon.usageLimit && coupon.usageCount >= coupon.usageLimit;

        if (!isExpired && !isBelowMinAmount && !isAlreadyUsedByUser && !isPrivateAndUsed && !isLimitReached) {
          if (coupon.discountType === 'PERCENTAGE') {
            discountAmount = (subtotal * coupon.discountValue) / 100;
            if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
              discountAmount = coupon.maxDiscount;
            }
          } else {
            discountAmount = coupon.discountValue;
          }
          couponId = coupon.id;
        }
      }
    }

    // 6. Calculate Final Total
    const total = Math.ceil((subtotal + internationalShippingFee - discountAmount) / 250) * 250;

    console.log('[Order Creation] Data:', {
      userId,
      addressId: safeParseId(addressId),
      total,
      discountAmount,
      couponId,
      shippingMethod,
      paymentMethod,
      internationalShippingFee,
      itemCount: processedItems.length
    });

    // 6. Create order with items in a transaction
    const order = await prisma.$transaction(async (tx) => {
      try {
        // Create order
        const normalizedOrderItems = [];
        for (const item of processedItems) {
          let resolvedProductId = Number.isInteger(item?.productId) && item.productId > 0 ? item.productId : null;
          const sourceProductKey = String(item?.sourceProductKey || '').trim();
          const inferredPurchaseUrl = sourceProductKey
            ? `https://item.taobao.com/item.htm?id=${encodeURIComponent(sourceProductKey.replace(/^rapid-/i, ''))}`
            : undefined;
          const snapshotPurchaseUrl = item?.purchaseUrl || item?.product?.purchaseUrl || inferredPurchaseUrl || null;
          if (!resolvedProductId) {
            const snapshotPrice = Number(item?.price) > 0 ? Number(item.price) : 0;
            const snapshotName = String(item?.product?.name || item?.name || 'Product').slice(0, 250);
            const snapshotImage = String(item?.product?.image || item?.image || '').trim();
            const createdProduct = await tx.product.create({
              data: {
                name: snapshotName || 'Product',
                price: snapshotPrice,
                image: snapshotImage || 'https://via.placeholder.com/600x600.png?text=Product',
                purchaseUrl: snapshotPurchaseUrl,
                isActive: true,
                status: 'PUBLISHED'
              }
            });
            resolvedProductId = createdProduct.id;
          }
          normalizedOrderItems.push({
            productId: resolvedProductId,
            variantId: Number.isInteger(item?.variantId) ? item.variantId : null,
            selectedOptions: item.selectedOptions,
            quantity: item.quantity,
            price: item.price,
            shippingMethod: item.shippingMethod || 'air'
          });
        }

        const newOrder = await tx.order.create({
          data: {
            userId,
            addressId: safeParseId(addressId),
            total,
            discountAmount,
            couponId,
            status: 'PENDING',
            shippingMethod,
            paymentMethod,
            internationalShippingFee,
            items: {
              create: normalizedOrderItems
            }
          },
          include: { 
            items: {
              include: {
                product: true,
                variant: { select: productVariantSelect }
              }
            } 
          }
        });

        // Handle Coupon Usage Tracking
        if (couponId) {
          // Increment usage count
          await tx.coupon.update({
            where: { id: couponId },
            data: { usageCount: { increment: 1 } }
          });

          // Record usage for this user
          await tx.couponUsage.create({
            data: {
              couponId: couponId,
              userId: userId
            }
          });
        }

        // 7. Clear cart items for the specific shipping method that was ordered
        await tx.cartItem.deleteMany({ 
          where: { 
            userId,
            shippingMethod: shippingMethod 
          } 
        });

        return newOrder;
      } catch (txError) {
        console.error('[Transaction Error Details]:', txError);
        // Write error to a temporary file for debugging if console is not accessible
        fs.appendFileSync('order_error.log', `[${new Date().toISOString()}] Transaction Error: ${txError.message}\n${txError.stack}\n`);
        throw txError;
      }
    });

    // Notify admins of new order
    io.to('admin_notifications').emit('new_order', order);

    // Create notification for user
    await createUserNotification(
      userId,
      'تم استلام طلبك بنجاح! 🎉',
      `طلبك رقم #${order.id} قيد المراجعة الآن. سنقوم بإبلاغك فور تحديث حالته.`,
      'order',
      'shopping_bag',
      'blue',
      `/shipping-tracking?id=${order.id}`
    );

    res.status(201).json(order);
  } catch (error) {
    console.error('Order creation error:', error);
    fs.appendFileSync('order_error.log', `[${new Date().toISOString()}] Global Error: ${error.message}\n${error.stack}\n`);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await prisma.order.findMany({
      where: { userId },
      include: {
        items: { 
          include: { 
            product: true,
            variant: { select: productVariantSelect }
          } 
        },
        address: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) },
      include: {
        items: { 
          include: { 
            product: true,
            variant: { select: productVariantSelect }
          } 
        },
        address: true
      }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

app.put('/api/orders/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const order = await prisma.order.findUnique({
      where: { id: safeParseId(id) }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: 'Only pending orders can be cancelled' });

    const updatedOrder = await prisma.order.update({
      where: { id: safeParseId(id) },
      data: { status: 'CANCELLED' }
    });

    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

app.put('/api/orders/:id/confirm-payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const orderId = safeParseId(id);

    console.log(`[Payment] Confirmation request for order ${id} from user ${userId}`);

    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      console.log(`[Payment] Order ${id} not found`);
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.userId !== userId) {
      console.log(`[Payment] Order ${id} does not belong to user ${userId}`);
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Update order status to PREPARING (or a status that indicates payment is being verified)
    // We'll use PREPARING as it's the next logical step after AWAITING_PAYMENT
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'PREPARING' }
    });

    console.log(`[Payment] Order ${id} status updated to PREPARING`);

    // Notify admins via socket
    io.to('admin_notifications').emit('order_status_update', {
      id: orderId,
      status: 'PREPARING',
      message: `تم استلام إشعار دفع للطلب #${id}`
    });

    res.json(updatedOrder);
  } catch (error) {
    console.error('[Payment] Error confirming payment:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// --- Wishlist routes ---
app.get('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const wishlist = await prisma.wishlistItem.findMany({
      where: { userId },
      include: { product: true }
    });
    res.json(wishlist);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
});

// --- Review routes ---
app.post('/api/products/:id/reviews', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Invalid rating' });
    }

    const review = await prisma.review.create({
      data: {
        rating,
        comment,
        productId: safeParseId(id),
        userId
      },
      include: { user: { select: { name: true } } }
    });

    res.json(review);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create review' });
  }
});

app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const productId = safeParseId(id);
    
    // Get reviews from the review table
    const dbReviews = await prisma.review.findMany({
      where: { productId },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    
    // Get product to check for reviews in specs field and aiMetadata and scrapedReviews
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { specs: true, aiMetadata: true, scrapedReviews: true }
    });
    
    let importedReviews = [];

    // Extract reviews from new 'scrapedReviews' field (Primary Source)
    if (product?.scrapedReviews && Array.isArray(product.scrapedReviews)) {
      product.scrapedReviews.forEach((r, i) => {
        importedReviews.push({
          id: -3000 - i, // Different ID range to avoid conflicts
          rating: 5,
          comment: r.comment || 'صور من تقييمات العملاء',
          createdAt: new Date().toISOString(),
          user: { name: r.name || 'تقييمات المتجر' },
          images: r.photos || r.images || []
        });
      });
    }
    
    // Extract reviews from aiMetadata (Legacy Scraped Reviews) - Only if no new reviews
    if (importedReviews.length === 0 && product?.aiMetadata?.reviews && Array.isArray(product.aiMetadata.reviews)) {
      product.aiMetadata.reviews.forEach((r, i) => {
        if (r.images && r.images.length > 0) {
          importedReviews.push({
            id: -2000 - i,
            rating: 5,
            comment: 'صور من تقييمات العملاء',
            createdAt: new Date().toISOString(),
            user: { name: 'تقييمات المتجر' },
            images: r.images
          });
        }
      });
    }

    // Extract reviews from specs field if they exist
    if (product && product.specs && typeof product.specs === 'string' && product.specs.includes('---REVIEW_SUMMARY---')) {
      try {
        const parts = product.specs.split('---REVIEW_SUMMARY---');
        if (parts.length >= 2) {
          const reviewSummary = JSON.parse(parts[1].trim());
          
          // Handle both formats: direct reviews array and detailedReviews format
          let rawReviews = [];
          if (reviewSummary.reviews && Array.isArray(reviewSummary.reviews)) {
            rawReviews = reviewSummary.reviews;
          } else if (reviewSummary.tags && Array.isArray(reviewSummary.tags) && reviewSummary.tags.length > 0 && typeof reviewSummary.tags[0] === 'object' && (reviewSummary.tags[0].user || reviewSummary.tags[0].comment)) {
            // Sometimes reviews are incorrectly saved in tags during bulk import
            rawReviews = reviewSummary.tags;
          }

          if (rawReviews.length > 0) {
            // Direct reviews format: "reviews": [ { "user": "...", "comment": "..." } ]
            const newReviews = rawReviews.map((review, index) => ({
              id: -index - 1, // Negative IDs to distinguish from database reviews
              rating: 5, // Default rating for imported reviews
              comment: review.comment || '',
              createdAt: new Date().toISOString(),
              user: { name: review.user || 'عميل' },
              images: []
            }));
            importedReviews = [...importedReviews, ...newReviews];
          } else if (reviewSummary.detailedReviews && Array.isArray(reviewSummary.detailedReviews)) {
            // detailedReviews format (legacy)
            const newReviews = reviewSummary.detailedReviews.map((review, index) => ({
              id: -index - 1, // Negative IDs to distinguish from database reviews
              rating: 5, // Default rating for imported reviews
              comment: review.comments ? (Array.isArray(review.comments) ? review.comments.join(' ') : review.comments) : '',
              createdAt: new Date().toISOString(),
              user: { name: review.user || 'عميل' },
              images: review.images || []
            }));
            importedReviews = [...importedReviews, ...newReviews];
          }
        }
      } catch (parseError) {
        console.error('Failed to parse review summary from specs:', parseError);
      }
    }
    
    // Combine database reviews with imported reviews
    const allReviews = [...dbReviews, ...importedReviews];
    
    res.json(allReviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

app.post('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body;
    
    const wishlistItem = await prisma.wishlistItem.upsert({
      where: {
        userId_productId: { userId, productId: safeParseId(productId) }
      },
      update: {},
      create: {
        userId,
        productId: safeParseId(productId)
      },
      include: { product: true }
    });
    res.json(wishlistItem);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to wishlist' });
  }
});

app.delete('/api/wishlist/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    
    await prisma.wishlistItem.delete({
      where: {
        userId_productId: { userId, productId: safeParseId(productId) }
      }
    });
    res.json({ message: 'Removed from wishlist' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove from wishlist' });
  }
});

// --- Admin: Banners ---
app.get('/api/banners', async (req, res) => {
  try {
    const banners = await prisma.banner.findMany({
      orderBy: { order: 'asc' }
    });
    res.json(banners);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

app.post('/api/admin/banners', authenticateToken, isAdmin, hasPermission('manage_content'), async (req, res) => {
  try {
    const { title, subtitle, image, link, order, isActive } = req.body;
    const banner = await prisma.banner.create({
      data: { title, subtitle, image, link, order: parseInt(order) || 0, isActive: !!isActive }
    });
    res.status(201).json(banner);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

app.put('/api/admin/banners/:id', authenticateToken, isAdmin, hasPermission('manage_content'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, image, link, order, isActive } = req.body;
    const banner = await prisma.banner.update({
      where: { id: safeParseId(id) },
      data: { title, subtitle, image, link, order: parseInt(order) || 0, isActive: !!isActive }
    });
    res.json(banner);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

app.delete('/api/admin/banners/:id', authenticateToken, isAdmin, hasPermission('manage_content'), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.banner.delete({ where: { id: safeParseId(id) } });
    res.json({ message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

// --- Admin: Settings ---
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await prisma.storeSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 }
    });
    res.json(settings);
  } catch (error) {
    console.error('Fetch settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/admin/settings', authenticateToken, isAdmin, hasPermission('manage_settings'), async (req, res) => {
  try {
    const { 
      storeName, 
      contactEmail, 
      contactPhone, 
      currency, 
      socialLinks, 
      footerText,
      airShippingRate,
      seaShippingRate,
      airShippingMinFloor,
      airShippingThreshold,
      seaShippingThreshold
    } = req.body;

    const previousSettings = await prisma.storeSettings.findUnique({ where: { id: 1 } });
    const oldRates = {
      airShippingRate: previousSettings?.airShippingRate ?? 15400,
      seaShippingRate: previousSettings?.seaShippingRate ?? 182000,
      airShippingMinFloor: previousSettings?.airShippingMinFloor ?? 0
    };

    const parseFiniteFloat = (val) => {
      if (val === null || val === undefined || val === '') return undefined;
      const n = typeof val === 'number' ? val : parseFloat(val);
      return Number.isFinite(n) ? n : undefined;
    };

    const updateData = {
      ...(storeName !== undefined ? { storeName } : {}),
      ...(contactEmail !== undefined ? { contactEmail } : {}),
      ...(contactPhone !== undefined ? { contactPhone } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(footerText !== undefined ? { footerText } : {}),
      ...(socialLinks !== undefined ? { socialLinks: typeof socialLinks === 'object' ? JSON.stringify(socialLinks) : socialLinks } : {})
    };

    const parsedAirShippingRate = parseFiniteFloat(airShippingRate);
    const parsedSeaShippingRate = parseFiniteFloat(seaShippingRate);
    const parsedAirMinFloor = parseFiniteFloat(airShippingMinFloor);
    const parsedAirThreshold = parseFiniteFloat(airShippingThreshold);
    const parsedSeaThreshold = parseFiniteFloat(seaShippingThreshold);

    if (parsedAirShippingRate !== undefined) updateData.airShippingRate = parsedAirShippingRate;
    if (parsedSeaShippingRate !== undefined) updateData.seaShippingRate = parsedSeaShippingRate;
    if (parsedAirMinFloor !== undefined) updateData.airShippingMinFloor = parsedAirMinFloor;
    if (parsedAirThreshold !== undefined) updateData.airShippingThreshold = parsedAirThreshold;
    if (parsedSeaThreshold !== undefined) updateData.seaShippingThreshold = parsedSeaThreshold;
    
    const settings = await prisma.storeSettings.upsert({
      where: { id: 1 },
      update: updateData,
      create: { 
        id: 1, 
        storeName, 
        contactEmail, 
        contactPhone, 
        currency, 
        socialLinks: typeof socialLinks === 'object' ? JSON.stringify(socialLinks) : socialLinks, 
        footerText,
        airShippingRate: parsedAirShippingRate ?? 15400,
        seaShippingRate: parsedSeaShippingRate ?? 182000,
        airShippingMinFloor: parsedAirMinFloor ?? 0,
        airShippingThreshold: parsedAirThreshold ?? 30000,
        seaShippingThreshold: parsedSeaThreshold ?? 30000
      }
    });

    const newRates = {
      airShippingRate: settings.airShippingRate,
      seaShippingRate: settings.seaShippingRate,
      airShippingMinFloor: settings.airShippingMinFloor
    };
    const ratesChanged =
      oldRates.airShippingRate !== newRates.airShippingRate ||
      oldRates.seaShippingRate !== newRates.seaShippingRate ||
      oldRates.airShippingMinFloor !== newRates.airShippingMinFloor;

    if (ratesChanged) {
      recalculateExistingProductPrices(oldRates, newRates).catch((e) => {
        console.error('[Settings] Price recalculation failed:', e);
      });
    }

    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// --- Admin: User Profile Details ---
app.get('/api/admin/users/:id', authenticateToken, isAdmin, hasPermission('manage_users'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: safeParseId(id) },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: { orders: true }
        }
      }
    });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const totalSpend = user.orders.reduce((sum, order) => sum + order.total, 0);
    
    res.json({ ...user, totalSpend });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// --- Message functions ---
app.get('/api/messages/:orderId', authenticateToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    // Check if order belongs to user or user is admin
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(orderId) }
    });
    
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await prisma.message.findMany({
      where: { orderId: safeParseId(orderId) },
      orderBy: { createdAt: 'asc' }
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/admin/messages', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all messages grouped by order, with order and user details
    const messages = await prisma.message.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          include: {
            user: true,
            items: {
              include: {
                product: true
              }
            }
          }
        },
        user: true
      }
    });

    // Group by orderId to show conversations
    const conversations = messages.reduce((acc, msg) => {
      if (!acc[msg.orderId]) {
        acc[msg.orderId] = {
          orderId: msg.orderId,
          order: msg.order,
          user: msg.user,
          lastMessage: msg,
          unreadCount: 0 // We could implement unread status later
        };
      }
      return acc;
    }, {});

    res.json(Object.values(conversations));
  } catch (error) {
    console.error('Fetch admin messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { orderId, text } = req.body;
    const userId = req.user.id;
    const sender = req.user.role === 'ADMIN' ? 'ADMIN' : 'USER';

    // Check if order belongs to user or user is admin
    const order = await prisma.order.findUnique({
      where: { id: safeParseId(orderId) }
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== userId && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await prisma.message.create({
      data: {
        orderId: safeParseId(orderId),
        userId,
        sender,
        text
      }
    });

    // Notify other party via socket if needed
    io.emit('new_message', message);

    // If admin sent message, notify user
    if (sender === 'ADMIN') {
      await createUserNotification(
        order.userId,
        'رسالة جديدة من الدعم الفني 💬',
        `لديك رسالة جديدة بخصوص الطلب #${orderId}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
        'system',
        'chat',
        'purple',
        `/chat?orderId=${orderId}`
      );
    } else {
      // If user sent message, notify admin (using the existing createNotification helper for admins)
      await createNotification(
        'رسالة جديدة من عميل 💬',
        `العميل ${req.user.name || 'مجهول'} أرسل رسالة بخصوص الطلب #${orderId}`,
        'info',
        `/admin/orders/${orderId}`
      );
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Catch-all route for SPA - MUST be after all API routes
app.get('/', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('E-commerce API is running... (Frontend build not found)');
  }
});

app.get('/*any', (req, res) => {
  // Check if the request is for an API route - if so, don't serve index.html
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('E-commerce API is running... (Frontend build not found)');
  }
});

setupLinkCheckerCron();

console.log('Attempting to start server on port:', process.env.PORT || 5001);
console.log('[Perf] ENABLE_SEARCH_PERF_LOGS =', ENABLE_SEARCH_PERF_LOGS, `(raw: ${String(process.env.ENABLE_SEARCH_PERF_LOGS || '')})`);

const server = httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT} (accessible from network)`);
  
  // Trigger MeiliSearch indexing on startup
  setTimeout(() => {
    console.log('[Meili Debug] Triggering startup index check...');
    ensureMeiliIndexed().catch(err => {
      // Don't crash the server or flood logs if DB is down at startup
      if (err.name === 'PrismaClientInitializationError') {
        console.error('[Meili Debug] Startup index check skipped: Database connection unavailable (Will retry automatically on next request)');
      } else {
        console.error('[Meili Debug] Startup index check failed:', err.message);
      }
    });
  }, 5000);
});

server.on('error', (e) => {
  console.error('SERVER LISTEN ERROR:', e);
});

