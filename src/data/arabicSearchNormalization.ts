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
  'ميزات': 'مائدة',
  
  // Chairs
  'كراسي': 'كرسي',
  'كرسي': 'كرسي',
  'مقاعد': 'كرسي',
  'مقعد': 'كرسي',
  'كعدي': 'كرسي', // Iraqi slang
  
  // Beds
  'سرير': 'سرير',
  'سراير': 'سرير',
  'أسرّة': 'سرير',
  'مضاجع': 'سرير',
  'مضجع': 'سرير',
  'فراش': 'سرير',
  'فرشة': 'سرير',
  
  // Sofas
  'كنبة': 'كنبة',
  'كنب': 'كنبة',
  'أريكة': 'كنبة',
  'أرائك': 'كنبة',
  'كاناب': 'كنبة', // Iraqi slang
  'كانابات': 'كنبة',
  'كانبوه': 'كنبة',
  
  // Clothes - General
  'ملابس': 'ملابس',
  'لباس': 'ملابس',
  'ثياب': 'ملابس',
  'حلا': 'ملابس', // Iraqi slang
  
  // Shirts
  'قميص': 'قميص',
  'قمص': 'قميص',
  'تيشيرت': 'قميص',
  'تيشيرات': 'قميص',
  'تيشرت': 'قميص',
  'بلوزة': 'قميص',
  'بلوز': 'قميص',
  
  // Pants
  'بنطلون': 'بنطلون',
  'بنطلونات': 'بنطلون',
  'بناطيل': 'بنطلون',
  'سراويل': 'بنطلون',
  'سروال': 'بنطلون',
  'سروالات': 'بنطلون',
  'بنط': 'بنطلون', // Iraqi slang
  'بنطال': 'بنطلون',
  
  // Dresses
  'فستان': 'فستان',
  'فساتين': 'فستان',
  'رداء': 'فستان',
  'أردية': 'فستان',
  'دريسة': 'فستان', // Iraqi slang
  'دريسات': 'فستان',
  
  // Shoes
  'حذاء': 'حذاء',
  'أحذية': 'حذاء',
  'حذ': 'حذاء',
  'كندرة': 'حذاء', // Iraqi slang
  'كنادر': 'حذاء',
  'شبشب': 'حذاء',
  'شباشب': 'حذاء',
  'صندل': 'حذاء',
  'صنادل': 'حذاء',
  'حفلة': 'حذاء',
  'حفلات': 'حذاء',
  
  // Bags
  'حقيبة': 'حقيبة',
  'حقائب': 'حقيبة',
  'شنطة': 'حقيبة',
  'شنط': 'حقيبة',
  'كيس': 'حقيبة',
  'أكياس': 'حقيبة',
  
  // Phones
  'هاتف': 'هاتف',
  'هواتف': 'هاتف',
  'موبايل': 'هاتف',
  'موبايلات': 'هاتف',
  'جوال': 'هاتف',
  'جوالات': 'هاتف',
  'نق': 'هاتف', // Iraqi slang
  
  // Laptops
  'لابتوب': 'لابتوب',
  'لابتوبات': 'لابتوب',
  'حاسوب': 'لابتوب',
  'حواسيب': 'لابتوب',
  'كمبيوتر': 'لابتوب',
  'كمبيوترات': 'لابتوب',
  
  // Watches
  'ساعة': 'ساعة',
  'ساعات': 'ساعة',
  'ساعه': 'ساعة',
  'سواعت': 'ساعة',
  'راص': 'ساعة', // Iraqi slang
  
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
  'طوق': 'مجوهرات',
  'أطواق': 'مجوهرات',
  
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
  'قُدور': 'أواني',
  'طنجرة': 'أواني', // Iraqi slang
  'طناجر': 'أواني',
  
  // Electronics
  'إلكترونيات': 'إلكترونيات',
  'أجهزة': 'إلكترونيات',
  'جهاز': 'إلكترونيات',
  
  // TV
  'تلفزيون': 'تلفزيون',
  'تلفاز': 'تلفزيون',
  'شاشة': 'تلفزيون',
  'شاشات': 'تلفزيون',
  'تلفزيونات': 'تلفزيون',
  
  // Refrigerator
  'ثلاجة': 'ثلاجة',
  'ثلاجات': 'ثلاجة',
  'براد': 'ثلاجة',
  'برادات': 'ثلاجة',
  
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
  'مجلد': 'كتاب',
  'مجلدات': 'كتاب',
  
  // Toys
  'ألعاب': 'ألعاب',
  'لعبة': 'ألعاب',
  
  // Baby products
  'أطفال': 'أطفال',
  'طفل': 'أطفال',
  'رضيع': 'أطفال',
  'رضاعة': 'أطفال',
  'رضاعات': 'أطفال',
  
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
  'بساط': 'سجاد',
  'بسط': 'سجاد',
  
  // Lamps
  'مصباح': 'مصباح',
  'مصابيح': 'مصباح',
  'كشاف': 'مصباح',
  'كشافات': 'مصباح',
  'لمبة': 'مصباح',
  'لمبات': 'مصباح',
  
  // Fan
  'مروحة': 'مروحة',
  'مراوح': 'مروحة',
  'تهوية': 'مروحة',
  
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
  'كركات': 'سيارة',
  
  // Bicycle
  'دراجة': 'دراجة',
  'دراجات': 'دراجة',
  'دراجة هوائية': 'دراجة',
  'بيك': 'دراجة', // Iraqi slang
  'بكات': 'دراجة',
  
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
  'عدة': 'أدوات',
  
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
  
  // Additional Iraqi slang terms
  // Common Iraqi words for everyday items
  'شلغ': 'ملابس', // Iraqi slang for clothes
  'شلغات': 'ملابس',
  'شماغ': 'ملابس', // Traditional headwear
  'شماغات': 'ملابس',
  'دشداشة': 'ملابس', // Traditional garment
  'دشداشات': 'ملابس',
  
  'كلاج': 'حذاء', // Iraqi slang for shoes
  'كلاجات': 'حذاء',
  
  'شاي': 'مشروب', // Tea
  
  'قهوة': 'مشروب', // Coffee
  
  'جبنة': 'طعام', // Cheese
  'جبن': 'طعام',
  
  'خبز': 'طعام', // Bread
  
  'رز': 'طعام', // Rice
  'أرز': 'طعام',
  
  'لحمة': 'طعام', // Meat
  'لحم': 'طعام',
  
  'سمك': 'طعام', // Fish
  'أسماك': 'طعام',
  
  'دجاج': 'طعام', // Chicken
  
  // Iraqi slang for household items
  'طاسة': 'أواني', // Cup/mug
  'طاس': 'أواني',
  'طاسات': 'أواني',
  
  'صحن': 'أواني', // Plate
  'صحون': 'أواني',
  
  'ملعقة': 'أواني', // Spoon
  'ملاعق': 'أواني',
  
  'شوكة': 'أواني', // Fork
  'شوك': 'أواني',
  
  'سكين': 'أواني', // Knife
  'سكاكين': 'أواني',
  
  // Iraqi slang for furniture
  'دوكة': 'مائدة', // Table
  'دوكات': 'مائدة',
  
  'صوفة': 'كنبة', // Sofa
  'صوفات': 'كنبة',
  
  // Table already mapped above
  
  // Iraqi slang for electronics
  'راديو': 'إلكترونيات', // Radio
  // TV already mapped above
  
  // Iraqi slang for vehicles
  'باص': 'سيارة', // Bus
  'باصات': 'سيارة',
  
  'تاكسي': 'سيارة', // Taxi
  
  'كوستر': 'سيارة', // Coaster/minibus
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
