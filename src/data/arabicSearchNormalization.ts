// Arabic search term normalization for flexible category search
// Handles singular/plural forms and Iraqi slang

interface SearchMapping {
  [key: string]: string;
}

// Iraqi slang and singular/plural mappings
const searchMappings: SearchMapping = {
  // Tables - ميز is Iraqi slang for table (مائدة)
  'ميز': 'مائدة',
  'مائدة': 'مائدة',
  'طاولات': 'مائدة',
  'طاولة': 'مائدة',
  
  // Chairs
  'كراسي': 'كرسي',
  'كرسي': 'كرسي',
  'مقاعد': 'كرسي',
  'مقعد': 'كرسي',
  
  // Beds
  'سرير': 'سرير',
  'سراير': 'سرير',
  'أسرّة': 'سرير',
  'مضاجع': 'سرير',
  'مضجع': 'سرير',
  
  // Sofas
  'كنبة': 'كنبة',
  'كنب': 'كنبة',
  'أريكة': 'كنبة',
  'أرائك': 'كنبة',
  'كاناب': 'كنبة', // Iraqi slang
  'كانابات': 'كنبة',
  
  // Clothes - General
  'ملابس': 'ملابس',
  'لباس': 'ملابس',
  'ثياب': 'ملابس',
  
  // Shirts
  'قميص': 'قميص',
  'قمص': 'قميص',
  'تيشيرت': 'قميص',
  'تيشيرات': 'قميص',
  
  // Pants
  'بنطلون': 'بنطلون',
  'بنطلونات': 'بنطلون',
  'بناطيل': 'بنطلون',
  'سراويل': 'بنطلون',
  'سروال': 'بنطلون',
  
  // Dresses
  'فستان': 'فستان',
  'فساتين': 'فستان',
  'رداء': 'فستان',
  'أردية': 'فستان',
  
  // Shoes
  'حذاء': 'حذاء',
  'أحذية': 'حذاء',
  'حذ': 'حذاء',
  'كندرة': 'حذاء', // Iraqi slang
  'كنادر': 'حذاء',
  
  // Bags
  'حقيبة': 'حقيبة',
  'حقائب': 'حقيبة',
  'شنطة': 'حقيبة',
  'شنط': 'حقيبة',
  
  // Phones
  'هاتف': 'هاتف',
  'هواتف': 'هاتف',
  'موبايل': 'هاتف',
  'موبايلات': 'هاتف',
  'جوال': 'هاتف',
  'جوالات': 'هاتف',
  
  // Laptops
  'لابتوب': 'لابتوب',
  'لابتوبات': 'لابتوب',
  'حاسوب': 'لابتوب',
  'حواسيب': 'لابتوب',
  'كمبيوتر': 'لابتوب',
  
  // Watches
  'ساعة': 'ساعة',
  'ساعات': 'ساعة',
  'ساعه': 'ساعة',
  
  // Glasses
  'نظارة': 'نظارة',
  'نظارات': 'نظارة',
  'نظ': 'نظارة',
  
  // Jewelry
  'مجوهرات': 'مجوهرات',
  'حلي': 'مجوهرات',
  'حلق': 'مجوهرات',
  'خواتم': 'مجوهرات',
  'خاتم': 'مجوهرات',
  
  // Kitchen
  'مطبخ': 'مطبخ',
  'مطابخ': 'مطبخ',
  
  // Cooking utensils
  'أواني': 'أواني',
  'وعاء': 'أواني',
  'قدر': 'أواني',
  'قُدر': 'أواني',
  'قِدر': 'أواني',
  'قدور': 'أواني',
  
  // Electronics
  'إلكترونيات': 'إلكترونيات',
  'أجهزة': 'إلكترونيات',
  'جهاز': 'إلكترونيات',
  
  // TV
  'تلفزيون': 'تلفزيون',
  'تلفاز': 'تلفزيون',
  'شاشة': 'تلفزيون',
  'شاشات': 'تلفزيون',
  
  // Refrigerator
  'ثلاجة': 'ثلاجة',
  'ثلاجات': 'ثلاجة',
  'براد': 'ثلاجة',
  
  // Washing machine
  'غسالة': 'غسالة',
  'غسالات': 'غسالة',
  'غسال': 'غسالة',
  
  // Air conditioner
  'مكيف': 'مكيف',
  'مكيفات': 'مكيف',
  'تكييف': 'مكيف',
  
  // Books
  'كتاب': 'كتاب',
  'كتب': 'كتاب',
  
  // Toys
  'ألعاب': 'ألعاب',
  'لعبة': 'ألعاب',
  
  // Baby products
  'أطفال': 'أطفال',
  'طفل': 'أطفال',
  'رضيع': 'أطفال',
  'رضاعة': 'أطفال',
  
  // Beauty
  'تجميل': 'تجميل',
  'مستحضرات': 'تجميل',
  'مكياج': 'تجميل',
  
  // Perfume
  'عطر': 'عطر',
  'عطور': 'عطر',
  'بخور': 'عطر',
  
  // Food
  'طعام': 'طعام',
  'أكل': 'طعام',
  'مأكولات': 'طعام',
  
  // Drinks
  'مشروب': 'مشروب',
  'مشروبات': 'مشروب',
  'شراب': 'مشروب',
  
  // Furniture - General
  'أثاث': 'أثاث',
  'مفروشات': 'أثاث',
  
  // Curtains
  'ستائر': 'ستائر',
  'ستارة': 'ستائر',
  'ستار': 'ستائر',
  
  // Rugs
  'سجاد': 'سجاد',
  'سجادة': 'سجاد',
  'بطان': 'سجاد',
  
  // Lamps
  'مصباح': 'مصباح',
  'مصابيح': 'مصباح',
  'كشاف': 'مصباح',
  'كشافات': 'مصباح',
  
  // Fan
  'مروحة': 'مروحة',
  'مراوح': 'مروحة',
  
  // Camera
  'كاميرا': 'كاميرا',
  'كاميرات': 'كاميرا',
  'تصوير': 'كاميرا',
  
  // Headphones
  'سماعات': 'سماعات',
  'سماعة': 'سماعات',
  'هيدفون': 'سماعات',
  'أذن': 'سماعات',
  
  // Charger
  'شاحن': 'شاحن',
  'شواحن': 'شاحن',
  
  // Battery
  'بطارية': 'بطارية',
  'بطاريات': 'بطارية',
  'بطاري': 'بطارية',
  
  // Cable
  'سلك': 'سلك',
  'أسلاك': 'سلك',
  'كابل': 'سلك',
  'كابلات': 'سلك',
  
  // Car
  'سيارة': 'سيارة',
  'سيارات': 'سيارة',
  'عربة': 'سيارة',
  'عربات': 'سيارة',
  'كرك': 'سيارة', // Iraqi slang
  
  // Bicycle
  'دراجة': 'دراجة',
  'دراجات': 'دراجة',
  'دراجة هوائية': 'دراجة',
  
  // Motorcycle
  'موتور': 'موتور',
  'موتوسيكل': 'موتور',
  'دراجة نارية': 'موتور',
  
  // Sports
  'رياضة': 'رياضة',
  'ألعاب رياضية': 'رياضة',
  
  // Football
  'كرة': 'كرة',
  'كرة قدم': 'كرة',
  
  // Gym
  'نادي': 'نادي',
  'جيم': 'نادي',
  'صالة': 'نادي',
  
  // Tools
  'أدوات': 'أدوات',
  'أداة': 'أدوات',
  'عُدة': 'أدوات',
  
  // Garden
  'حديقة': 'حديقة',
  'حدائق': 'حديقة',
  'بستنة': 'حديقة',
  
  // Flowers
  'زهرة': 'زهرة',
  'زهور': 'زهرة',
  'ورد': 'زهرة',
  'ورود': 'زهرة',
  
  // Office supplies
  'مكتب': 'مكتب',
  'مكاتب': 'مكتب',
  'قرطاسية': 'مكتب',
  
  // Pen
  'قلم': 'قلم',
  'أقلام': 'قلم',
  
  // Paper
  'ورقة': 'ورقة',
  'أوراق': 'ورقة',
  'ورق': 'ورقة',
  
  // School
  'مدرسة': 'مدرسة',
  'مدارس': 'مدرسة',
  'تعليم': 'مدرسة',
};

/**
 * Normalize Arabic search term to handle singular/plural and slang
 * @param searchTerm - The original search term
 * @returns Normalized search term
 */
export function normalizeArabicSearchTerm(searchTerm: string): string {
  const trimmed = searchTerm.trim().toLowerCase();
  
  // Direct mapping
  if (searchMappings[trimmed]) {
    return searchMappings[trimmed];
  }
  
  // Try removing common plural patterns
  const pluralPatterns = ['ات', 'ين', 'ون', 'ان', 'اء', 'أ', 'إ'];
  for (const pattern of pluralPatterns) {
    if (trimmed.endsWith(pattern) && trimmed.length > pattern.length) {
      const singular = trimmed.slice(0, -pattern.length);
      if (searchMappings[singular]) {
        return searchMappings[singular];
      }
    }
  }
  
  // Return original if no mapping found
  return searchTerm;
}

/**
 * Get all possible search variations for a term
 * @param searchTerm - The original search term
 * @returns Array of possible variations
 */
export function getSearchVariations(searchTerm: string): string[] {
  const normalized = normalizeArabicSearchTerm(searchTerm);
  const variations = new Set<string>([searchTerm, normalized]);
  
  // Add common plural forms
  const pluralSuffixes = ['ات', 'ين', 'ون', 'ان', 'اء'];
  for (const suffix of pluralSuffixes) {
    variations.add(normalized + suffix);
  }
  
  return Array.from(variations);
}
