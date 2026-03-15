import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Home, Briefcase, User, ChevronDown } from 'lucide-react';
import { fetchAddressById, updateAddress } from '../services/api';
import { useToastStore } from '../store/useToastStore';

const countries = [
  { code: '+964', name: 'العراق', flag: '🇮🇶' },
  { code: '+966', name: 'السعودية', flag: '🇸🇦' },
  { code: '+971', name: 'الإمارات', flag: '🇦🇪' },
  { code: '+965', name: 'الكويت', flag: '🇰🇼' },
  { code: '+974', name: 'قطر', flag: '🇶🇦' },
  { code: '+973', name: 'البحرين', flag: '🇧🇭' },
  { code: '+968', name: 'عمان', flag: '🇴🇲' },
  { code: '+962', name: 'الأردن', flag: '🇯🇴' },
  { code: '+961', name: 'لبنان', flag: '🇱🇧' },
  { code: '+963', name: 'سوريا', flag: '🇸🇾' },
  { code: '+970', name: 'فلسطين', flag: '🇵🇸' },
  { code: '+20', name: 'مصر', flag: '🇪🇬' },
  { code: '+212', name: 'المغرب', flag: '🇲🇦' },
  { code: '+213', name: 'الجزائر', flag: '🇩🇿' },
  { code: '+216', name: 'تونس', flag: '🇹🇳' },
  { code: '+218', name: 'ليبيا', flag: '🇱🇾' },
  { code: '+249', name: 'السودان', flag: '🇸🇩' },
  { code: '+967', name: 'اليمن', flag: '🇾🇪' },
  { code: '+222', name: 'موريتانيا', flag: '🇲🇷' },
  { code: '+252', name: 'الصومال', flag: '🇸🇴' },
  { code: '+253', name: 'جيبوتي', flag: '🇩🇯' },
  { code: '+269', name: 'جزر القمر', flag: '🇰🇲' },
  { code: '+90', name: 'تركيا', flag: '🇹🇷' },
  { code: '+98', name: 'إيران', flag: '🇮🇷' },
  { code: '+1', name: 'أمريكا', flag: '🇺🇸' },
  { code: '+1', name: 'كندا', flag: '🇨🇦' },
  { code: '+44', name: 'بريطانيا', flag: '🇬🇧' },
  { code: '+33', name: 'فرنسا', flag: '🇫🇷' },
  { code: '+49', name: 'ألمانيا', flag: '🇩🇪' },
  { code: '+39', name: 'إيطاليا', flag: '🇮🇹' },
  { code: '+34', name: 'إسبانيا', flag: '🇪🇸' },
  { code: '+31', name: 'هولندا', flag: '🇳🇱' },
  { code: '+32', name: 'بلجيكا', flag: '🇧🇪' },
  { code: '+41', name: 'سويسرا', flag: '🇨🇭' },
  { code: '+43', name: 'النمسا', flag: '🇦🇹' },
  { code: '+46', name: 'السويد', flag: '🇸🇪' },
  { code: '+47', name: 'النرويج', flag: '🇳🇴' },
  { code: '+45', name: 'الدنمارك', flag: '🇩🇰' },
  { code: '+358', name: 'فنلندا', flag: '🇫🇮' },
  { code: '+351', name: 'البرتغال', flag: '🇵🇹' },
  { code: '+30', name: 'اليونان', flag: '🇬🇷' },
  { code: '+7', name: 'روسيا', flag: '🇷🇺' },
  { code: '+380', name: 'أوكرانيا', flag: '🇺🇦' },
  { code: '+48', name: 'بولندا', flag: '🇵🇱' },
  { code: '+40', name: 'رومانيا', flag: '🇷🇴' },
  { code: '+36', name: 'المجر', flag: '🇭🇺' },
  { code: '+420', name: 'التشيك', flag: '🇨🇿' },
  { code: '+86', name: 'الصين', flag: '🇨🇳' },
  { code: '+81', name: 'اليابان', flag: '🇯🇵' },
  { code: '+82', name: 'كوريا الجنوبية', flag: '🇰🇷' },
  { code: '+91', name: 'الهند', flag: '🇮🇳' },
  { code: '+92', name: 'باكستان', flag: '🇵🇰' },
  { code: '+62', name: 'إندونيسيا', flag: '🇮🇩' },
  { code: '+60', name: 'ماليزيا', flag: '🇲🇾' },
  { code: '+65', name: 'سنغافورة', flag: '🇸🇬' },
  { code: '+66', name: 'تايلاند', flag: '🇹🇭' },
  { code: '+84', name: 'فيتنام', flag: '🇻🇳' },
  { code: '+63', name: 'الفلبين', flag: '🇵🇭' },
  { code: '+61', name: 'أستراليا', flag: '🇦🇺' },
  { code: '+64', name: 'نيوزيلندا', flag: '🇳🇿' },
  { code: '+55', name: 'البرازيل', flag: '🇧🇷' },
  { code: '+54', name: 'الأرجنتين', flag: '🇦🇷' },
  { code: '+56', name: 'تشيلي', flag: '🇨🇱' },
  { code: '+57', name: 'كولومبيا', flag: '🇨🇴' },
  { code: '+51', name: 'بيرو', flag: '🇵🇪' },
  { code: '+58', name: 'فنزويلا', flag: '🇻🇪' },
  { code: '+52', name: 'المكسيك', flag: '🇲🇽' },
  { code: '+27', name: 'جنوب أفريقيا', flag: '🇿🇦' },
  { code: '+234', name: 'نيجيريا', flag: '🇳🇬' },
  { code: '+251', name: 'إثيوبيا', flag: '🇪🇹' },
  { code: '+254', name: 'كينيا', flag: '🇰🇪' },
  { code: '+255', name: 'تنزانيا', flag: '🇹🇿' },
  { code: '+233', name: 'غانا', flag: '🇬🇭' },
  { code: '+221', name: 'السنغال', flag: '🇸🇳' },
  { code: '+93', name: 'أفغانستان', flag: '🇦🇫' },
  { code: '+355', name: 'ألبانيا', flag: '🇦🇱' },
  { code: '+376', name: 'أندورا', flag: '🇦🇩' },
  { code: '+244', name: 'أنغولا', flag: '🇦🇴' },
  { code: '+374', name: 'أرمينيا', flag: '🇦🇲' },
  { code: '+994', name: 'أذربيجان', flag: '🇦🇿' },
  { code: '+880', name: 'بنغلاديش', flag: '🇧🇩' },
  { code: '+375', name: 'بيلاروسيا', flag: '🇧🇾' },
  { code: '+359', name: 'بلغاريا', flag: '🇧🇬' },
  { code: '+855', name: 'كمبوديا', flag: '🇰🇭' },
  { code: '+237', name: 'الكاميرون', flag: '🇨🇲' },
  { code: '+506', name: 'كوستاريكا', flag: '🇨🇷' },
  { code: '+385', name: 'كرواتيا', flag: '🇭🇷' },
  { code: '+357', name: 'قبرص', flag: '🇨🇾' },
  { code: '+593', name: 'الإكوادور', flag: '🇪🇨' },
  { code: '+372', name: 'إستونيا', flag: '🇪🇪' },
  { code: '+995', name: 'جورجيا', flag: '🇬🇪' },
  { code: '+502', name: 'غواتيمالا', flag: '🇬🇹' },
  { code: '+354', name: 'آيسلندا', flag: '🇮🇸' },
  { code: '+353', name: 'أيرلندا', flag: '🇮🇪' },
  { code: '+996', name: 'قيرغيزستان', flag: '🇰🇬' },
  { code: '+371', name: 'لاتفيا', flag: '🇱🇻' },
  { code: '+370', name: 'ليتوانيا', flag: '🇱🇹' },
  { code: '+352', name: 'لوكسمبورغ', flag: '🇱🇺' },
  { code: '+389', name: 'مقدونيا', flag: '🇲🇰' },
  { code: '+356', name: 'مالطا', flag: '🇲🇹' },
  { code: '+373', name: 'مولدوفا', flag: '🇲🇩' },
  { code: '+377', name: 'موناكو', flag: '🇲🇨' },
  { code: '+976', name: 'منغوليا', flag: '🇲🇳' },
  { code: '+382', name: 'الجبل الأسود', flag: '🇲🇪' },
  { code: '+977', name: 'نيبال', flag: '🇳🇵' },
  { code: '+505', name: 'نيكاراغوا', flag: '🇳🇮' },
  { code: '+507', name: 'بنما', flag: '🇵🇦' },
  { code: '+595', name: 'باراغواي', flag: '🇵🇾' },
  { code: '+381', name: 'صربيا', flag: '🇷🇸' },
  { code: '+421', name: 'سلوفاكيا', flag: '🇸🇰' },
  { code: '+386', name: 'سلوفينيا', flag: '🇸🇮' },
  { code: '+94', name: 'سريلانكا', flag: '🇱🇰' },
  { code: '+992', name: 'طاجيكستان', flag: '🇹🇯' },
  { code: '+993', name: 'تركمانستان', flag: '🇹🇲' },
  { code: '+598', name: 'أوروغواي', flag: '🇺🇾' },
  { code: '+998', name: 'أوزبكستان', flag: '🇺🇿' },
];

const EditAddress: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.showToast);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    type: 'المنزل',
    name: '',
    countryCode: '+964',
    phone: '',
    city: '',
    street: '',
    isDefault: false
  });

  const loadAddress = useCallback(async (addressId: number | string) => {
    try {
      setFetching(true);
      const data = await fetchAddressById(addressId);
      
      // Try to extract country code from phone
      let extractedCode = '+964';
      let extractedPhone = data.phone || '';
      
      // Sort countries by code length descending to match longest code first
      const sortedCountries = [...countries].sort((a, b) => b.code.length - a.code.length);
      
      for (const country of sortedCountries) {
        if (extractedPhone.startsWith(country.code)) {
          extractedCode = country.code;
          extractedPhone = extractedPhone.substring(country.code.length);
          break;
        }
      }

      setFormData({
        type: data.type || 'المنزل',
        name: data.name || '',
        countryCode: extractedCode,
        phone: extractedPhone,
        city: data.city || '',
        street: data.street || '',
        isDefault: data.isDefault || false
      });
    } catch (err: any) {
      setError(err.message || 'فشل في تحميل بيانات العنوان');
      showToast(err.message || 'فشل في تحميل بيانات العنوان', 'error');
    } finally {
      setFetching(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (id) {
      loadAddress(id);
    }
  }, [id, loadAddress]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    
    if (!formData.name || !formData.phone || !formData.city || !formData.street) {
      setError('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const finalPhone = `${formData.countryCode}${formData.phone.replace(/^0+/, '')}`;
      await updateAddress(id, {
        ...formData,
        phone: finalPhone
      });
      showToast('تم تحديث العنوان بنجاح', 'success');
      navigate('/addresses');
    } catch (err: any) {
      setError(err.message || 'فشل في تحديث العنوان');
      showToast(err.message || 'فشل في تحديث العنوان', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-background-light dark:bg-background-dark font-display text-text-primary-light dark:text-text-primary-dark antialiased pt-safe" dir="rtl">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-background-light dark:bg-background-dark font-display text-text-primary-light dark:text-text-primary-dark antialiased pb-10 pb-safe" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur-md border-b border-border-light dark:border-border-dark transition-colors duration-300 pt-safe">
        <div className="flex items-center justify-between p-4 h-16">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-text-primary-light dark:text-text-primary-dark"
          >
            <ArrowRight size={24} />
          </button>
          <h1 className="text-lg font-bold leading-tight tracking-[-0.015em]">تعديل العنوان</h1>
          <div className="w-10 h-10"></div>
        </div>
      </header>

      <main className="flex-1 w-full p-4 space-y-6">
        <form onSubmit={handleSubmit} className="bg-surface-light dark:bg-surface-dark rounded-2xl p-5 shadow-soft border border-border-light dark:border-border-dark space-y-5 animate-[fadeIn_0.5s_ease-out]">
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded-xl text-sm text-center">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-5">
              {/* Address Type */}
              <div className="space-y-3">
                <label className="text-sm font-bold text-text-secondary-light dark:text-text-secondary-dark px-1">نوع العنوان</label>
                <div className="flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'المنزل' })}
                    className={`flex-1 h-12 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                      formData.type === 'المنزل' 
                        ? 'border-primary bg-primary/5 text-primary font-bold' 
                        : 'border-slate-100 dark:border-slate-800 text-slate-500 font-bold hover:border-primary/30'
                    }`}
                  >
                    <Home size={20} />
                    المنزل
                  </button>
                  <button 
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'العمل' })}
                    className={`flex-1 h-12 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                      formData.type === 'العمل' 
                        ? 'border-primary bg-primary/5 text-primary font-bold' 
                        : 'border-slate-100 dark:border-slate-800 text-slate-500 font-bold hover:border-primary/30'
                    }`}
                  >
                    <Briefcase size={20} />
                    العمل
                  </button>
                </div>
              </div>

              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-text-secondary-light dark:text-text-secondary-dark px-1">الاسم الكامل</label>
                <div className="relative flex items-center">
                  <User className="absolute right-3 text-slate-400" size={20} />
                  <input 
                    className="w-full h-12 pr-10 pl-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400 text-sm" 
                    placeholder="مثال: أحمد محمد" 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
              </div>

              {/* Phone Number */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-text-secondary-light dark:text-text-secondary-dark px-1">رقم الواتساب</label>
                <div className="relative flex items-center">
                  <div className="absolute right-3 flex items-center gap-1.5 border-l border-slate-200 dark:border-slate-700 pl-2 ml-2 h-8">
                    <div className="relative group">
                      <select 
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        value={formData.countryCode}
                        onChange={(e) => setFormData({ ...formData, countryCode: e.target.value })}
                      >
                        {countries.map((c) => (
                          <option key={`${c.code}-${c.name}`} value={c.code}>{c.flag} {c.name} ({c.code})</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-1">
                        <span className="text-lg">
                          {countries.find(c => c.code === formData.countryCode)?.flag}
                        </span>
                        <span className="text-sm font-bold text-slate-600 dark:text-slate-400 ltr" dir="ltr">
                          {formData.countryCode}
                        </span>
                        <ChevronDown size={16} className="text-slate-400" />
                      </div>
                    </div>
                  </div>
                  <input 
                    className="w-full h-12 pr-[110px] pl-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-400 text-sm text-left font-bold" 
                    placeholder="7XX XXX XXXX" 
                    style={{ direction: 'ltr' }} 
                    type="tel" 
                    value={formData.phone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setFormData({ ...formData, phone: val });
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-5">
              {/* City */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-text-secondary-light dark:text-text-secondary-dark px-1">المحافظة</label>
                <div className="relative">
                  <select 
                    className="w-full h-12 pr-4 pl-10 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-primary focus:ring-1 focus:ring-primary outline-none appearance-none text-sm cursor-pointer"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  >
                    <option value="">اختر المحافظة</option>
                    <option value="بغداد">بغداد</option>
                    <option value="البصرة">البصرة</option>
                    <option value="نينوى">نينوى</option>
                    <option value="أربيل">أربيل</option>
                    <option value="النجف">النجف</option>
                    <option value="كربلاء">كربلاء</option>
                    <option value="ذي قار">ذي قار</option>
                    <option value="بابل">بابل</option>
                    <option value="السليمانية">السليمانية</option>
                    <option value="الأنبار">الأنبار</option>
                    <option value="ديالى">ديالى</option>
                    <option value="المثنى">المثنى</option>
                    <option value="القادسية">القادسية</option>
                    <option value="ميسان">ميسان</option>
                    <option value="واسط">واسط</option>
                    <option value="صلاح الدين">صلاح الدين</option>
                    <option value="دهوك">دهوك</option>
                    <option value="كركوك">كركوك</option>
                    <option value="حلبجة">حلبجة</option>
                  </select>
                  <ChevronDown size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Detailed Address */}
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-text-secondary-light dark:text-text-secondary-dark px-1">العنوان بالتفصيل</label>
                <textarea 
                  className="w-full p-3 h-24 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none text-sm placeholder:text-slate-400" 
                  placeholder="المنطقة، الشارع، رقم المنزل، أقرب نقطة دالة..."
                  value={formData.street}
                  onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                ></textarea>
              </div>

              {/* Default Address Toggle */}
              <div className="flex items-center justify-between px-1 py-2">
                <div className="flex flex-col">
                  <span className="text-sm font-bold">تعيين كعنوان افتراضي</span>
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">سيتم استخدام هذا العنوان تلقائياً للطلبات القادمة</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Update Button */}
          <div className="pt-6">
            <button 
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-primary hover:bg-primary-dark text-white font-bold rounded-2xl shadow-lg shadow-primary/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <span>حفظ التعديلات</span>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default EditAddress;
