import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Phone, User as UserIcon, ArrowLeft, Mail, Lock, Home } from 'lucide-react';
import { sendWhatsAppOTP, checkUser, checkEmail, loginWithEmail, signupWithEmail, verifyEmailOTP, forgotPassword, resetPassword, resendEmailOTP, loginWithPhone, resetPhonePassword } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { useToastStore } from '../store/useToastStore';
import { KeyRound } from 'lucide-react';
import packageJson from '../../package.json';

import Logo from '../components/Logo';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const showToast = useToastStore((state) => state.showToast);
  
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [countryCode, setCountryCode] = useState('+964');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'phone' | 'phone-password' | 'phone-signup-details' | 'phone-forgot-password' | 'phone-reset-password' | 'email' | 'signup-name' | 'email-otp' | 'forgot-password' | 'reset-password'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const allowReviewerBypass = true; // Always allow for App Store reviewers

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

  // Test accounts for Google Play reviewers
  const TEST_ACCOUNTS = {
    reviewer: { 
      phone: '+1234567890', 
      password: 'reviewer123',
      name: 'Google Play Reviewer',
      email: 'reviewer@example.com'
    },
    demo_email: {
      phone: '+9647700000001', // not used
      password: 'demo_password123',
      name: 'Demo Email User',
      email: 'demo@example.com'
    },
    admin_reviewer: { 
      phone: '+1987654321', 
      password: 'adminreview456',
      name: 'Reviewer 2',
      email: 'reviewer2@example.com'
    }
  };

  // Check if phone number matches test accounts
  const isTestAccount = (phone: string) => {
    const normalizedPhone = normalizePhone(phone);
    return Object.values(TEST_ACCOUNTS).some(account => 
      normalizePhone(account.phone) === normalizedPhone
    );
  };

  // Handle test account login
  const handleTestAccountLogin = async (phone: string) => {
    const normalizedPhone = normalizePhone(phone);
    const testAccount = Object.values(TEST_ACCOUNTS).find(account => 
      normalizePhone(account.phone) === normalizedPhone
    );

    if (testAccount) {
      // Simulate successful login for test accounts
      const token = 'test-token-' + normalizedPhone + '-' + Date.now();
      const user = {
        id: 'reviewer-' + Date.now(),
        phone: testAccount.phone,
        name: testAccount.name,
        email: testAccount.email,
        role: 'USER' // Always USER for test accounts as requested
      };
      
      // Simulation for Google Play reviewers
      // Navigate to verify-otp with a special flag
      showToast('تم إرسال كود التحقق (للمراجعة: 123456)', 'info', 5000);
      navigate('/verify-otp', { 
        state: { 
          phone: normalizedPhone, 
          type: 'login',
          isTestAccount: true,
          testUser: user,
          testToken: token
        } 
      });
      return true;
    }
    return false;
  };

  const normalizePhone = (phone: string) => {
    if (!phone) return '';
    // Remove all non-numeric characters
    let clean = phone.replace(/\D/g, '');
    
    // Handle Iraq numbers (+964 or 07...)
    if (clean.startsWith('0')) {
      clean = '964' + clean.substring(1);
    } else if (clean.startsWith('9640')) {
      clean = '964' + clean.substring(4);
    } else if (!clean.startsWith('964') && clean.length === 10 && (clean.startsWith('77') || clean.startsWith('78') || clean.startsWith('75') || clean.startsWith('79'))) {
      // If it's a 10 digit number starting with a mobile prefix, assume it's Iraq
      clean = '964' + clean;
    }
    
    return clean;
  };

  const checkUserExists = async (phone: string) => {
    try {
      const { exists } = await checkUser(phone);
      return exists;
    } catch (err) {
      console.error('Error checking user:', err);
      return false;
    }
  };

  const handlePhoneSubmit = async () => {
    const fullPhone = countryCode + phoneNumber;
    const normalizedPhone = normalizePhone(fullPhone);

    if (step === 'phone') {
      if (!phoneNumber) {
        setError('يرجى إدخال رقم الهاتف');
        return;
      }

      // Check if this is a test account for Google Play reviewers
      if (allowReviewerBypass && isTestAccount(fullPhone)) {
        const success = await handleTestAccountLogin(fullPhone);
        if (success) {
          return; // Test account login successful, exit early
        }
      }

      const exists = await checkUserExists(normalizedPhone);
      if (!exists) {
        setStep('phone-signup-details');
        return;
      }

      // User exists, ask for password
      setStep('phone-password');
    } else if (step === 'phone-password') {
      if (!password) {
        setError('يرجى إدخال كلمة المرور');
        return;
      }
      
      try {
        const response = await loginWithPhone(normalizedPhone, password);
        setAuth(response.token, response.user);
        showToast('تم تسجيل الدخول بنجاح', 'success');
        navigate('/');
      } catch (err: any) {
        throw err;
      }
    } else if (step === 'phone-signup-details') {
      if (fullName.length < 3) {
        setError('يرجى إدخال الاسم الكامل');
        return;
      }
      if (password.length < 6) {
        setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
        return;
      }

      await sendWhatsAppOTP(normalizedPhone, fullName, false);
      showToast('تم إرسال كود التحقق إلى رقمك', 'success');
      navigate('/verify-otp', { state: { phone: normalizedPhone, fullName, password, type: 'signup' } });
    } else if (step === 'phone-forgot-password') {
      await sendWhatsAppOTP(normalizedPhone, undefined, true);
      showToast('تم إرسال كود إعادة التعيين إلى رقمك', 'success');
      setStep('phone-reset-password');
    } else if (step === 'phone-reset-password') {
      if (!otpCode || otpCode.length < 6) {
        setError('يرجى إدخال كود التحقق');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
        return;
      }
      
      await resetPhonePassword(normalizedPhone, otpCode, newPassword);
      
      showToast('تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.', 'success');
      setStep('phone-password');
      setOtpCode('');
      setPassword('');
      setNewPassword('');
    }
  };

  const handleEmailSubmit = async () => {
    const normalizedEmail = email.toLowerCase().trim();

    // Demo email login
    if (step === 'email' && normalizedEmail === TEST_ACCOUNTS.demo_email.email && password === TEST_ACCOUNTS.demo_email.password) {
      const user = {
        id: 'demo-email-' + Date.now(),
        phone: TEST_ACCOUNTS.demo_email.phone,
        name: TEST_ACCOUNTS.demo_email.name,
        email: TEST_ACCOUNTS.demo_email.email,
        role: 'USER'
      };
      setAuth('demo-token-' + Date.now(), user);
      showToast('تم تسجيل الدخول كمستخدم تجريبي (بريد)', 'success');
      navigate('/');
      return;
    }

    if (step === 'email') {
      if (!email || !email.includes('@')) {
        setError('يرجى إدخال بريد إلكتروني صالح');
        return;
      }
      if (!password) {
        setError('يرجى إدخال كلمة المرور');
        return;
      }

      try {
        // Try login directly first - this covers users in Supabase but not in Prisma
        const response = await loginWithEmail(normalizedEmail, password);
        setAuth(response.token, response.user);
        showToast('تم تسجيل الدخول بنجاح', 'success');
        navigate('/');
      } catch (err: any) {
        // If login fails, check if user exists to determine next step
        const { exists } = await checkEmail(normalizedEmail);
        if (!exists) {
          // User doesn't exist in Prisma OR Supabase (checkEmail should ideally check both but we fallback to signup)
          setStep('signup-name');
        } else {
          // User exists but login failed (wrong password etc)
          throw err;
        }
      }
    } else if (step === 'signup-name') {
      if (!fullName || fullName.length < 3) {
        setError('يرجى إدخال الاسم الكامل');
        return;
      }

      const response = await signupWithEmail(normalizedEmail, password, fullName);
      console.log('Signup successful:', response);
      showToast('تم إرسال كود التحقق إلى بريدك الإلكتروني', 'success');
      setStep('email-otp');
    } else if (step === 'email-otp') {
      if (!otpCode || otpCode.length < 6) {
        setError('يرجى إدخال كود التحقق');
        return;
      }

      const response = await verifyEmailOTP(normalizedEmail, otpCode);
      if (response.token && response.user) {
        setAuth(response.token, response.user);
      } else {
        throw new Error('بيانات الدخول غير مكتملة');
      }
      showToast('تم إنشاء الحساب وتفعيله بنجاح', 'success');
      navigate('/');
    } else if (step === 'forgot-password') {
      if (!email || !email.includes('@')) {
        setError('يرجى إدخال بريد إلكتروني صالح');
        return;
      }
      const response = await forgotPassword(normalizedEmail);
      console.log('Forgot password response:', response);
      showToast('تم إرسال كود إعادة التعيين إلى بريدك الإلكتروني', 'success');
      setStep('reset-password');
    } else if (step === 'reset-password') {
      if (!otpCode || otpCode.length < 6) {
        setError('يرجى إدخال كود التحقق');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
        return;
      }
      
      // First verify the recovery OTP to authenticate the user
      await verifyEmailOTP(normalizedEmail, otpCode, 'recovery');
      
      // Now that we're authenticated via recovery token, we can update the password
      await resetPassword(newPassword);
      
      showToast('تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.', 'success');
      setStep('email');
      setOtpCode('');
      setPassword('');
    }
  };

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (method === 'phone') {
        await handlePhoneSubmit();
      } else {
        await handleEmailSubmit();
      }
    } catch (err: any) {
      const errorMessage = err.message || 'فشل العملية. يرجى المحاولة مرة أخرى.';
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleMethod = () => {
    if (method === 'phone') {
      setMethod('email');
      setStep('email');
    } else {
      setMethod('phone');
      setStep('phone');
    }
    setError('');
  };


  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden bg-background-light dark:bg-background-dark shadow-2xl font-display text-slate-900 dark:text-white antialiased selection:bg-primary/30 rtl pb-safe pt-safe" dir="rtl">
      {/* Home Navigation Icon */}
        <div className="absolute left-6 z-10 top-[calc(env(safe-area-inset-top)+1.5rem)]">
          <button 
            onClick={() => navigate('/')}
            className="p-2.5 rounded-full bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-all active:scale-90 shadow-sm"
            aria-label="Go to home"
          >
            <Home size={20} />
          </button>
        </div>

        {/* Header Section */}
        <div className="flex flex-col items-center pt-[calc(env(safe-area-inset-top)+3rem)] pb-6 px-6">
          {/* Logo */}
          <Logo size="lg" className="mb-6" />
          {/* Headline */}
          <h1 className="text-slate-900 dark:text-white text-3xl font-bold tracking-tight text-center leading-tight mb-2">
            {step === 'phone' ? 'تسجيل الدخول' : 
             step === 'phone-password' ? 'أدخل كلمة المرور' :
             step === 'phone-signup-details' ? 'أهلاً بك في شيناك' :
             step === 'phone-forgot-password' ? 'نسيت كلمة المرور' :
             step === 'phone-reset-password' ? 'تعيين كلمة المرور' :
             step === 'email' ? 'تسجيل الدخول بالبريد' :
             step === 'signup-name' ? 'إنشاء حساب جديد' :
             step === 'forgot-password' ? 'نسيت كلمة المرور' :
             step === 'reset-password' ? 'تعيين كلمة المرور' :
             'تأكيد البريد الإلكتروني'}
          </h1>
          {/* Subtitle */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-slate-500 dark:text-slate-400 text-base font-normal text-center max-w-[80%]">
              {step === 'phone' ? 'أدخل رقم الهاتف الخاص بك للمتابعة' : 
               step === 'phone-password' ? 'أدخل كلمة المرور الخاصة بحسابك' :
               step === 'phone-signup-details' ? 'يرجى إدخال اسمك وكلمة مرور جديدة لإكمال عملية التسجيل' :
               step === 'phone-forgot-password' ? 'أدخل رقم الهاتف للحصول على كود التحقق' :
               step === 'phone-reset-password' ? 'أدخل الكود المرسل وكلمة المرور الجديدة' :
               step === 'email' ? 'أدخل بريدك الإلكتروني وكلمة المرور' :
               step === 'signup-name' ? 'يرجى إدخال اسمك لإكمال التسجيل' :
               step === 'forgot-password' ? 'أدخل بريدك الإلكتروني للحصول على كود التحقق' :
               step === 'reset-password' ? 'أدخل الكود المرسل وكلمة المرور الجديدة' :
               `أدخل الكود المرسل إلى ${email}`}
            </p>
            {step === 'phone' && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 animate-pulse">
                الطريقة الأسرع والموصى بها ⚡
              </span>
            )}
          </div>
        </div>

        {/* Form Section */}
        <form onSubmit={handleContinue} className="flex-1 px-6 flex flex-col gap-5">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm text-right border border-red-100 dark:border-red-800">
              {error}
            </div>
          )}

          {method === 'phone' ? (
            <>
              {step === 'phone' && (
                <div className="flex flex-col gap-2">
                  <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                    رقم الهاتف
                  </label>
                  <div className="flex w-full items-stretch gap-2">
                    <div className="relative w-32 shrink-0">
                      <select
                        className="w-full bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3.5 text-base text-slate-900 dark:text-white appearance-none focus:outline-none focus:border-primary dark:focus:border-primary transition-colors text-right"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        dir="ltr"
                      >
                        {countries.map((c) => (
                          <option key={`${c.code}-${c.name}`} value={c.code}>
                            {c.flag} {c.name} ({c.code})
                          </option>
                        ))}
                      </select>
                      <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
                        <Phone size={16} />
                      </div>
                    </div>
                    <div className="flex-1">
                      <input 
                        id="phone"
                        className="w-full bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary dark:focus:border-primary transition-colors text-right" 
                        placeholder="770 000 0000" 
                        type="tel"
                        required
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 text-right mt-1 px-1">
                    * سيتم إرسال كود التحقق إلى هذا الرقم
                  </p>
                </div>
              )}
              {step === 'phone-password' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <button 
                      type="button" 
                      onClick={() => setStep('phone')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      تغيير الرقم
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كلمة المرور
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <Lock size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="••••••••" 
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <button 
                      type="button" 
                      onClick={() => setStep('phone-forgot-password')}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      نسيت كلمة المرور؟
                    </button>
                  </div>
                </div>
              )}
              {step === 'phone-signup-details' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <button 
                      type="button" 
                      onClick={() => setStep('phone')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      تغيير الرقم
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      الاسم الكامل
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <UserIcon size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-slate-300 dark:focus:border-slate-600 focus:ring-0 text-right" 
                        placeholder="أدخل اسمك هنا" 
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كلمة المرور
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <Lock size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="••••••••" 
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              )}
              {step === 'phone-forgot-password' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <button 
                      type="button" 
                      onClick={() => setStep('phone-password')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      الرجوع لتسجيل الدخول
                    </button>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 p-4 rounded-xl text-sm text-center border border-blue-100 dark:border-blue-800">
                    سيتم إرسال كود التحقق إلى الرقم:
                    <div className="font-bold text-lg mt-2" dir="ltr">{countryCode}{phoneNumber}</div>
                  </div>
                </div>
              )}
              {step === 'phone-reset-password' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كود التحقق
                    </label>
                    <input 
                      className="w-full bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-center text-xl tracking-[0.5em] font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" 
                      placeholder="------" 
                      type="text"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      dir="ltr"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كلمة المرور الجديدة
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <KeyRound size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="••••••••" 
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {step === 'email' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-left-4 duration-300">
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      البريد الإلكتروني
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <Mail size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="example@mail.com" 
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كلمة المرور
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <Lock size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="••••••••" 
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-start">
                    <button 
                      type="button" 
                      onClick={() => setStep('forgot-password')}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      نسيت كلمة المرور؟
                    </button>
                  </div>
                </div>
              )}

              {step === 'forgot-password' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <button 
                      type="button" 
                      onClick={() => setStep('email')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      الرجوع لتسجيل الدخول
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      البريد الإلكتروني
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <Mail size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="example@mail.com" 
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 'reset-password' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <button 
                      type="button" 
                      onClick={() => setStep('forgot-password')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      تغيير البريد الإلكتروني
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كود التحقق
                    </label>
                    <input 
                      className="w-full bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-2xl font-bold tracking-[1rem] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary text-center" 
                      placeholder="000000" 
                      type="text"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      dir="ltr"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كلمة المرور الجديدة
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-50">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <KeyRound size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-0 text-left" 
                        placeholder="••••••••" 
                        type="password"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 'signup-name' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-1">
                    <button 
                      type="button" 
                      onClick={() => setStep('email')}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      الرجوع
                    </button>
                    <span className="text-xs text-slate-500">حساب جديد</span>
                  </div>
                  
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      الاسم الكامل
                    </label>
                    <div className="flex w-full items-stretch rounded-xl shadow-sm">
                      <div className="flex items-center justify-center px-4 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-l-0 rounded-r-xl text-slate-400">
                        <UserIcon size={22} />
                      </div>
                      <input 
                        className="flex-1 bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 border-r-0 rounded-l-xl px-4 py-3.5 text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none text-right" 
                        placeholder="أدخل اسمك هنا" 
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 'email-otp' && (
                <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex flex-col gap-2">
                    <label className="text-slate-900 dark:text-slate-200 text-sm font-medium pr-1 text-right">
                      كود التحقق
                    </label>
                    <input 
                      className="w-full bg-surface-light dark:bg-surface-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-2xl font-bold tracking-[1rem] text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-primary text-center" 
                      placeholder="000000" 
                      type="text"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      dir="ltr"
                    />
                  </div>
                  
                  <div className="flex justify-center">
                    <button 
                      type="button" 
                      onClick={async () => {
                        try {
                          setLoading(true);
                          await resendEmailOTP(email.toLowerCase().trim());
                          showToast('تم إعادة إرسال كود التحقق بنجاح', 'success');
                        } catch (err: any) {
                          showToast(err.message || 'فشل إعادة إرسال الكود', 'error');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      disabled={loading}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      إعادة إرسال الكود
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Primary Action */}
          <div className="mt-6 flex flex-col gap-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center px-4 leading-relaxed">
              بمتابعتك، أنت توافق على{' '}
              <Link to="/terms-of-service" className="text-primary hover:underline font-medium">شروط الخدمة</Link>
              {' '}و{' '}
              <Link to="/privacy-policy" className="text-primary hover:underline font-medium">سياسة الخصوصية</Link>
              {' '}الخاصة بنا.
            </p>

            <button 
              type="submit"
              disabled={loading}
              className={`w-full font-bold text-lg py-3.5 rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                method === 'phone' 
                ? 'bg-[#25D366] hover:bg-[#22c35e] text-white shadow-green-500/30' 
                : 'bg-primary hover:bg-blue-600 text-white shadow-blue-500/30'
              } disabled:bg-slate-300 dark:disabled:bg-slate-700`}
            >
              {loading ? (
                <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              ) : (
                <>
                  {method === 'phone' && (
                    <Phone size={24} className="ml-2" />
                  )}
                  {method === 'phone' ? (
                    step === 'phone' ? 'المتابعة برقم الهاتف' : 
                    step === 'phone-password' ? 'تسجيل الدخول' :
                    step === 'phone-signup-details' ? 'تأكيد وإرسال الكود' :
                    step === 'phone-forgot-password' ? 'إرسال كود التحقق' :
                    step === 'phone-reset-password' ? 'تعيين كلمة المرور' :
                    'تأكيد وإرسال الكود'
                  ) : 
                   (step === 'email' ? 'متابعة' : 
                    step === 'signup-name' ? 'إنشاء حساب' : 
                    step === 'forgot-password' ? 'إرسال كود التحقق' :
                    step === 'reset-password' ? 'تعيين كلمة المرور' :
                    'تأكيد الحساب')}
                </>
              )}
            </button>
          </div>

          {/* Secondary Action - Toggle Method */}
          <div className="flex flex-col gap-3">
            <button 
              type="button"
              onClick={toggleMethod}
              className={`w-full flex items-center justify-center gap-2 rounded-xl border p-3.5 shadow-sm transition-all active:scale-95 ${
                method === 'email' 
                ? 'bg-green-50/50 border-green-200 text-green-700 hover:bg-green-100 dark:bg-green-900/10 dark:border-green-800 dark:text-green-400' 
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {method === 'phone' ? (
                <>
                  <Mail size={18} />
                  <span className="text-sm font-medium">المتابعة عبر البريد الإلكتروني</span>
                </>
              ) : (
                <>
                  <Phone size={20} className="fill-current" />
                  <span className="text-sm font-medium">المتابعة برقم الهاتف (موصى به)</span>
                </>
              )}
            </button>

            {/* Version Indicator for Debugging */}
            <div className="text-center mt-6 p-2 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-500 mb-1">الإصدار الحالي</p>
              <span className="text-sm font-bold text-primary font-mono tracking-wider">
                v{packageJson.version}
              </span>
            </div>
          </div>

        </form>

        {/* Footer */}
        <div className="py-8 flex flex-col justify-center items-center gap-2 text-base pb-10">
        </div>
      </div>
  );
};

export default Login;
