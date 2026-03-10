
// API CALL READY TO EXECUTE WHEN BACKEND IS RUNNING
// Run this when your backend server at http://localhost:5001 is running

const axios = require('axios');

const productData = {
  "name": "Untitled Product",
  "chineseName": "",
  "description": "",
  "price": 0,
  "basePriceRMB": 0,
  "image": "",
  "images": [],
  "status": "DRAFT",
  "isActive": false,
  "isFeatured": false,
  "purchaseUrl": "",
  "specs": {
    "moq": 1,
    "company": "",
    "location": "",
    "weight_kg": 0.5,
    "original_price_rmb": 0,
    "converted_price_iqd": 0
  },
  "storeEvaluation": {
    "responseRate": "",
    "transactionRate": ""
  },
  "weight": 0.5,
  "length": 20,
  "width": 15,
  "height": 10,
  "domesticShippingFee": 0
};

async function postToDatabase() {
  try {
    const response = await axios.post(
      'http://localhost:5001/api/products',
      { ...productData, status: 'PUBLISHED', isActive: true, isLocal: false },
      {
        headers: {
          'Authorization': 'Bearer your-admin-token-here',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Product posted successfully!');
    console.log('📊 Database ID:', response.data.id);
    console.log('🔗 Status:', response.data.status);
    return response.data;
    
  } catch (error) {
    console.error('❌ Failed to post product:', error.message);
    throw error;
  }
}

// Execute the API call
postToDatabase().catch(console.error);
