import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Try the most likely locations for the .env file, in priority order.
// We try the deepest, most-specific path FIRST so the key-bearing
// server/.env wins over any project-root .env that might not have it.
const ENV_CANDIDATES = [
  path.join(__dirname, '..', '.env'),                       // D:\mynewproject2\server\.env  (where the key actually lives)
  path.join(__dirname, '..', '..', '.env'),                 // D:\mynewproject2\.env
  path.join(__dirname, '..', '..', 'server', '.env'),      // defensive
  path.join(__dirname, '..', '..', '..', '.env'),           // one level above repo (last resort)
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'server', '.env'),
];
for (const p of ENV_CANDIDATES) {
  try { if (fs.existsSync(p)) { dotenv.config({ path: p }); break; } } catch {}
}

const SILICONFLOW_API_KEY = (process.env.SILICONFLOW_API_KEY || '').trim();
// Detect if it's a DeepSeek key (35 chars) or SiliconFlow (usually 51 chars)
const IS_DEEPSEEK_KEY = SILICONFLOW_API_KEY.length === 35 && SILICONFLOW_API_KEY.startsWith('sk-');
// Default to SiliconFlow's `.com` host. Earlier versions used `.cn`, but most
// accounts (including the one in this repo) are served on `.com` and `.cn`
// returns 401 for them. Allow override via SILICONFLOW_BASE_URL.
const SILICONFLOW_BASE_URL = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.com/v1').replace(/\/$/, '');
// Default model: deepseek-ai/DeepSeek-V4-Flash. This model does NOT support
// `response_format: json_object` and does NOT support `enable_thinking=false`
// in the same way, so we adapt the request below.
const SILICONFLOW_MODEL = String(process.env.SILICONFLOW_MODEL || (IS_DEEPSEEK_KEY ? 'deepseek-chat' : 'deepseek-ai/DeepSeek-V4-Flash')).trim();
const IS_V4_THINKING_MODEL = /DeepSeek-V4|DeepSeek-R1|reasoner|v4-flash/i.test(SILICONFLOW_MODEL);
// V4-Flash / V4-Pro / R1 reject `response_format: json_object` with HTTP 400.
// Detect them so we can omit the flag and rely on the regex JSON extractor.
const REJECTS_JSON_MODE = /DeepSeek-V4|DeepSeek-R1|reasoner/i.test(SILICONFLOW_MODEL);
const BASE_URL = IS_DEEPSEEK_KEY ? 'https://api.deepseek.com/v1/chat/completions' : `${SILICONFLOW_BASE_URL}/chat/completions`;
// Print the active translation model once at startup so the pipeline log makes
// it obvious which model is really in use (a running process keeps the env it
// launched with — a .bat edit only applies after restart).
console.log(`[Translation] model=${SILICONFLOW_MODEL} | thinking=${IS_V4_THINKING_MODEL} | jsonMode=${!REJECTS_JSON_MODE} | endpoint=${BASE_URL}`);

const AI_MIN_INTERVAL_MS = 1000;
const AI_MAX_TOKENS = 800;
const AI_TEMPERATURE = 0.2;
const HARD_TITLE_MAX_CHARS = 140;

let lastAiCallAt = 0;
let consecutiveFailures = 0;
let consecutiveEmptyResponses = 0;
let circuitOpenUntil = 0;

/**
 * Detect SiliconFlow / DeepSeek "out of credit / insufficient balance" errors.
 * These are FATAL for a batch job: if we keep going, every remaining product is
 * skipped and left in its original Chinese. Callers should stop instead.
 * Plain rate-limits (RPM/TPM) are NOT treated as out-of-credit.
 */
function isOutOfCreditError(status, message, data) {
  if (status === 402) return true; // Payment Required
  let hay = String(message || '').toLowerCase();
  try { if (data) hay += ' ' + JSON.stringify(data).toLowerCase(); } catch {}
  if (/rate limit|requests per|\brpm\b|\btpm\b|too many requests/.test(hay)) return false;
  const needles = [
    'insufficient balance', 'insufficient_quota', 'insufficient funds',
    'not enough balance', 'balance is insufficient', 'no balance',
    'account balance', 'out of credit', 'no credit', 'arrears',
    'payment required', 'please recharge', 'top up', 'top-up',
    '余额不足', '余额', '欠费', '账户余额', '充值'
  ];
  return needles.some((n) => hay.includes(n));
}

/**
 * Call SiliconFlow API with V4-Flash specific optimizations
 */
async function callSiliconFlow(messages, maxTokens = AI_MAX_TOKENS) {
  if (!SILICONFLOW_API_KEY) {
    console.error(`  [AI ERROR] No API key configured`);
    return null;
  }
  if (Date.now() < circuitOpenUntil) {
    console.error(`  [AI ERROR] Circuit breaker open, skipping API call`);
    return null;
  }
  const now = Date.now();
  const waitForAi = AI_MIN_INTERVAL_MS - (now - lastAiCallAt);
  if (waitForAi > 0) {
    await new Promise((r) => setTimeout(r, waitForAi));
  }
  lastAiCallAt = Date.now();

  // Use a large max_tokens for V4-Flash reasoning models to avoid truncation.
  // DeepSeek-V4 often "thinks" for 2000+ tokens before providing the JSON answer.
  // Truncating reasoning results in "Empty content" and redundant/wasted retries.
  const effectiveMax = IS_V4_THINKING_MODEL ? Math.max(maxTokens, 4000) : maxTokens;
  const body = {
    model: IS_DEEPSEEK_KEY ? 'deepseek-v4-flash' : SILICONFLOW_MODEL,
    messages,
    temperature: AI_TEMPERATURE,
    max_tokens: effectiveMax,
    stream: false
  };
  // V4-Flash / V4-Pro / R1 reject `response_format: json_object` with HTTP 400.
  // We rely on the regex JSON extractor in translateProduct() instead.
  if (!REJECTS_JSON_MODE) {
    body.response_format = { type: 'json_object' };
  }
  // enable_thinking is also rejected by V4 models in some modes — only send it
  // for models that support it (non-V4 SiliconFlow models).
  if (!REJECTS_JSON_MODE) {
    body.enable_thinking = false;
  }

  const MAX_EMPTY_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_EMPTY_ATTEMPTS; attempt++) {
    try {
      const res = await axios.post(
        BASE_URL,
        body,
        { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SILICONFLOW_API_KEY}` }, timeout: 90000 }
      );
      consecutiveFailures = 0;
      const msg = res.data?.choices?.[0]?.message || {};
      const content = (typeof msg.content === 'string' ? msg.content : '').trim();
      const reasoning = (typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '').trim();
      const finishReason = res.data?.choices?.[0]?.finish_reason || '';

      if (!content) {
        console.warn(`  [AI] Empty content | status=${res.status} | finish=${finishReason} | reasoning_len=${reasoning.length} | attempt=${attempt}/${MAX_EMPTY_ATTEMPTS}`);
        consecutiveEmptyResponses++;
        if (consecutiveEmptyResponses >= 10) {
          circuitOpenUntil = Date.now() + 120_000;
          console.warn(`[AI] Circuit breaker opened (120s) after ${consecutiveEmptyResponses} consecutive empty responses`);
          return null;
        }
        if (attempt < MAX_EMPTY_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2500 * attempt));
          continue;
        }
        return null;
      }
      consecutiveEmptyResponses = 0;
      return content;
    } catch (err) {
      const errMsg = err?.response?.data?.error?.message || err?.response?.data?.message || err?.message || 'unknown error';
      const errStatus = err?.response?.status || 'no-status';
      // OUT OF CREDIT → fatal. Do NOT retry and do NOT return null (a null looks
      // like an ordinary per-product failure, so the caller would skip the
      // product and leave it in Chinese). Throw a tagged error so batch scripts
      // can stop cleanly and save a correct resume point.
      if (isOutOfCreditError(errStatus, errMsg, err?.response?.data)) {
        const fatal = new Error(`OUT_OF_CREDIT (HTTP ${errStatus}): ${errMsg}`);
        fatal.isOutOfCredit = true;
        throw fatal;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= 8) {
        circuitOpenUntil = Date.now() + 60_000;
        console.warn(`[AI] Circuit breaker opened (60s) after 8 failures — HTTP ${errStatus}: ${errMsg}`);
        return null;
      }
      if (attempt === MAX_EMPTY_ATTEMPTS) {
        console.error(`  [AI ERROR] HTTP ${errStatus} | ${errMsg}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    }
  }
  return null;
}

/**
 * Translate product from Chinese to Arabic and English
 * Includes brand extraction and authenticity check
 */
/**
 * Detect bad/garbled translations that should be rejected.
 * Catches patterns like: "M,, designed without...", "م،، مصمم بدون دعم يد...",
 * single-letter words, double punctuation, mixed-script artifacts, etc.
 */
export function isBadTranslation(text) {
  const t = String(text || '').trim();
  if (!t) return true;

  // Reject if contains double punctuation marks (,,, .., !!, ??, ;, etc.)
  if (/[,،]{2,}|[.!?;]{2,}/.test(t)) return true;

  // Reject if contains isolated single Latin letters (likely artifacts like "M,," or "a,")
  // Match a single Latin letter surrounded by non-Latin or punctuation/space boundaries.
  if (/\b[a-zA-Z]\b/.test(t)) return true;

  // Reject if contains sequences of Arabic letters mixed with Latin in a single token
  // e.g. "مM" or "Mم" — indicates encoding/translation glitch
  if (/[\u0600-\u06FF][a-zA-Z]|[a-zA-Z][\u0600-\u06FF]/.test(t)) return true;

  // Reject if more than 40% of "words" are single characters (excluding digits)
  const words = t.split(/\s+/).filter((w) => w.length > 0);
  if (words.length >= 3) {
    const singleCharWords = words.filter((w) => w.length === 1 && !/^\d$/.test(w)).length;
    if (singleCharWords / words.length > 0.4) return true;
  }

  // Reject if contains runs of 3+ identical characters (e.g. "mmm", "111")
  if (/(.)\1{2,}/.test(t.replace(/[0-9]/g, ''))) return true;

  return false;
}

export async function translateProduct(chineseName, chineseDescription) {
  const sourceName = String(chineseName || '').trim().slice(0, 200);
  const sourceDesc = String(chineseDescription || chineseName || '').trim().slice(0, 800);
  if (!sourceName && !sourceDesc) return null;

  // Show which model is doing the translation (both the pipeline and the audit
  // script route through here, so this one line covers both).
  console.log(`[Translation] model=${SILICONFLOW_MODEL} → translating: ${sourceName.slice(0, 45)}`);

  const messages = [
    {
      role: 'system',
      content:
        'You are an e-commerce translation assistant. ' +
        'Given the product info below (originally in Chinese), produce a JSON object with FOUR fields:\n' +
        '  "titleAr"  — Arabic product name, max 8 words\n' +
        '  "descriptionAr" — Arabic product description, max 2 sentences\n' +
        '  "titleEn"  — English product name, max 8 words\n' +
        '  "titleEnSimple" — a SHORT, CLEAN, GENERIC English noun phrase naming what the product IS, ' +
        '2-4 words, suitable for semantic search. ' +
        'NO brand names, NO model numbers, NO sizes, NO wattage, NO specs, NO punctuation. ' +
        'Examples: "electric water heater", "wireless bluetooth earbuds", "stainless steel water bottle", "cotton t-shirt".\n' +
        'Output ONLY valid JSON. No other text. Skip all preamble and reasoning.'
    },
    {
      role: 'user',
      content:
        `Chinese name: ${sourceName}\n` +
        `Chinese description: ${sourceDesc}\n` +
        'Translate to Arabic and English. JSON ONLY. NO PREAMBLE. NO REASONING.'
    }
  ];

  // Reasoning models (V4-Flash etc.) need huge budgets for their discarded
  // "thinking"; non-reasoning models (DeepSeek-V3) emit only the JSON answer
  // (~100-130 tokens), so cap tightly to bound worst-case output cost.
  const maxTokensForCall = IS_V4_THINKING_MODEL ? 4000 : 400;
  const result = await callSiliconFlow(messages, maxTokensForCall);
  if (!result) return null;

  try {
    // V4-Flash may emit a <think>...</think> block in the content. Strip it
    // before searching for JSON so the JSON regex doesn't anchor on braces
    // inside the think block.
    const cleaned = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`  [AI] No JSON found in response for "${sourceName.slice(0, 50)}..." — raw: ${cleaned.slice(0, 120)}`);
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    const titleAr = String(parsed.titleAr || '').trim().slice(0, HARD_TITLE_MAX_CHARS);
    const descriptionAr = String(parsed.descriptionAr || '').trim().slice(0, 1500) || null;
    let titleEn = String(parsed.titleEn || '').trim().slice(0, HARD_TITLE_MAX_CHARS) || null;
    // Clean generic English noun phrase used ONLY for the text embedding
    // (e.g. "electric water heater"). Falls back to titleEn if the model
    // omitted it.
    let titleEnSimple = String(parsed.titleEnSimple || '').trim().slice(0, HARD_TITLE_MAX_CHARS) || null;

    // The English name drives the search text embedding, so it must NOT be null
    // when the model produced any English. If the model returned only one of the
    // two English fields, cross-fill the other from it.
    if (!titleEn && titleEnSimple) titleEn = titleEnSimple;
    if (!titleEnSimple && titleEn) titleEnSimple = titleEn;

    if (!titleAr) return null;

    return { titleAr, descriptionAr, titleEn, titleEnSimple };
  } catch (e) {
    console.error(`  [AI] JSON parse failed: ${e.message}`);
    return null;
  }
}
