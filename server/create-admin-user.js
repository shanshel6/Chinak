import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// Your JWT secret from the environment
const JWT_SECRET = 'c2hhbnNoYWw2Ni1teS1zaG9wLWJhY2tlbmQtc2VjcmV0LTIwMjY=';

async function createAdminUser(email, password, name) {
  try {
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the admin user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'ADMIN',
        permissions: JSON.stringify(['full_access']),
        isVerified: true,
      },
    });

    console.log('Admin user created successfully!');
    console.log('User ID:', user.id);
    console.log('Email:', user.email);
    console.log('Name:', user.name);
    console.log('Role:', user.role);

    // Generate the token
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: '36500d' } // 100 years expiration
    );

    console.log('\nAdmin Auth Token:');
    console.log(token);
    console.log('\nToken payload:');
    console.log(JSON.stringify(jwt.decode(token), null, 2));

  } catch (error) {
    console.error('Error creating admin user:', error);
    if (error.code === 'P2002') {
      console.error('A user with this email already exists');
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('Usage: node create-admin-user.js <email> <password> <name>');
  console.log('Example: node create-admin-user.js admin@example.com mypassword Admin User');
  process.exit(1);
}

const [email, password, name] = args;
createAdminUser(email, password, name);
