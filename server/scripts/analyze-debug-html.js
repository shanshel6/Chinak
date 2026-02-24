import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
    const htmlPath = path.join(__dirname, '../../debug_taobao.html');
    if (!fs.existsSync(htmlPath)) {
        console.error('File not found:', htmlPath);
        process.exit(1);
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    const regex = /window\.__ICE_APP_CONTEXT__\s*=\s*(\{[\s\S]*?\});/
    const match = html.match(regex);
    
    if (match) {
        console.log('Found __ICE_APP_CONTEXT__ via regex');
        // ... (rest of logic)
    } else {
        console.log('__ICE_APP_CONTEXT__ regex not matched. Trying brace counting.');
        const idx = html.indexOf('window.__ICE_APP_CONTEXT__');
        if (idx !== -1) {
            // Look for the start of the JSON object after this index
            // The pattern seems to be: ... window.__ICE_APP_CONTEXT__ || {};var b = { ...
            const startSearch = idx + 'window.__ICE_APP_CONTEXT__'.length;
            const openBraceIdx = html.indexOf('{', startSearch); // First { after context reference might be inside || {}; 
            
            // Wait, "|| {};" has a brace.
            // We want the brace after "var b = "
            // Let's find "var [a-z] = {"
            
            const varPattern = /var\s+[a-zA-Z0-9_]+\s*=\s*\{/;
            const snippet = html.substring(startSearch, startSearch + 100);
            const varMatch = snippet.match(varPattern);
            
            if (varMatch) {
                const jsonStart = startSearch + varMatch.index + varMatch[0].length - 1; // -1 to include {
                console.log('JSON starts at', jsonStart);
                
                let balance = 0;
                let jsonEnd = -1;
                let inString = false;
                let escape = false;
                
                for (let i = jsonStart; i < html.length; i++) {
                    const char = html[i];
                    
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    
                    if (char === '\\') {
                        escape = true;
                        continue;
                    }
                    
                    if (char === '"') {
                        inString = !inString;
                        continue;
                    }
                    
                    if (!inString) {
                        if (char === '{') {
                            balance++;
                        } else if (char === '}') {
                            balance--;
                            if (balance === 0) {
                                jsonEnd = i + 1;
                                break;
                            }
                        }
                    }
                }
                
                if (jsonEnd !== -1) {
                    const jsonStr = html.substring(jsonStart, jsonEnd);
                    console.log('Extracted JSON length:', jsonStr.length);
                    try {
                        const data = JSON.parse(jsonStr);
                        console.log('Successfully parsed JSON!');
                        console.log('Keys:', Object.keys(data));
                        if (data.loaderData) {
                             console.log('loaderData keys:', Object.keys(data.loaderData));
                             if (data.loaderData.home && data.loaderData.home.data) {
                                 console.log('loaderData.home.data keys:', Object.keys(data.loaderData.home.data));
                                 if (data.loaderData.home.data.res) {
                                      console.log('loaderData.home.data.res keys:', Object.keys(data.loaderData.home.data.res));
                                 }
                             }
                             console.log('loaderData content (first 500 chars):', JSON.stringify(data.loaderData).substring(0, 500));
                        }
                        if (data.appData) {
                             console.log('appData keys:', Object.keys(data.appData));
                        }
                        if (data.data) {
                            console.log('data keys:', Object.keys(data.data));
                            console.log('data content (first 500 chars):', JSON.stringify(data.data).substring(0, 500));
                        }
                    } catch (e) {
                        console.error('JSON parse error:', e.message);
                        console.log('Snippet:', jsonStr.substring(0, 100) + '...' + jsonStr.substring(jsonStr.length - 100));
                    }
                } else {
                    console.log('Could not find end of JSON');
                }
            } else {
                console.log('Could not find var assignment pattern');
            }

        } else {
            console.log('String not found at all');
        }
    }

} catch (e) {
    console.error(e);
}
