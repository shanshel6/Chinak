import prisma from '../prismaClient.js';

async function main() {
  try {
    const productId = 9889;
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true }
    });

    if (!product) {
        console.log('Product not found');
        return;
    }

    const domesticFee = product.domesticShippingFee || 0;
    
    // Update Product
    if (product.basePriceRMB && product.basePriceRMB > 0) {
        const rawCost = product.basePriceRMB;
        const calculated = (rawCost + domesticFee) * 1.15;
        const newPrice = Math.ceil(calculated / 250) * 250;
        
        console.log(`Updating Product ${productId}: Base ${rawCost} + Dom ${domesticFee} -> New Price ${newPrice}`);
        
        await prisma.product.update({
            where: { id: productId },
            data: { price: newPrice }
        });
    }

    // Update Variants
    for (const variant of product.variants) {
        if (variant.basePriceRMB && variant.basePriceRMB > 0) {
            const rawCost = variant.basePriceRMB;
            const calculated = (rawCost + domesticFee) * 1.15;
            const newPrice = Math.ceil(calculated / 250) * 250;
            
            console.log(`Updating Variant ${variant.id}: Base ${rawCost} -> New Price ${newPrice}`);
            
            await prisma.productVariant.update({
                where: { id: variant.id },
                data: { price: newPrice }
            });
        }
    }
    console.log('Done.');

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
