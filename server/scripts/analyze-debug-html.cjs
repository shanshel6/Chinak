
const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('e:\\mynewproject2\\server\\xianyu-category-debug.html', 'utf8');
const $ = cheerio.load(html);

console.log('Total anchors:', $('a').length);

$('a').each((i, el) => {
    const href = $(el).attr('href');
    const classNames = $(el).attr('class');
    const parentClass = $(el).parent().attr('class');
    console.log(`Link ${i}: href="${href}", class="${classNames}", parentClass="${parentClass}"`);
});

// Also print generic structure to find product container
console.log('\n--- Potential Product Containers ---');
$('div[class*="feed"], div[class*="list"], div[class*="item"]').each((i, el) => {
    console.log(`Div ${i}: class="${$(el).attr('class')}"`);
});
