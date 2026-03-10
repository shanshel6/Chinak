// Simple test script to run the category scraper
const { scrapeCategory } = require('./category-scraper.js');

const categoryUrl = 'https://s.1688.com/selloffer/offer_search.htm?spm=a260k.home2025.category.dL2.66333597RpQZVA&charset=utf8&keywords=%E5%A5%B3%E8%A3%85&featurePair=401:8872005&beginPage=1';

console.log('Starting category scraper test...');

scrapeCategory(categoryUrl, 2, 1)
  .then(products => {
    console.log('Scraping completed!');
    console.log(`Extracted ${products.length} products`);
    
    if (products.length > 0) {
      console.log('First product:', JSON.stringify(products[0], null, 2));
    }
  })
  .catch(error => {
    console.error('Scraping failed:', error);
  });