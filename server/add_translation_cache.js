import prisma from "./prismaClient.js";

async function addTranslationCache() {
  try {
    console.log("Adding TranslationCache table...");
    
    // Check if table already exists
    const existingTable = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'TranslationCache'
      )
    `;
    
    if (existingTable[0].exists) {
      console.log("TranslationCache table already exists!");
      process.exit(0);
    }

    // Create the table
    await prisma.$executeRaw`
      CREATE TABLE "TranslationCache" (
        "id" SERIAL NOT NULL,
        "arabicQuery" TEXT NOT NULL,
        "englishTranslation" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        "hitCount" INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT "TranslationCache_pkey" PRIMARY KEY ("id")
      )
    `;

    // Create indexes
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX "TranslationCache_arabicQuery_key" ON "TranslationCache"("arabicQuery")
    `;
    await prisma.$executeRaw`
      CREATE INDEX "TranslationCache_arabicQuery_idx" ON "TranslationCache"("arabicQuery")
    `;

    console.log("Successfully added TranslationCache table!");
    process.exit(0);
  } catch (error) {
    console.error("Error adding TranslationCache table:", error);
    process.exit(1);
  }
}

addTranslationCache();
