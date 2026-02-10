const axios = require('axios');

async function debug1688Response() {
  try {
    const url = "https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597ILkD6H&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:90364718&beginPage=1";
    
    console.log("🔍 Debugging 1688 response...");
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      timeout: 10000,
      validateStatus: null // Don't throw on error status
    });
    
    console.log("📊 RESPONSE INFO:");
    console.log("Status:", response.status);
    console.log("Status Text:", response.statusText);
    console.log("Content Type:", response.headers['content-type']);
    console.log("Content Length:", response.headers['content-length'] || 'Unknown');
    
    console.log("\n📄 FIRST 200 CHARACTERS:");
    console.log(response.data.substring(0, 200));
    
    console.log("\n🔍 CHECKING FOR REDIRECTS:");
    if (response.request?.res?.responseUrl && response.request.res.responseUrl !== url) {
      console.log("🔄 Redirected to:", response.request.res.responseUrl);
    } else {
      console.log("✅ No redirect detected");
    }
    
    console.log("\n🔍 CHECKING FOR COMMON BLOCKING PATTERNS:");
    const dataStr = response.data.toString();
    
    if (dataStr.includes('captcha') || dataStr.includes('验证码')) {
      console.log("❌ CAPTCHA detected");
    }
    if (dataStr.includes('robot') || dataStr.includes('机器人')) {
      console.log("❌ Robot check detected");
    }
    if (dataStr.includes('javascript') && dataStr.includes('enable')) {
      console.log("❌ JavaScript requirement detected");
    }
    if (dataStr.includes('security') || dataStr.includes('安全')) {
      console.log("❌ Security check detected");
    }
    
    console.log("\n📊 RESPONSE LENGTH:", dataStr.length, "characters");
    
    if (dataStr.length < 1000) {
      console.log("\n📄 FULL RESPONSE:");
      console.log(dataStr);
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.response) {
      console.log("Response Status:", error.response.status);
      console.log("Response Headers:", error.response.headers);
    }
  }
}

debug1688Response();