import axios from 'axios';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const JWT_SECRET = 'c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=';
const API_URL = 'https://chinak-production.up.railway.app';

async function testUserOrderAPI() {
  const userId = 67; // User ID found in check-user-orders.js
  const token = jwt.sign(
    { id: userId, role: 'USER', email: '67@whatsapp.user' }, 
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  console.log('--- USER ORDER DIAGNOSTIC ---');
  console.log('Target:', API_URL);

  try {
    console.log('\nAttempting to fetch user orders...');
    const response = await axios.get(`${API_URL}/api/orders`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ User orders fetch successful!');
    console.log('Total orders returned:', response.data.length);
    if (response.data.length > 0) {
      console.log('Sample Order Status:', response.data[0].status);
      console.log('Sample Payment Method:', response.data[0].paymentMethod);
    }
  } catch (error) {
    console.error('❌ User orders fetch failed!');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testUserOrderAPI();
