import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');
const envPath = path.join(serverDir, '.env');
dotenv.config({ path: envPath });

const deepInfraKey = process.env.DEEPINFRA_API_KEY || '';
const deepInfraModel = process.env.DEEPINFRA_TRANSLATION_MODEL || process.env.DEEPINFRA_MODEL || 'google/gemma-3-12b-it';
const deepInfraUrl = process.env.DEEPINFRA_TRANSLATION_API_URL || 'https://api.deepinfra.com/v1/openai/chat/completions';
const sourceFile = path.join(serverDir, '..', 'example.txt');
const outputFile = path.join(serverDir, 'data', 'taobao_categories_zh.json');

if (!deepInfraKey) {
  console.error('DEEPINFRA_API_KEY is missing');
  process.exit(1);
}
if (!fs.existsSync(sourceFile)) {
  console.error('example.txt not found:', sourceFile);
  process.exit(1);
}
const raw = fs.readFileSync(sourceFile, 'utf8');
const pattern = /"Id"\s*:\s*"([^"]+)"[\s\S]{0,220}?"ProviderType"\s*:\s*"Taobao"[\s\S]{0,220}?"Name"\s*:\s*"([^"]+)"/g;
const map = new Map();
let match = pattern.exec(raw);
while (match) {
  const id = String(match[1] || '').trim();
  const name = String(match[2] || '').replace(/\s+/g, ' ').trim();
  if (id && name && /^(otc-\d+|\d+)$/.test(id) && !map.has(id)) {
    map.set(id, { id, name });
  }
  match = pattern.exec(raw);
}
const categories = Array.from(map.values());
if (categories.length === 0) {
  console.error('No categories found in example.txt');
  process.exit(1);
}

const translateBatch = async (batch) => {
  const payload = batch.map((entry) => `${entry.id} | ${entry.name}`).join('\n');
  const response = await axios.post(deepInfraUrl, {
    model: deepInfraModel,
    messages: [
      {
        role: 'system',
        content: 'Translate each category name to Simplified Chinese. Keep the same id. Return lines in format: id | ChineseName.'
      },
      {
        role: 'user',
        content: payload
      }
    ],
    temperature: 0
  }, {
    headers: {
      Authorization: `Bearer ${deepInfraKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 25000
  });
  const content = String(
    response?.data?.choices?.[0]?.message?.content
    || response?.data?.results?.[0]?.generated_text
    || response?.data?.generated_text
    || ''
  ).trim();
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const results = [];
  lines.forEach((line) => {
    const lineMatch = line.match(/^\s*(otc-\d+|\d+)\s*\|\s*(.+)\s*$/i);
    if (lineMatch) {
      const id = String(lineMatch[1]).trim();
      const name = String(lineMatch[2]).trim();
      if (id && name) {
        results.push({ id, name });
      }
    }
  });
  return results;
};

const run = async () => {
  const chunkSize = 60;
  const translated = [];
  for (let i = 0; i < categories.length; i += chunkSize) {
    const batch = categories.slice(i, i + chunkSize);
    const batchResult = await translateBatch(batch);
    translated.push(...batchResult);
  }
  const unique = new Map();
  translated.forEach((entry) => {
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
  });
  const finalList = Array.from(unique.values());
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(finalList, null, 2));
  console.log(`Saved ${finalList.length} categories to ${outputFile}`);
};

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
