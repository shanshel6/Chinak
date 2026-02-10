const axios = require('axios');
const fs = require('fs');
const vm = require('vm');
const cheerio = require('cheerio');

const url = "https://detail.1688.com/offer/769706957407.html";

async function run() {
  console.log('Fetching ' + url);
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://list.1688.com/'
      }
    });
    
    fs.writeFileSync('debug-1688-page.html', response.data);
    console.log('Saved to debug-1688-page.html');
    
    const $ = cheerio.load(response.data);
    
    // Check for patterns
    const hasInitData = response.data.includes('window.__INIT_DATA');
    const hasIDetailData = response.data.includes('iDetailData');
    const hasWindowContext = response.data.includes('window.context');
    
    console.log('Has window.__INIT_DATA:', hasInitData);
    console.log('Has iDetailData:', hasIDetailData);
    console.log('Has window.context:', hasWindowContext);
    
    if (hasWindowContext) {
       console.log('Attempting to extract window.context using VM...');
       
       let scriptContent = null;
       $('script').each((i, el) => {
         const content = $(el).html();
         if (content && content.includes('window.context') && content.includes('function(b,d)')) {
           scriptContent = content;
           console.log('Found script tag, length:', content.length);
         }
       });

       if (scriptContent) {
         const sandbox = { 
           window: { 
             contextPath: "/default",
             context: null 
           },
           document: { createElement: () => ({}) },
           location: { href: '' },
           navigator: { userAgent: '' }
         };
         
         try {
           vm.runInNewContext(scriptContent, sandbox);
           const contextData = sandbox.window.context;
           
           if (contextData) {
               console.log('VM Execution Successful!');
               console.log('Result keys:', Object.keys(contextData));
               
               if (contextData.result && contextData.result.data) {
                   const data = contextData.result.data;
                   console.log('Data keys:', Object.keys(data));
                   console.log('Subject:', data.subject || data.productPackInfo?.fields?.subject);
                   console.log('Price:', data.priceInfo?.price || data.skuModel?.skuPriceScale);
                   
                   // Check for productAttributes
                           if (data.productAttributes) {
                               console.log('productAttributes found:', JSON.stringify(data.productAttributes, null, 2));
                           }
                           
                           if (data.skuSelection) {
                               console.log('skuSelection found:', JSON.stringify(data.skuSelection, null, 2));
                           }
                           
                           if (data.productPackInfo) {
                               console.log('productPackInfo found:', JSON.stringify(data.productPackInfo, null, 2));
                           }

                   // Check variants
                   if (data.skuModel && data.skuModel.skuProps) {
                       console.log('Variants found:', data.skuModel.skuProps.map(p => p.propName));
                   }
               }
           } else {
               console.log('VM executed but window.context is null');
           }
         } catch(e) {
             console.log('VM Error:', e.message);
         }
       } else {
           console.log('Could not find script tag containing window.context logic');
       }
    }
    
  } catch (e) {
    console.error(e);
  }
}

run();
