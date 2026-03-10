import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const getColumnType = async () => {
  const result = await prisma.$queryRaw`
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'Product' AND column_name = 'keywords'
    LIMIT 1
  `;
  const row = Array.isArray(result) ? result[0] : null;
  return row ? { data_type: row.data_type, udt_name: row.udt_name } : null;
};

const alterKeywordsToArray = async () => {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Product"
    ALTER COLUMN "keywords"
    TYPE text[]
    USING (
      CASE
        WHEN "keywords" IS NULL THEN ARRAY[]::text[]
        WHEN "keywords" = '' THEN ARRAY[]::text[]
        ELSE string_to_array(
          regexp_replace(replace("keywords", '،', ','), '\\s*,\\s*', ',', 'g'),
          ','
        )
      END
    )
  `);
};

const normalizeKeywordsArray = async () => {
  await prisma.$executeRawUnsafe(`
    UPDATE "Product"
    SET "keywords" = (
      SELECT ARRAY(
        SELECT DISTINCT trim(x)
        FROM unnest("keywords") AS x
        WHERE trim(x) <> ''
      )
    )
    WHERE "keywords" IS NOT NULL
  `);
};

const run = async () => {
  const column = await getColumnType();
  if (!column) {
    console.log('keywords column not found');
    return;
  }
  if (column.data_type !== 'ARRAY' || column.udt_name !== '_text') {
    await alterKeywordsToArray();
  }
  await normalizeKeywordsArray();
  console.log('keywords normalized');
};

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
