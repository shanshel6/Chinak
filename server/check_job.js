
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const BASE_URL = 'http://localhost:5001';
const JWT_SECRET = "c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY="; 

async function run() {
  const token = jwt.sign(
    { 
      id: 71, 
      email: 'admin@example.com', 
      role: 'ADMIN', 
      permissions: ['manage_products', 'manage_orders', 'view_reports', 'manage_users', 'manage_settings'] 
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const jobId = "528d99e3-beee-4842-a431-3d965f7d8ec0";

  console.log(`Checking job status for ${jobId}...`);
  try {
    const res = await fetch(`${BASE_URL}/api/admin/products/bulk-import-jobs/${jobId}`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    console.log('Job Status:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Request failed:', err);
  }
}

run();
