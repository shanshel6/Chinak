const https = require('https');

const API_KEY = 'sk-7b6193a7cfe348c8b3dea6d0c1248482';

function test(model, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false, enable_thinking: false });
    const url = new URL('https://api.siliconflow.com/v1/chat/completions');
    const options = {
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000
    };
    const started = Date.now();
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const elapsed = Date.now() - started;
        try {
          const parsed = JSON.parse(body);
          const content = parsed.choices?.[0]?.message?.content || '';
          const reasoning = parsed.choices?.[0]?.message?.reasoning_content || '';
          const finish = parsed.choices?.[0]?.finish_reason || '';
          resolve({ status: res.statusCode, elapsed, content, reasoning: reasoning.slice(0, 100), finish, error: parsed.error });
        } catch { resolve({ status: res.statusCode, elapsed, raw: body.slice(0, 200) }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout after 30s')); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const testMsg = [{ role: 'user', content: 'Extract the product name from: 源头工厂直销（电箱款吉他）马丁D100全单板复刻民谣吉他. Reply with just the product name in Arabic.' }];

  const models = [
    { name: 'Qwen/Qwen3.5-9B', tokens: 500 },
    { name: 'Qwen/Qwen3-8B', tokens: 500 },
    { name: 'Qwen/Qwen2.5-7B-Instruct', tokens: 500 },
  ];

  for (const m of models) {
    console.log(`\n=== Testing ${m.name} (max_tokens=${m.tokens}) ===`);
    try {
      const r = await test(m.name, testMsg, m.tokens);
      console.log(`Status: ${r.status}, Time: ${r.elapsed}ms`);
      console.log(`Finish: ${r.finish}`);
      console.log(`Content: "${r.content}"`);
      if (r.reasoning) console.log(`Reasoning: "${r.reasoning}..."`);
      if (r.error) console.log(`Error: ${JSON.stringify(r.error)}`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
}

main().then(() => console.log('\nDone.'));
