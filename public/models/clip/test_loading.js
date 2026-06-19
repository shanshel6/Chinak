
// Test if the model can be loaded locally
const { AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection } = require('@xenova/transformers');

async function testModel() {
    console.log('Testing model loading from:', process.cwd() + '/models/clip');
    
    try {
        const processor = await AutoProcessor.from_pretrained('./models/clip', { quantized: true });
        console.log('✅ Processor loaded');
        
        const tokenizer = await AutoTokenizer.from_pretrained('./models/clip', { quantized: true });
        console.log('✅ Tokenizer loaded');
        
        const textModel = await CLIPTextModelWithProjection.from_pretrained('./models/clip', { quantized: true });
        console.log('✅ Text model loaded');
        
        console.log('🎉 All models loaded successfully!');
        return true;
    } catch (error) {
        console.error('❌ Failed to load model:', error.message);
        return false;
    }
}

testModel();
