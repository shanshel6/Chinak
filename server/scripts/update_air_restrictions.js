
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const RESTRICTED_KEYWORDS = [
  // Dangerous Goods (Batteries, Liquids, etc.)
  'battery', 'lithium', 'power bank', 'powerbank', 'batteries',
  'بطارية', 'ليثيوم', 'باور بانك', 'شاحن متنقل',
  
  'liquid', 'oil', 'cream', 'gel', 'paste', 'shampoo', 'perfume', 'spray', 'aerosol',
  'سائل', 'زيت', 'كريم', 'جل', 'معجون', 'شامبو', 'عطر', 'بخاخ',
  
  'powder', 'dust',
  'مسحوق', 'بودرة',
  
  'magnet', 'magnetic',
  'مغناطيس', 'مغناطيسي',
  
  'knife', 'sword', 'dagger', 'weapon', 'gun', 'rifle',
  'سكين', 'سيف', 'خنجر', 'سلاح', 'بندقية',
  
  'flammable', 'lighter', 'gas',
  'قابل للاشتعال', 'ولاعة', 'غاز',

  // Furniture / Bulky Items
  'furniture', 'sofa', 'couch', 'chair', 'table', 'desk', 'wardrobe', 'cabinet', 'cupboard', 
  'bed', 'mattress', 'bookshelf', 'shelf', 'shelves', 'dresser', 'sideboard', 'stool', 'bench',
  'armchair', 'recliner', 'ottoman', 'bean bag', 'dining set', 'tv stand', 'shoe rack',
  
  'أثاث', 'كنبة', 'أريكة', 'كرسي', 'طاولة', 'مكتب', 'دولاب', 'خزانة', 'سرير', 'مرتبة', 
  'رف', 'ارفف', 'تسريحة', 'كومودينو', 'بوفيه', 'مقعد', 'بنش', 'طقم جلوس', 'طاولة طعام', 
  'حامل تلفزيون', 'جزامة', 'طقم صالون', 'غرفة نوم'
];

// Items that might match "chair" or "table" but are small (exceptions)
// e.g., "Table cloth", "Chair cover"
const EXCEPTIONS = [
  'cover', 'cloth', 'slipcover', 'cushion case', 'pillow case', 'protector', 'accessory', 'accessories', 'toy', 'miniature', 'model',
  'غطاء', 'مفرش', 'تلبيسة', 'كيس وسادة', 'حماية', 'اكسسوار', 'لعبة', 'نموذج', 'مجسم'
];

async function updateRestrictedProducts() {
  try {
    console.log('Fetching all products...');
    const products = await prisma.product.findMany({
      select: { id: true, name: true, specs: true }
    });

    console.log(`Found ${products.length} products. Analyzing...`);

    let restrictedCount = 0;
    let safeCount = 0;

    for (const product of products) {
      const text = `${product.name} ${product.specs || ''}`.toLowerCase();
      
      let isRestricted = false;
      let matchedKeyword = '';

      // Check for restricted keywords
      for (const keyword of RESTRICTED_KEYWORDS) {
        if (text.includes(keyword.toLowerCase())) {
          // Check exceptions
          const isException = EXCEPTIONS.some(ex => text.includes(ex.toLowerCase()));
          if (!isException) {
            isRestricted = true;
            matchedKeyword = keyword;
            break;
          }
        }
      }

      // Update the product
      await prisma.product.update({
        where: { id: product.id },
        data: { isAirRestricted: isRestricted }
      });

      if (isRestricted) {
        restrictedCount++;
        // console.log(`[RESTRICTED] ID: ${product.id} | Keyword: ${matchedKeyword} | Name: ${product.name.substring(0, 50)}...`);
      } else {
        safeCount++;
      }
      
      if ((restrictedCount + safeCount) % 100 === 0) {
        process.stdout.write('.');
      }
    }

    console.log('\n\nUpdate Complete!');
    console.log(`Total Products: ${products.length}`);
    console.log(`Marked Restricted (True): ${restrictedCount}`);
    console.log(`Marked Safe (False): ${safeCount}`);

  } catch (error) {
    console.error('Error updating products:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateRestrictedProducts();
