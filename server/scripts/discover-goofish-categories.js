const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const prisma = new PrismaClient();

const OUTPUT_FILE = path.join(__dirname, 'goofish-category-discoveries.json');

// Load existing discoveries so we don't re-process known ones
function loadDiscoveries() {
  try {
    if (fs.existsSync(OUTPUT_FILE)) {
      return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveDiscoveries(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
}

async function callSiliconFlowLLM(messages, options = {}) {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || '').trim();
  if (!apiKey) throw new Error('No SILICONFLOW_API_KEY');
  const sfModel = options.model || process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B';
  const res = await axios.post(
    'https://api.siliconflow.com/v1/chat/completions',
    {
      model: sfModel,
      messages,
      max_tokens: options.maxTokens || 100,
      temperature: options.temperature ?? 0.1,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: options.timeoutMs || 15000,
    }
  );
  return res.data?.choices?.[0]?.message?.content || '';
}

// Load canonical categories for LLM to pick from
function loadCanonicalSlugs() {
  try {
    const seedPath = path.join(__dirname, 'canonical-categories.seed.json');
    const cats = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    return cats.map(c => ({ slug: c.slug, name_ar: c.name_ar, aliases: c.aliases || [] }));
  } catch {
    return [];
  }
}

async function main() {
  const discoveries = loadDiscoveries();
  const canonicalCategories = loadCanonicalSlugs();
  const canonicalSlugs = canonicalCategories.map(c => c.slug).join(', ');

  console.log(`Loaded ${canonicalCategories.length} canonical categories.`);

  // Find all products that have a goofishCategoryId we haven't discovered yet
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      "aiMetadata"->>'goofishCategoryId' AS "categoryId",
      "aiMetadata"->>'originalTitle' AS "title",
      name
    FROM "Product"
    WHERE "aiMetadata"->>'goofishCategoryId' IS NOT NULL
      AND "aiMetadata"->>'goofishCategoryId' != ''
    ORDER BY "aiMetadata"->>'goofishCategoryId', "createdAt" DESC
  `);

  // Group by categoryId, collect up to 8 titles per ID
  const byId = new Map();
  for (const row of rows) {
    const id = row.categoryId;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    const titles = byId.get(id);
    if (titles.length < 8) {
      titles.push(row.title || row.name || '');
    }
  }

  let processed = 0;
  for (const [categoryId, titles] of byId) {
    if (discoveries[categoryId]?.status === 'confirmed') {
      console.log(`Skipping confirmed: ${categoryId} -> ${discoveries[categoryId].slug}`);
      continue;
    }

    const sampleTitles = titles.filter(Boolean).slice(0, 8);
    if (sampleTitles.length === 0) continue;

    console.log(`\n[${categoryId}] Analyzing ${sampleTitles.length} product titles...`);
    sampleTitles.forEach((t, i) => console.log(`  ${i + 1}. ${t.slice(0, 80)}`));

    const prompt = `/no_think
You are an e-commerce category classifier. Given product titles from a Chinese marketplace, determine the best broad category.

Available categories (pick EXACTLY one slug):
${canonicalSlugs}

Product titles from this category:
${sampleTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY a valid JSON object:
{"slug": "<one_from_list_above>", "reason": "<brief_reason>"}
No other text.`;

    try {
      const text = await callSiliconFlowLLM(
        [{ role: 'user', content: prompt }],
        { maxTokens: 150, timeoutMs: 20000 }
      );

      const cleanJson = text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .replace(/^[^{]*/, '')
        .replace(/[^}]*$/, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      const slug = parsed?.slug?.trim();

      // Validate against known categories
      const isValid = canonicalCategories.some(c => c.slug === slug);

      discoveries[categoryId] = {
        status: isValid ? 'suggested' : 'invalid',
        slug: isValid ? slug : null,
        reason: parsed?.reason || '',
        sampleTitles,
        suggestedAt: new Date().toISOString(),
      };

      if (isValid) {
        console.log(`  -> SUGGESTED: ${slug} (${parsed.reason})`);
      } else {
        console.log(`  -> INVALID suggestion: "${slug}" — not in canonical list`);
      }

      processed++;
      if (processed % 5 === 0) saveDiscoveries(discoveries);
    } catch (err) {
      console.log(`  -> ERROR: ${err.message}`);
      discoveries[categoryId] = {
        status: 'error',
        error: err.message,
        sampleTitles,
        attemptedAt: new Date().toISOString(),
      };
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  saveDiscoveries(discoveries);

  // Print summary
  const suggested = Object.entries(discoveries).filter(([_, v]) => v.status === 'suggested');
  const confirmed = Object.entries(discoveries).filter(([_, v]) => v.status === 'confirmed');
  const pending = Object.entries(discoveries).filter(([_, v]) => v.status !== 'confirmed');

  console.log(`\n========== DISCOVERY SUMMARY ==========`);
  console.log(`Confirmed mappings:  ${confirmed.length}`);
  console.log(`Suggested mappings:  ${suggested.length}`);
  console.log(`Pending/invalid:     ${pending.length}`);

  if (suggested.length > 0) {
    console.log(`\nSuggested mappings to review:`);
    for (const [id, data] of suggested) {
      console.log(`  ['${id}', '${data.slug}'],  // ${data.reason}`);
    }
    console.log(`\nAdd the ones you agree with to GOOFISH_CATEGORY_ID_MAP in all 3 files.`);
  }

  console.log(`\nFull results saved to: ${OUTPUT_FILE}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
