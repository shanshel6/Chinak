// Static Arabic to English translation cache for common product terms
const STATIC_TRANSLATIONS: Record<string, string> = {
  // Clothing
  'تيشيرت': 't-shirt',
  'تي شيرت': 't-shirt',
  'قميص': 'shirt',
  'بنطال': 'pants',
  'جينز': 'jeans',
  'جاكيت': 'jacket',
  'سترة': 'jacket',
  'فستان': 'dress',
  'تنورة': 'skirt',
  'شورت': 'shorts',
  'حذاء': 'shoes',
  'حذاء رياضي': 'sneakers',
  'حذاء رجالي': 'men\'s shoes',
  'حذاء نسائي': 'women\'s shoes',
  'سوار': 'watch',
  'ساعة': 'watch',
  'نظارة': 'glasses',
  'قبعة': 'hat',
  'حجاب': 'scarf',
  'وشاح': 'scarf',
  
  // Electronics
  'هاتف': 'phone',
  'موبايل': 'phone',
  'لابتوب': 'laptop',
  'كمبيوتر': 'computer',
  'تابلت': 'tablet',
  'سماعة': 'headphones',
  'سماعات': 'headphones',
  'شاحن': 'charger',
  'كابل': 'cable',
  'كاميرا': 'camera',
  
  // Home
  'كرسي': 'chair',
  'طاولة': 'table',
  'سرير': 'bed',
  'مضخة': 'pillow',
  'ملاءة': 'sheet',
  'بطانية': 'blanket',
  
  // Beauty
  'كحل': 'eyeliner',
  'احمر شفاه': 'lipstick',
  'كريم': 'cream',
  'عطر': 'perfume',
  
  // Colors
  'أحمر': 'red',
  'أزرق': 'blue',
  'أخضر': 'green',
  'أصفر': 'yellow',
  'أسود': 'black',
  'أبيض': 'white',
  'وردي': 'pink',
  'برتقالي': 'orange',
  'بنفسجي': 'purple',
  'رمادي': 'gray',
  'ذهبي': 'gold',
  'فضي': 'silver',
  
  // Sizes
  'صغير': 'small',
  'وسط': 'medium',
  'كبير': 'large',
  'اكس لارج': 'xl',
  'إكس إل': 'xl',
  'إكسترا لارج': 'extra large',
  
  // Conditions
  'جديد': 'new',
  'مستعمل': 'used',
  
  // Brands
  'نايك': 'nike',
  'أديداس': 'adidas',
  'أبل': 'apple',
  'سامسونغ': 'samsung',
  'هواوي': 'huawei'
};

// Expand search term (handle plurals, common phrases)
export function expandSearchTerm(term: string): string {
  const normalized = term.toLowerCase().trim();
  
  // First check exact match
  if (STATIC_TRANSLATIONS[normalized]) {
    return STATIC_TRANSLATIONS[normalized];
  }
  
  // Check partial matches for longer phrases
  const words = normalized.split(/\s+/);
  if (words.length > 1) {
    const translatedWords = words.map(word => {
      return STATIC_TRANSLATIONS[word] || word;
    });
    return translatedWords.join(' ');
  }
  
  return '';
}

// Check if we have a static translation available
export function hasStaticTranslation(term: string): boolean {
  return expandSearchTerm(term) !== '';
}
