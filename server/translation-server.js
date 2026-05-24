const express = require('express');
const cors = require('cors');
const { AutoTokenizer, AutoModelForSeq2SeqLM } = require('@huggingface/transformers');

const app = express();
app.use(cors());
app.use(express.json());

let model = null;
let tokenizer = null;
const MODEL_NAME = 'facebook/nllb-200-distilled-1.3B';

// Language code mapping
const LANG_CODES = {
  'ar': 'arb_Arab',
  'arabic': 'arb_Arab',
  'zh': 'zho_Hans',
  'chinese': 'zho_Hans',
  'en': 'eng_Latn',
  'english': 'eng_Latn',
};

async function loadModel() {
  console.log('[Translation Server] Loading NLLB model...');
  try {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_NAME);
    model = await AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME, {
      dtype: 'q8', // Use quantization to reduce memory usage
    });
    console.log('[Translation Server] Model loaded successfully!');
  } catch (error) {
    console.error('[Translation Server] Failed to load model:', error);
    throw error;
  }
}

function getLangCode(lang) {
  const normalized = lang.toLowerCase().trim();
  return LANG_CODES[normalized] || normalized;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', modelLoaded: model !== null });
});

app.post('/api/translate', async (req, res) => {
  if (!model || !tokenizer) {
    return res.status(503).json({ error: 'Model not loaded yet' });
  }

  const { text, from, to } = req.body;

  if (!text || !from || !to) {
    return res.status(400).json({ error: 'Missing required fields: text, from, to' });
  }

  try {
    const sourceLang = getLangCode(from);
    const targetLang = getLangCode(to);

    tokenizer.src_lang = sourceLang;
    const encoded = tokenizer(text, { return_tensors: 'pt' });
    const generated = await model.generate({
      ...encoded,
      forced_bos_token_id: tokenizer.lang_code_to_id[targetLang],
      max_length: 512,
    });
    const translated = tokenizer.batch_decode(generated, { skip_special_tokens: true })[0];

    res.json({
      text: translated,
      from: sourceLang,
      to: targetLang,
    });
  } catch (error) {
    console.error('[Translation Server] Translation error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.TRANSLATION_PORT || 5002;

// Load model and start server
loadModel().then(() => {
  app.listen(PORT, () => {
    console.log(`[Translation Server] Running on port ${PORT}`);
    console.log(`[Translation Server] Health check: http://localhost:${PORT}/health`);
    console.log(`[Translation Server] Translate endpoint: http://localhost:${PORT}/api/translate`);
  });
}).catch((error) => {
  console.error('[Translation Server] Failed to start:', error);
  process.exit(1);
});
