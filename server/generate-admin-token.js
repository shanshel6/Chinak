import jwt from 'jsonwebtoken';

// Your JWT secret from the environment
const JWT_SECRET = 'c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=';

// Generate token for admin user
const adminUser = {
  id: 72, // Your user ID
  email: 'shanshel6@gmail.com',
  role: 'ADMIN',
  name: 'hassan'
};

// Generate the token
const token = jwt.sign(
  { 
    id: adminUser.id, 
    role: adminUser.role, 
    email: adminUser.email 
  },
  JWT_SECRET,
  { expiresIn: '36500d' } // 100 years expiration
);

console.log('Admin Auth Token:');
console.log(token);
console.log('\nToken payload:');
console.log(JSON.stringify(jwt.decode(token), null, 2));