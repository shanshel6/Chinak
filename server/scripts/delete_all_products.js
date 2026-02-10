
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteAllProducts() {
  try {
    console.log('Starting product deletion...');

    // 1. Delete dependent data first to avoid foreign key constraints
    
    console.log('Deleting CartItems...');
    await prisma.cartItem.deleteMany({});
    
    console.log('Deleting WishlistItems...');
    await prisma.wishlistItem.deleteMany({});
    
    console.log('Deleting Reviews...');
    await prisma.review.deleteMany({});
    
    // Note: Deleting OrderItems will affect Orders. 
    // Assuming this is a dev/cleanup request where integrity of old orders is less important 
    // than clearing the product catalog.
    console.log('Deleting OrderItems...');
    await prisma.orderItem.deleteMany({});

    console.log('Deleting ProductVariants...');
    await prisma.productVariant.deleteMany({});

    console.log('Deleting ProductOptions...');
    await prisma.productOption.deleteMany({});

    // ProductImage has onDelete: Cascade usually, but let's be safe
    console.log('Deleting ProductImages...');
    await prisma.productImage.deleteMany({});

    // 2. Finally delete Products
    console.log('Deleting Products...');
    const { count } = await prisma.product.deleteMany({});

    console.log(`Successfully deleted ${count} products and all related data.`);

  } catch (error) {
    console.error('Error deleting products:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deleteAllProducts();
