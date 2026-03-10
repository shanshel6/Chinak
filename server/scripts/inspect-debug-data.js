
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug-taobao-data.json', 'utf8'));

function printKeys(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const key in obj) {
        console.log(prefix + key);
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            printKeys(obj[key], prefix + '  ');
        }
    }
}

const res = data.loaderData?.home?.data?.res;
if (res) {
    if (res.pcTrade) {
        console.log('Keys in pcTrade:');
        console.log(Object.keys(res.pcTrade));
    }
    if (res.componentsVO) {
        console.log('Keys in componentsVO:');
        console.log(Object.keys(res.componentsVO));
    }
}
