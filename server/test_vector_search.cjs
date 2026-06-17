
// Test the new search endpoint with vector support

import { embedText } from './services/clipService.js';
import axios from 'axios';

// Generate a test vector using our server's embedText
const testQuery = 'black sports shoes';
const testEmbedding = await embedText(testQuery);
console.log(`Generated embedding for "${testQuery}"`);

// Test as GET request with comma-separated vector
console.log('Testing GET /api/search with vector param...');
try {
  const getResponse = await axios.get('http://localhost:5001/api/search', {
    params: {
      vector: testEmbedding.join(','),
      limit: 3
    }
  });
  console.log('GET response:', getResponse.data);
} catch (err) {
  console.error('GET test failed:', err.message);
}

// Test as POST request with array vector
console.log('\nTesting POST /api/search with vector array...');
try {
  const postResponse = await axios.post('http://localhost:5001/api/search', {
    vector: testEmbedding,
    limit: 3
  });
  console.log('POST response:', postResponse.data);
} catch (err) {
  console.error('POST test failed:', err.message);
}
