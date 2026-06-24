
import prisma from './prismaClient.js';
import { AutoTokenizer, CLIPTextModelWithProjection } from '@xenova/transformers';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const query = 'High-Pressure Drain Unclogging Tool One Shot';

async function main() {
    console.log('1. Loading models...');
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { quantized: true });

    console.log('2. Generating embedding for query:', query);
    const inputs = await tokenizer(query, { padding: true, truncation: true });
    console.log('   Tokenized input:', inputs);
    
    const outputs = await textModel(inputs);
    const embedding = Array.from(outputs.text_embeds.data);
    
    // L2 normalize
    let norm = 0;
    for (const v of embedding) norm += v * v;
    norm = Math.sqrt(norm);
    const normalized = embedding.map(v => v / norm);
    console.log('   Embedding (first 10):', normalized.slice(0, 10));
    console.log('   Embedding length:', normalized.length);

    console.log('\n3. Checking product 277401 in DB...');
    const product = await prisma.$queryRawUnsafe(
        `SELECT id, name, "aiMetadata", "textEmbedding"::text FROM "Product" WHERE id = $1`,
        277401
    );

    if (product && product.length > 0) {
        console.log('✅ Found product:', product[0]);
        if (product[0].textEmbedding) {
            console.log('✅ Product has textEmbedding!');
            const dbEmbeddingStr = product[0].textEmbedding;
            console.log('   Raw DB embedding string (first 100 chars):', dbEmbeddingStr.substring(0, 100));
            // Remove brackets and split into numbers
            const dbEmbedding = dbEmbeddingStr
                .replace(/[\[\]]/g, '')
                .split(',')
                .map(str => parseFloat(str.trim()));
            console.log('   Parsed DB embedding (first 10):', dbEmbedding.slice(0, 10));
            
            // Compute cosine similarity
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            for (let i = 0; i < normalized.length; i++) {
                dotProduct += normalized[i] * dbEmbedding[i];
                normA += normalized[i] * normalized[i];
                normB += dbEmbedding[i] * dbEmbedding[i];
            }
            const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
            console.log('🎯 Cosine similarity between query embedding and product 277401:', similarity);
        } else {
            console.log('❌ Product has NO textEmbedding!');
        }
    } else {
        console.log('❌ Product 277401 not found!');
    }

    console.log('\n4. Running exact search like test_search_flow.mjs to confirm...');
    const vectorStr = `[${normalized.join(',')}]`;
    const matches = await prisma.$queryRawUnsafe(
        `SELECT id, 1 - ("textEmbedding" <=> $1::vector) as similarity FROM "Product" WHERE "textEmbedding" IS NOT NULL AND status = $2 AND "isActive" = $3 ORDER BY "textEmbedding" <=> $1::vector LIMIT $4`,
        vectorStr,
        'PUBLISHED',
        true
    );

    console.log('📊 Raw search results from DB:', matches);
    await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
