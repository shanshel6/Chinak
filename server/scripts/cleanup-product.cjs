const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:5001';
const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN;

const idsToDelete = [2261, 2268]; // IDs found in the log

async function deleteProduct(id) {
  try {
    console.log(`Deleting product ${id}...`);
    await axios.delete(`${API_BASE_URL}/api/products/${id}`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });
    console.log(`✅ Product ${id} deleted successfully.`);
  } catch (error) {
    console.error(`❌ Failed to delete product ${id}: ${error.message}`);
    if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data: ${JSON.stringify(error.response.data)}`);
    }
  }
}

async function main() {
    for (const id of idsToDelete) {
        await deleteProduct(id);
    }
}

main();
