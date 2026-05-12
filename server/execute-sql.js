import pg from 'pg';
const { Client } = pg;

const connectionString = 'postgresql://postgres:DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ@trolley.proxy.rlwy.net:57322/railway';

async function executeSQL() {
  const client = new Client({
    connectionString,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Add notes column to Order table
    console.log('Adding notes column to Order table...');
    await client.query('ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "notes" TEXT');
    console.log('Notes column added successfully');

    // Create admin user
    console.log('Creating admin user...');
    await client.query(`
      INSERT INTO "User" (email, password, name, role, permissions, "isVerified", "createdAt", "updatedAt") 
      VALUES ('admin@example.com', '$2b$10$oyCMtbA1pFlrkJXzOBtTZOAkOtYOmFI./iK2XuaHa2YDQ.O4Jjjm6', 'Admin', 'ADMIN', '["full_access"]', true, NOW(), NOW())
      ON CONFLICT (email) DO NOTHING
    `);
    console.log('Admin user created successfully');

  } catch (error) {
    console.error('Error executing SQL:', error);
  } finally {
    await client.end();
    console.log('Disconnected from database');
  }
}

executeSQL();
