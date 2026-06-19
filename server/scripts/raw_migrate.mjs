// Raw PostgreSQL wire‑protocol client.
// Connects directly to Railway's proxy IP (66.33.22.243) bypassing DNS hijack.
// Sends the migration SQL as a simple query.

import net from 'net';
import crypto from 'crypto';

const HOST = '66.33.22.243'; // Real Railway IP from public DNS
const PORT = 34644;
const USER = 'postgres';
const PASSWORD = 'wpAxoWsjxiQfxCSnAnPdotRRMuDpOIdu';
const DATABASE = 'railway';

// SQL to add columns (simplified)
const SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop if exists then add as unsized vector
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'imageEmbedding'
  ) THEN
    ALTER TABLE "Product" DROP COLUMN "imageEmbedding";
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN "imageEmbedding" vector;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'textEmbedding'
  ) THEN
    ALTER TABLE "Product" DROP COLUMN "textEmbedding";
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN "textEmbedding" vector;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'embedding'
  ) THEN
    ALTER TABLE "Product" DROP COLUMN "embedding";
  END IF;
END $$;

ALTER TABLE "Product" ADD COLUMN "embedding" vector;

SELECT '✅ Columns added' as result;
`;

function createPacket(type, payload) {
  const len = payload.length + 4;
  const buf = Buffer.alloc(len + 1);
  buf.writeUInt8(type.charCodeAt(0), 0);
  buf.writeUInt32BE(len, 1);
  payload.copy(buf, 5);
  return buf;
}

function encodeStartup(user, database) {
  const params = `user\x00${user}\x00database\x00${database}\x00\x00`;
  const len = params.length + 4;
  const buf = Buffer.alloc(len + 4);
  buf.writeUInt32BE(len, 0);
  buf.writeUInt16BE(3, 4); // protocol version major
  buf.writeUInt16BE(0, 6); // protocol version minor
  buf.write(params, 8);
  return buf;
}

async function connectAndMigrate() {
  console.log('[Raw PG] Connecting to', HOST, PORT);
  
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(15000);
    
    let state = 'startup';
    let buffer = Buffer.alloc(0);
    
    socket.on('connect', () => {
      console.log('[Raw PG] TCP connected, sending startup...');
      socket.write(encodeStartup(USER, DATABASE));
    });
    
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      processBuffer();
    });
    
    function processBuffer() {
      if (state === 'startup' && buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (buffer.length >= len) {
          const packet = buffer.slice(0, len);
          buffer = buffer.slice(len);
          
          // Parse authentication request
          const authCode = packet.readUInt32BE(4);
          if (authCode === 3) { // AuthenticationCleartextPassword
            console.log('[Raw PG] Server requests cleartext password');
            const passPacket = Buffer.from(`p${PASSWORD}\x00`, 'utf8');
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeUInt32BE(passPacket.length + 4);
            socket.write(Buffer.concat([lenBuf, passPacket]));
            state = 'auth';
          } else if (authCode === 0) { // AuthenticationOk
            console.log('[Raw PG] Authentication OK');
            state = 'ready';
            sendQuery();
          } else {
            reject(new Error(`Unsupported auth code: ${authCode}`));
            socket.destroy();
          }
        }
      } else if (state === 'auth' && buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (buffer.length >= len) {
          const packet = buffer.slice(0, len);
          buffer = buffer.slice(len);
          const authCode = packet.readUInt32BE(4);
          if (authCode === 0) {
            console.log('[Raw PG] Authentication OK');
            state = 'ready';
            sendQuery();
          } else {
            reject(new Error(`Auth failed with code: ${authCode}`));
            socket.destroy();
          }
        }
      } else if (state === 'query' && buffer.length >= 4) {
        // Parse command completion
        const len = buffer.readUInt32BE(0);
        if (buffer.length >= len) {
          const packet = buffer.slice(0, len);
          buffer = buffer.slice(len);
          const tag = packet.toString('utf8', 5, packet.length - 1);
          console.log('[Raw PG] Command completed:', tag);
          if (packet.readUInt8(4) === 'Z'.charCodeAt(0)) { // ReadyForQuery
            console.log('[Raw PG] Migration complete!');
            socket.destroy();
            resolve();
          }
        }
      }
    }
    
    function sendQuery() {
      console.log('[Raw PG] Sending migration SQL...');
      const queryPacket = Buffer.from(`Q${SQL}\x00`, 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(queryPacket.length + 4);
      socket.write(Buffer.concat([lenBuf, queryPacket]));
      state = 'query';
    }
    
    socket.on('timeout', () => {
      reject(new Error('Connection timeout'));
      socket.destroy();
    });
    
    socket.on('error', reject);
    socket.on('close', () => {
      if (state !== 'ready' && state !== 'query') {
        reject(new Error('Connection closed before completion'));
      }
    });
    
    socket.connect(PORT, HOST);
  });
}

connectAndMigrate()
  .then(() => {
    console.log('\n✅ Database columns added.');
    console.log('Now re-run your pipeline script (run_goofish_pipeline.bat).');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Failed:', err.message);
    console.error('\nFallback: Use Railway Console tab:');
    console.error('1. Go to Railway dashboard → Postgres service → Console tab');
    console.error('2. Paste the SQL from fix_image_embedding_column.sql');
    process.exit(1);
  });