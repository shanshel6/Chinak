// Arabic search term normalization for flexible category search
// Handles Iraqi slang only, no static category mappings

interface SearchMapping {
  [key: string]: string;
}

// Only Iraqi slang mappings
const searchMappings: SearchMapping = {
  // Tables
  'ميز': 'مائدة',
  'ميزات': 'مائدة',
  'دوكة': 'مائدة',
  'دوكات': 'مائدة',
  
  // Chairs
  'كعدي': 'كرسي',
  
  // Beds
  'جربايه': 'سرير',
  'جرباية': 'سرير',
  
  // Sofas
  'كاناب': 'كنبة',
  'كانابات': 'كنبة',
  'كانبوه': 'كنبة',
  'قنفه': 'كنبة',
  'قنفات': 'كنبة',
  'صوفة': 'كنبة',
  'صوفات': 'كنبة',
  
  // Clothes
  'حلا': 'ملابس',
  'شلغ': 'ملابس',
  'شلغات': 'ملابس',
  'شماغ': 'ملابس',
  'شماغات': 'ملابس',
  'دشداشة': 'ملابس',
  'دشداشات': 'ملابس',
  'مكناسه': 'ملابس',
  
  // Pants
  'بنط': 'بنطلون',
  
  // Dresses
  'دريسة': 'فستان',
  'دريسات': 'فستان',
  
  // Shoes
  'كندرة': 'حذاء',
  'كنادر': 'حذاء',
  'كلاج': 'حذاء',
  'كلاجات': 'حذاء',
  
  // Phones
  'نق': 'هاتف',
  
  // Watches
  'راص': 'ساعة',
  
  // Kitchen
  'طنجرة': 'أواني',
  'طناجر': 'أواني',
  'قلايه': 'أواني',
  'قلايات': 'أواني',
  'طاسة': 'أواني',
  'طاس': 'أواني',
  'طاسات': 'أواني',
  
  // Electronics
  'ماطور': 'إلكترونيات',
  'مطورات': 'إلكترونيات',
  'مولده': 'إلكترونيات',
  'مولدات': 'إلكترونيات',
  'مولد': 'إلكترونيات',
  
  // Refrigerator
  'ثلاجه': 'ثلاجة',
  
  // Cables
  'واير': 'سلك',
  'وايرات': 'سلك',
  'تقسيم': 'سلك',
  'تقاسيم': 'سلك',
  
  // Car
  'كرك': 'سيارة',
  'كركات': 'سيارة',
  'باص': 'سيارة',
  'باصات': 'سيارة',
  'تاكسي': 'سيارة',
  'كوستر': 'سيارة',
  
  // Bicycle
  'بيك': 'دراجة',
  'بيكات': 'دراجة'
};

/**
 * Normalize Arabic search term to handle Iraqi slang
 * @param searchTerm - The original search term
 * @returns Normalized search term
 */
export function normalizeArabicSearchTerm(searchTerm: string): string {
  const trimmed = searchTerm.trim().toLowerCase();
  
  // Direct mapping for Iraqi slang only
  if (searchMappings[trimmed]) {
    return searchMappings[trimmed];
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
  return [searchTerm, normalized];
}
