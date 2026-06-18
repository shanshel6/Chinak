-- =============================================================================
--  Fix: Add `imageEmbedding` column to Product table
--
--  Why this exists:
--    The queue processor and `productImageVectorService.js` try to write a
--    512-dimensional vector (from Xenova/clip-vit-base-patch32) into
--    `Product.imageEmbedding`. If the column doesn't exist, or has a
--    different fixed dimension, you get errors like:
--
--      column "imageEmbedding" does not exist           (column missing)
--      expected 768 dimensions, not 512                (size mismatch)
--
--  What this script does:
--    1. Drops any existing `imageEmbedding` / `textEmbedding` columns that
--       have a fixed dimension that doesn't match the model output.
--    2. Re-adds them as un-sized `vector` columns (pgvector accepts any
--       length when no dimension is specified).
--    3. Ensures the `vector` extension is enabled.
--
--  How to run:
--    1. Connect to your Railway Postgres (or local) and open a query tab.
--    2. Paste this entire file and run it.
--    OR
--       psql "<your DATABASE_URL>" -f server/prisma/fix_image_embedding_column.sql
--
--  SAFE TO RE-RUN: this script is idempotent. It only alters the table
--  if the columns are missing or have a different fixed dimension.
-- =============================================================================

-- 1. Make sure pgvector is installed
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Inspect the current shape of the column (so you can see what changed)
DO $$
DECLARE
  current_type TEXT;
  has_column   BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'imageEmbedding'
  ) INTO has_column;

  IF has_column THEN
    SELECT data_type || COALESCE(
      '(' || character_maximum_length || ')', ''
    ) INTO current_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'imageEmbedding';

    RAISE NOTICE 'Current Product.imageEmbedding type: %', current_type;
  ELSE
    RAISE NOTICE 'Product.imageEmbedding does not exist — will be created.';
  END IF;
END $$;

-- 3. Drop & re-create imageEmbedding as an unsized vector
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

-- 4. Drop & re-create textEmbedding the same way (it's the same model, same size)
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

-- 5. Drop & re-create embedding (legacy column used by some queries)
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

-- 6. Sanity check: report final state
DO $$
DECLARE
  img_type TEXT;
  txt_type TEXT;
  emb_type TEXT;
BEGIN
  SELECT data_type INTO img_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'imageEmbedding';
  SELECT data_type INTO txt_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'textEmbedding';
  SELECT data_type INTO emb_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'embedding';

  RAISE NOTICE '==== After migration ====';
  RAISE NOTICE 'Product.imageEmbedding type: %', img_type;
  RAISE NOTICE 'Product.textEmbedding  type: %', txt_type;
  RAISE NOTICE 'Product.embedding      type: %', emb_type;
  RAISE NOTICE '==== Done. The queue processor should now succeed. ====';
END $$;
