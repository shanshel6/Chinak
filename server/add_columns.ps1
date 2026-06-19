# PowerShell script to add missing columns
# Save as add_columns.ps1 and run: .\add_columns.ps1

$env:PGPASSWORD = "DsizocMPoAaTQyhDhiMQxzxQKnnbfjqQ"
$sql = @"
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop existing columns if they have fixed dimension (768) and re-add as unsized vector
DO `$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'imageEmbedding'
  ) THEN
    ALTER TABLE "Product" DROP COLUMN "imageEmbedding";
  END IF;
END `$\$;

ALTER TABLE "Product" ADD COLUMN "imageEmbedding" vector;

DO `$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'textEmbedding'
  ) THEN
    ALTER TABLE "Product" DROP COLUMN "textEmbedding";
  END IF;
END `$\$;

ALTER TABLE "Product" ADD COLUMN "textEmbedding" vector;

DO `$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = 'embedding'
  ) THEN
    ALTER TABLE "Product" DROP COLUMN "embedding";
  END IF;
END `$\$;

ALTER TABLE "Product" ADD COLUMN "embedding" vector;

-- Verify
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Product'
  AND column_name IN ('imageEmbedding', 'textEmbedding', 'embedding')
ORDER BY column_name;
"@

Write-Host "[Fix] Adding missing embedding columns..." -ForegroundColor Cyan

# Escape quotes for command line
$escapedSql = $sql -replace '"', '\"'

$cmd = "psql -h trolley.proxy.rlwy.net -U postgres -p 57322 -d railway -c `"$escapedSql`""

try {
    $output = Invoke-Expression $cmd 2>&1
    Write-Host "[Fix] Success! Output:" -ForegroundColor Green
    Write-Host $output
    Write-Host "`n✅ Columns added. Now re-run your pipeline script." -ForegroundColor Green
} catch {
    Write-Host "[Fix] Failed: $_" -ForegroundColor Red
    Write-Host "`n⚠️  Try running psql manually:" -ForegroundColor Yellow
    Write-Host "psql -h trolley.proxy.rlwy.net -U postgres -p 57322 -d railway"
    Write-Host "Then paste the SQL from fix_image_embedding_column.sql"
}