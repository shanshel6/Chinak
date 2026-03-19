import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

// --- FIX DATABASE CONNECTION POOL ---
// Enforce connection limit globally for the server
if (process.env.DATABASE_URL) {
    try {
        const url = new URL(process.env.DATABASE_URL);
        // Supabase pooler runs on port 6543 for transaction mode usually, but if using 5432 session mode, 
        // we must strictly limit the pool size. 
        if (!url.searchParams.has('connection_limit')) {
            // Drop connection limit low for the main server to avoid MaxClientsInSessionMode error
            url.searchParams.set('connection_limit', '3'); 
        }
        if (!url.searchParams.has('pool_timeout')) {
            url.searchParams.set('pool_timeout', '20'); // Timeout faster if pool is exhausted
        }
        process.env.DATABASE_URL = url.toString();
    } catch (e) {
        console.warn('Warning: Could not parse DATABASE_URL to set connection_limit in prismaClient.js');
    }
}

const prisma = new PrismaClient();

export default prisma;
