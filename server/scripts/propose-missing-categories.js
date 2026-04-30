import prisma from '../prismaClient.js';
import { canonicalCategories } from '../services/categoryCanonicalService.js';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const proposalPath = path.join(__dirname, '.assign-canonical-categories.proposals.json');

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Setup AI client based on available keys
let aiProvider = null;
let openai = null;
let gemini = null;

if (process.env.GEMINI_API_KEY) {
  aiProvider = 'gemini';
  gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else if (process.env.OPENAI_API_KEY) {
  aiProvider = 'openai';
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} else if (process.env.SILICONFLOW_API_KEY) {
  aiProvider = 'siliconflow';
  openai = new OpenAI({
    apiKey: process.env.SILICONFLOW_API_KEY,
    baseURL: 'https://api.siliconflow.cn/v1',
  });
} else if (process.env.DEEPINFRA_API_KEY) {
  aiProvider = 'deepinfra';
  openai = new OpenAI({
    apiKey: process.env.DEEPINFRA_API_KEY,
    baseURL: 'https://api.deepinfra.com/v1/openai',
  });
}

async function getAiResponse(prompt) {
  if (aiProvider === 'gemini') {
    const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } else if (['openai', 'siliconflow', 'deepinfra'].includes(aiProvider)) {
    const modelName = aiProvider === 'siliconflow' ? 'Qwen/Qwen2.5-72B-Instruct' : 
                      aiProvider === 'deepinfra' ? 'meta-llama/Meta-Llama-3-70B-Instruct' : 'gpt-4o-mini';
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    return response.choices[0].message.content.trim();
  }
  throw new Error("No valid AI provider found. Please add GEMINI_API_KEY or OPENAI_API_KEY to server/.env");
}

async function generateMissingCategories() {
  console.log('🔍 Scanning database for products with missing/uncertain categories...');

  // Find products that were forced into 'other' or had a very low score (< 25%)
  const uncertainProducts = await prisma.product.findMany({
    where: {
      OR: [
        { aiMetadata: { path: ['categorySlug'], equals: 'other' } },
        { aiMetadata: { path: ['categoryScore'], lt: 25 } }
      ]
    },
    select: {
      id: true,
      name: true,
      aiMetadata: true,
    },
    take: 50 // Limit to 50 to avoid huge context windows
  });

  if (uncertainProducts.length === 0) {
    console.log('✅ No uncertain products found! The current categories seem to be covering everything well.');
    return;
  }

  console.log(`📦 Found ${uncertainProducts.length} products that need better categories. Analyzing...`);

  // Extract names and original categories to feed to the AI
  const productDetails = uncertainProducts.map(p => {
    const meta = typeof p.aiMetadata === 'string' ? JSON.parse(p.aiMetadata) : (p.aiMetadata || {});
    return `- Product: "${p.name}" (Original Source Category: ${meta.sourceCategory || 'Unknown'})`;
  }).join('\n');

  // Extract current top-level categories to give the AI context of where to place things
  const topLevelCategories = canonicalCategories
    .filter(c => !c.parentSlug)
    .map(c => `${c.slug} (${c.name_ar})`)
    .join(', ');

  const prompt = `
You are an expert e-commerce catalog manager. 
We have a list of products that our system couldn't confidently place into our existing categories.
Based on the products below, propose NEW categories that we should add to our database.

Here are the existing Top-Level Parent Categories you must choose from for 'parentSlug':
${topLevelCategories}

Here are the products that need new categories:
${productDetails}

Your task:
1. Group these products into logical new sub-categories.
2. Provide a JSON array of the proposed categories.
3. Each category must have:
   - "slug": A unique English slug (e.g., "smart_watches")
   - "name_ar": The Arabic name of the category (e.g., "ساعات ذكية")
   - "parentSlug": The slug of the most appropriate Top-Level Parent Category from the list above.
   - "aliases": An array of 3-5 alternative names in Arabic and English (e.g., ["ساعة ذكية", "smart watch", "ساعات"]).
   - "status": Always set this to "approved".

Return ONLY a valid JSON array. Do not include markdown formatting or explanations.
Example output:
[
  {
    "slug": "smart_watches",
    "name_ar": "ساعات ذكية",
    "parentSlug": "electronics_mobile",
    "aliases": ["ساعة ذكية", "smart watch", "ساعات"],
    "status": "approved"
  }
]
`;

  try {
    console.log(`🧠 Asking AI (${aiProvider}) to generate missing categories based on these products...`);
    
    let resultText = await getAiResponse(prompt);
    
    // Clean up markdown if the AI ignored instructions
    if (resultText.startsWith('```json')) {
      resultText = resultText.replace(/^```json\n/, '').replace(/\n```$/, '');
    }

    const proposedCategories = JSON.parse(resultText);

    if (!Array.isArray(proposedCategories) || proposedCategories.length === 0) {
      console.log('⚠️ AI did not return any new categories.');
      return;
    }

    // Load existing proposals to append to them
    let existingProposals = [];
    if (fs.existsSync(proposalPath)) {
      existingProposals = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
    }

    // Add new proposals
    const newProposals = [];
    for (const newCat of proposedCategories) {
      // Check if it already exists in proposals
      if (!existingProposals.some(p => p.slug === newCat.slug)) {
        existingProposals.push(newCat);
        newProposals.push(newCat);
      }
    }

    if (newProposals.length > 0) {
      fs.writeFileSync(proposalPath, JSON.stringify(existingProposals, null, 2));
      console.log(`🎉 Successfully generated ${newProposals.length} NEW categories!`);
      newProposals.forEach(c => console.log(`  - ${c.name_ar} (${c.slug}) -> Parent: ${c.parentSlug}`));
      console.log(`\n💡 To merge these into the live database, run:`);
      console.log(`   node server/scripts/merge-approved-category-proposals.js`);
    } else {
      console.log('✅ AI proposed categories that have already been proposed recently.');
    }

  } catch (error) {
    console.error('❌ Error generating categories:', error.message);
  }
}

generateMissingCategories()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
