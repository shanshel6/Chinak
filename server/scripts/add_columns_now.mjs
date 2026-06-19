// Minimal script to add missing embedding columns using your psql command.
// Run this from your own terminal (not sandboxed).

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

const SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing columns if they have fixed dimension (768) and re-add as unsized vector
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

-- Verify
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Product'
  AND column_name IN ('imageEmbedding', 'textEmbedding', 'embedding')
ORDER BY column_name;
`;

async function main() {
  console.log('[Fix] Adding missing embedding columns...');
  
  // Escape SQL for command line
  const escapedSql = SQL.replace(/"/g, '\\"').replace(/\n/g, ' ');
  
  const cmd = `PGPASSWORD=DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ psql -h trolley.proxy.rlwy.net -U postgres -p 57322 -d railway -c "${escapedSql}"`;
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { shell: true });
    console.log('[Fix] Success! Output:');
    console.log(stdout);
    if (stderr) console.log('Stderr:', stderr);
    console.log('\n✅ Columns added. Now re-run your pipeline script.');
  } catch (e) {
    console.error('[Fix] Failed:', e.message);
    console.error('Stderr:', e.stderr || '');
    console.error('\n⚠️  Try running the psql command manually:');
    console.log(`PGPASSWORD=DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ psql -h trolley.proxy.rlwy.net -U postgres -p 57322 -d railway`);
    console.log('Then paste the SQL from fix_image_embedding_column.sql');
  }
}

main();