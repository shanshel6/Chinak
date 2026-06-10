const axios = require('axios');

const API_KEY = 'sk-crnipdimfvvgrbbxtvmbrshaqtjdmujbvkpuoifcdxkcalwh';

async function test() {
  // Test 1: Simple hi with enough tokens
  console.log('=== Test 1: Simple hi with max_tokens=100 ===');
  try {
    const r = await axios.post(
      'https://api.siliconflow.com/v1/chat/completions',
      {
        model: 'Qwen/Qwen3.5-9B',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.1
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000,
        proxy: false
      }
    );
    const choice = r.data.choices[0];
    console.log('Status:', r.status);
    console.log('finish_reason:', choice.finish_reason);
    console.log('content:', JSON.stringify(choice.message.content));
    console.log('reasoning_content:', JSON.stringify(choice.message.reasoning_content || '').slice(0, 200));
  } catch (e) {
    console.error('Error:', e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0,300)}` : e.message);
  }

  // Test 2: Translation prompt (same as generateTitleAndKeywords uses)
  console.log('\n=== Test 2: Translation prompt ===');
  try {
    const r = await axios.post(
      'https://api.siliconflow.com/v1/chat/completions',
      {
        model: 'Qwen/Qwen3.5-9B',
        messages: [
          {
            role: 'system',
            content: 'You are a Chinese to Arabic translator. Translate the given Chinese text to Arabic. Return Arabic only.'
          },
          {
            role: 'user',
            content: '小米充电宝 20000毫安 45W 快充'
          }
        ],
        max_tokens: 200,
        temperature: 0.1
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000,
        proxy: false
      }
    );
    const choice = r.data.choices[0];
    console.log('Status:', r.status);
    console.log('finish_reason:', choice.finish_reason);
    console.log('content:', JSON.stringify(choice.message.content));
    console.log('reasoning_content:', JSON.stringify(choice.message.reasoning_content || '').slice(0, 200));
  } catch (e) {
    console.error('Error:', e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0,300)}` : e.message);
  }

  // Test 3: JSON mode prompt (like generateTitleAndKeywords)
  console.log('\n=== Test 3: JSON mode prompt ===');
  try {
    const r = await axios.post(
      'https://api.siliconflow.com/v1/chat/completions',
      {
        model: 'Qwen/Qwen3.5-9B',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Respond with valid JSON only.'
          },
          {
            role: 'user',
            content: 'Given the product title "2026新款时尚百搭内增高单鞋女真皮方头浅口软底舒适休闲鞋", generate a JSON object with keys: titleAr, descriptionAr. Translate to Arabic. Return JSON only.'
          }
        ],
        max_tokens: 500,
        temperature: 0.25
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000,
        proxy: false
      }
    );
    const choice = r.data.choices[0];
    console.log('Status:', r.status);
    console.log('finish_reason:', choice.finish_reason);
    console.log('content:', choice.message.content);
    console.log('reasoning_content:', JSON.stringify(choice.message.reasoning_content || '').slice(0, 200));
  } catch (e) {
    console.error('Error:', e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0,300)}` : e.message);
  }
}

test();
