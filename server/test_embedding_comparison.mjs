
import { AutoTokenizer, CLIPTextModelWithProjection } from '@xenova/transformers';

async function testEmbedding() {
  const MODEL_ID = 'Xenova/clip-vit-base-patch32';
  const query = 'High-Pressure Drain Unclogging Tool One Shot';
  
  console.log('Loading models...');
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });
  
  console.log('Generating embedding for:', query);
  const inputs = await tokenizer(query, { padding: true, truncation: true });
  console.log('Tokenized input:', inputs);
  
  const outputs = await textModel(inputs);
  const embedding = Array.from(outputs.text_embeds.data);
  
  // Normalize the embedding
  let norm = 0;
  for (const v of embedding) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  const normalized = embedding.map(v => v / norm);
  
  console.log('Embedding (first 10 values):', normalized.slice(0, 10));
  console.log('Embedding length:', normalized.length);
}

testEmbedding().catch(console.error);
