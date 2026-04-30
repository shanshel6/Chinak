import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

let deepinfra = null;
let siliconflow = null;
let genAI = null;

function initLLM() {
  if (deepinfra || siliconflow || genAI) return { deepinfra, siliconflow, genAI };
  
  if (process.env.DEEPINFRA_API_KEY) {
    deepinfra = new OpenAI({
      baseURL: "https://api.deepinfra.com/v1/openai",
      apiKey: process.env.DEEPINFRA_API_KEY,
    });
  }
  
  if (process.env.SILICONFLOW_API_KEY) {
    siliconflow = new OpenAI({
      baseURL: "https://api.siliconflow.com/v1",
      apiKey: process.env.SILICONFLOW_API_KEY,
    });
  }
  
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  
  return { deepinfra, siliconflow, genAI };
}

async function testGenerateMissingCategory(productName) {
  const { deepinfra, siliconflow, genAI } = initLLM();
  if (!deepinfra && !siliconflow && !genAI) {
    console.warn('No LLM configured');
    return null;
  }
  
  try {
    const prompt = `We need to categorize a product, but it does not fit our existing categories.
Product name: "${productName}"
Please suggest a brand-new, broad e-commerce category that fits this product.
Return ONLY a valid JSON object with:
- "slug": snake_case english category name (e.g. "drones", "action_cameras", "bedding_sets")
- "name_ar": The Arabic translation of the category (e.g. "طائرات بدون طيار", "كاميرات رياضية", "أطقم مفارش سرير")
- "english_name": The plain English name of the category (e.g. "Drones", "Action Cameras", "Bedding Sets")

Do not include any other text or markdown, just the JSON object.`;

    let text = "";
    let usedDeepInfra = false;
    let usedSiliconFlow = false;
    
    if (deepinfra) {
      try {
        console.log("Using DeepInfra...");
        const response = await deepinfra.chat.completions.create({
          model: process.env.DEEPINFRA_MODEL || 'meta-llama/Meta-Llama-3-70B-Instruct',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        });
        text = response.choices[0].message.content.trim();
        usedDeepInfra = true;
      } catch (err) {
        console.log(`DeepInfra failed (${err.message}). Falling back to next provider...`);
      }
    }
    
    if (!usedDeepInfra && siliconflow) {
      try {
        console.log("Using SiliconFlow...");
        const response = await siliconflow.chat.completions.create({
          model: 'Qwen/Qwen2.5-7B-Instruct',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        });
        text = response.choices[0].message.content.trim();
        usedSiliconFlow = true;
      } catch (err) {
        console.log(`SiliconFlow failed (${err.message}). Falling back to Gemini...`);
      }
    }
    
    if (!usedDeepInfra && !usedSiliconFlow && genAI) {
      console.log("Using Gemini...");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      text = result.response.text().trim();
    }

    console.log("Raw LLM Response:", text);
    const cleanJson = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const data = JSON.parse(cleanJson);
    console.log("Parsed JSON:", data);
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
  return null;
}

testGenerateMissingCategory("درونز DJI ميني 4K").then(() => console.log("Done"));