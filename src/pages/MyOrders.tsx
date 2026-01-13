import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowRight, 
  RefreshCw, 
  Search, 
  Inbox, 
  Headset, 
  X, 
  RotateCcw, 
  CreditCard,
  Loader2
} from 'lucide-react';
import { fetchOrders, cancelOrder, fetchStoreSettings, confirmOrderPayment } from '../services/api';
import { useCartStore } from '../store/useCartStore';
import { useToastStore } from '../store/useToastStore';
import LazyImage from '../components/LazyImage';
import { useTranslation } from 'react-i18next';

const MyOrders: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const showToast = useToastStore((state) => state.showToast);
  const addItem = useCartStore((state) => state.addItem);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isReordering, setIsReordering] = useState<number | string | null>(null);
  const [isCancelling, setIsCancelling] = useState<number | string | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'completed'>('current');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [paymentDone, setPaymentDone] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'zaincash' | 'qicard'>('zaincash');
  const [storeSettings, setStoreSettings] = useState<any>(null);

  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  useEffect(() => {
    loadOrders();
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await fetchStoreSettings();
      setStoreSettings(settings);
    } catch (err) {
      console.error('Failed to load store settings:', err);
    }
  };

  const handleSupportClick = (orderId: number | string) => {
    const phoneNumber = "+8613223001309";
    const message = `مرحباً، أحتاج للمساعدة في طلبي رقم #${orderId}`;
    const whatsappUrl = `https://wa.me/${phoneNumber.replace('+', '')}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handleCancelOrder = async (orderId: number | string) => {
    if (!window.confirm(t('dashboard.orders.cancel_confirm') || 'هل أنت متأكد من رغبتك في إلغاء هذا الطلب؟')) return;
    
    setIsCancelling(orderId);
    try {
      await cancelOrder(orderId);
      await loadOrders(); // Reload to show updated status
      showToast(t('dashboard.orders.cancel_success') || 'تم إلغاء الطلب بنجاح', 'success');
    } catch (err) {
      console.error('Failed to cancel order:', err);
      showToast(t('dashboard.orders.cancel_error') || 'فشل في إلغاء الطلب. يرجى المحاولة لاحقاً.', 'error');
    } finally {
      setIsCancelling(null);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadOrders();
    setIsRefreshing(false);
  };

  const handleReorder = async (order: any) => {
    setIsReordering(order.id);
    try {
      // Add all items from the order to the cart
      for (const item of order.items) {
        await addItem(item.product.id, item.quantity);
      }
      navigate('/cart');
      showToast('تمت إعادة طلب المنتجات بنجاح', 'success');
    } catch (err) {
      console.error('Failed to reorder:', err);
      showToast('فشل في إعادة طلب المنتجات', 'error');
    } finally {
      setIsReordering(null);
    }
  };

  const handlePaymentClick = (order: any) => {
    setSelectedOrder(order);
    setShowPaymentModal(true);
    setPaymentDone(false);
  };

  const handlePaymentDone = async () => {
    if (!selectedOrder || isConfirmingPayment) return;
    
    setIsConfirmingPayment(true);
    try {
      console.log(`[Payment] Confirming payment for order ${selectedOrder.id}`);
      // Call API to confirm payment and move to PREPARING
      const result = await confirmOrderPayment(selectedOrder.id);
      console.log(`[Payment] API Response:`, result);

      setPaymentDone(true);

      // Hide modal after a delay
      setTimeout(() => {
        setShowPaymentModal(false);
        setSelectedOrder(null);
        setPaymentDone(false);
        setIsConfirmingPayment(false);
        showToast('شكراً لك! تم استلام طلب الدفع الخاص بك وجاري تجهيزه.', 'success');
        loadOrders(); // Reload orders to show new status
      }, 3000);
    } catch (err: any) {
      console.error('[Payment] Failed to confirm payment:', err);
      showToast(err.message || 'فشل في تأكيد الدفع. يرجى المحاولة لاحقاً.', 'error');
      setIsConfirmingPayment(false);
    }
  };

  const loadOrders = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchOrders();
      setOrders(data);
    } catch (err) {
      console.error('Failed to load orders:', err);
      showToast(t('my_orders.load_error') || 'فشل في تحميل الطلبات', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.id.toString().includes(searchTerm) || 
      order.items.some((item: any) => item.product.name.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const isCompleted = order.status === 'DELIVERED' || order.status === 'CANCELLED';
    const matchesTab = activeTab === 'completed' ? isCompleted : !isCompleted;

    return matchesSearch && matchesTab;
  });

  if (loading) return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl font-display" dir="rtl">
      {/* Payment Modal */}
      {showPaymentModal && selectedOrder && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-500">
            {/* Modal Header */}
            <div className="relative p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col items-center gap-4">
              <h3 className="text-xl font-black text-slate-900 dark:text-white">اختر طريقة الدفع</h3>
              <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-full">
                <button 
                  onClick={() => setPaymentMethod('zaincash')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-black transition-all ${
                    paymentMethod === 'zaincash' 
                    ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  زين كاش
                </button>
                <button 
                  onClick={() => setPaymentMethod('qicard')}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-black transition-all ${
                    paymentMethod === 'qicard' 
                    ? 'bg-white dark:bg-slate-700 text-primary shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
                  }`}
                >
                  كي كارد
                </button>
              </div>
              <button 
                onClick={() => setShowPaymentModal(false)}
                className="absolute left-6 top-6 p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-red-500 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 flex flex-col items-center text-center gap-6">
              {!paymentDone ? (
                <>
                  <div className="flex flex-col gap-2 w-full">
                    <span className="text-slate-500 dark:text-slate-400 text-sm font-bold">المبلغ المطلوب دفعه</span>
                    <span className="text-3xl font-black text-primary font-sans" dir="ltr">
                      {(selectedOrder.total + (selectedOrder.internationalShippingFee || 0)).toLocaleString()} د.ع
                    </span>
                  </div>

                  <div className="relative group">
                    <div className="absolute -inset-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                    <div className="relative size-56 bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-center overflow-hidden">
                      {paymentMethod === 'zaincash' ? (
                        storeSettings?.zainCashQR ? (
                          <img 
                            src={storeSettings.zainCashQR} 
                            alt="ZainCash QR Code" 
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-slate-300">
                            <CreditCard size={48} />
                            <span className="text-xs font-bold">بانتظار رفع الرمز</span>
                          </div>
                        )
                      ) : (
                        storeSettings?.qicardQR ? (
                          <img 
                            src={storeSettings.qicardQR} 
                            alt="QiCard QR Code" 
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-slate-300">
                            <CreditCard size={48} />
                            <span className="text-xs font-bold">بانتظار رفع الرمز</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 w-full p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {paymentMethod === 'zaincash' 
                        ? 'يمكنك المسح الضوئي لرمز الـ QR أعلاه للدفع مباشرة عبر زين كاش، أو التحويل يدوياً إلى الرقم التالي:'
                        : 'افتح "إرسال" في تطبيق سوبر كي وامسح الرمز أعلاه، أو التحويل يدوياً إلى الرقم التالي:'
                      }
                    </p>
                    <div className="flex items-center justify-center gap-2 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm select-all">
                      <span className="text-lg font-black text-slate-900 dark:text-white font-sans tracking-wider">
                        {storeSettings?.contactPhone || '07779786420'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 w-full pt-2">
                    <button 
                      onClick={() => setShowPaymentModal(false)}
                      className="px-6 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                    >
                      إلغاء
                    </button>
                    <button 
                      onClick={handlePaymentDone}
                      disabled={isConfirmingPayment}
                      className="px-6 py-4 rounded-2xl bg-primary text-white font-black shadow-lg shadow-primary/30 hover:bg-blue-600 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isConfirmingPayment ? <Loader2 size={20} className="animate-spin" /> : 'تأكيد الدفع'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="py-12 flex flex-col items-center gap-6 animate-in zoom-in duration-500">
                  <div className="size-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center text-green-500 animate-bounce-slow">
                    <Loader2 size={48} className="animate-spin" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <h4 className="text-2xl font-black text-slate-900 dark:text-white">جاري معالجة طلبك</h4>
                    <p className="text-slate-500 dark:text-slate-400 max-w-[260px]">
                      شكراً لك! لقد سجلنا طلب الدفع الخاص بك. سنقوم بمراجعة العملية وتأكيد طلبك في أقرب وقت ممكن.
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Modal Footer Decorative */}
            <div className="h-2 bg-gradient-to-r from-purple-600 via-primary to-blue-600"></div>
          </div>
        </div>
      )}

      {/* Scrollable Area */}
      <div className="flex-1 flex flex-col">
        {/* Header Section */}
        <div className="sticky top-0 z-50 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-md transition-colors border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between px-4 h-16">
            <button 
              onClick={() => navigate(-1)}
              className="w-10 h-10 flex items-center justify-center rounded-full text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ArrowRight size={24} />
            </button>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">{t('my_orders.title')}</h1>
            {/* Refresh Button */}
            <button 
              onClick={handleRefresh}
              className={`flex items-center justify-center size-10 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-900 dark:text-white transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={24} />
            </button>
          </div>
          {/* Segmented Control Tabs */}
          <div className="px-4 pb-3 pt-1">
            <div className="flex h-12 w-full items-center justify-center rounded-xl bg-slate-200/50 dark:bg-slate-800 p-1">
              <label 
                className={`flex cursor-pointer h-full flex-1 items-center justify-center rounded-lg px-2 transition-all duration-200 ${activeTab === 'current' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                onClick={() => setActiveTab('current')}
              >
                <span className="text-sm font-bold truncate">{t('my_orders.current')}</span>
                <input className="hidden" name="order-type" type="radio" checked={activeTab === 'current'} readOnly />
              </label>
              <label 
                className={`flex cursor-pointer h-full flex-1 items-center justify-center rounded-lg px-2 transition-all duration-200 ${activeTab === 'completed' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
                onClick={() => setActiveTab('completed')}
              >
                <span className="text-sm font-medium truncate">{t('my_orders.completed')}</span>
                <input className="hidden" name="order-type" type="radio" checked={activeTab === 'completed'} readOnly />
              </label>
            </div>
          </div>

        </div>

        {/* Search Bar */}
        <div className="px-4 py-2 sticky top-[128px] z-40 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur-sm transition-colors border-b border-slate-100 dark:border-slate-800">
          <label className="relative flex w-full items-center">
            <div className="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400">
              <Search size={20} />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('my_orders.search_placeholder')}
              className="w-full h-11 pr-11 pl-4 rounded-xl bg-slate-100 dark:bg-slate-800/50 border-none focus:ring-2 focus:ring-primary/20 outline-none transition-all placeholder:text-slate-400 text-sm"
            />
          </label>
        </div>

        {/* Orders List Container */}
        <div className="flex-1 flex flex-col gap-4 p-4 pb-24">
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center" dir="rtl">
              <div className="size-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 mb-6">
                <Inbox size={48} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
                {activeTab === 'current' ? 'لا توجد طلبات حالية' : 'لا توجد طلبات مكتملة'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-[280px]">
                {activeTab === 'current' 
                  ? 'ابدأ بالتسوق الآن وستظهر طلباتك الجارية هنا لمتابعتها.' 
                  : 'جميع طلباتك المكتملة أو الملغاة ستظهر في هذا القسم.'}
              </p>
              <button
                onClick={() => navigate('/')}
                className="px-8 py-3 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
              >
                تصفح المنتجات
              </button>
            </div>
          ) : (
            filteredOrders.map(order => (
              <div key={order.id} className="flex flex-col bg-white dark:bg-slate-800 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none border border-slate-100 dark:border-slate-700 overflow-hidden">
                {/* Card Header */}
                <div className="flex justify-between items-start p-4 border-b border-slate-50 dark:border-slate-700/50">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('my_orders.order_no')}</span>
                    <span className="text-base font-bold font-sans text-slate-900 dark:text-white" dir="ltr">#{order.id}</span>
                  </div>
                  <div className="flex flex-col gap-1 text-left">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{t('my_orders.order_date')}</span>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {new Date(order.createdAt).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </span>
                  </div>
                </div>
                {/* Product Thumbnails */}
                <div className="flex gap-3 px-4 py-3 overflow-x-auto no-scrollbar items-center">
                  {order.items.map((item: any, idx: number) => (
                    <div key={idx} className="relative size-16 shrink-0 rounded-lg overflow-hidden border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                      <LazyImage 
                        src={item.product.image} 
                        alt={item.product.name}
                        className="w-full h-full"
                      />
                    </div>
                  ))}
                </div>

                {/* Fee and Totals Info */}
                {(order.internationalShippingFee > 0 || order.status === 'AWAITING_PAYMENT') && (
                  <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/20 border-t border-slate-50 dark:border-slate-700/50 flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-bold">المجموع الفرعي:</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200 font-sans">{order.total.toLocaleString()} د.ع</span>
                    </div>
                    {order.internationalShippingFee > 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-blue-500 font-bold">تكاليف شحن دولي إضافية:</span>
                        <span className="font-bold text-blue-500 font-sans">+{order.internationalShippingFee.toLocaleString()} د.ع</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-sm font-black text-slate-900 dark:text-white">الإجمالي النهائي:</span>
                      <span className="text-base font-black text-primary font-sans">{(order.total + (order.internationalShippingFee || 0)).toLocaleString()} د.ع</span>
                    </div>
                  </div>
                )}
                {/* Status & Action Footer */}
                <div className="flex items-center justify-between p-3 bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className={`flex size-2.5 rounded-full ${order.status === 'DELIVERED' ? 'bg-green-500' : order.status === 'CANCELLED' ? 'bg-red-500' : order.status === 'AWAITING_PAYMENT' ? 'bg-purple-500 animate-pulse' : 'bg-blue-500 animate-pulse'}`}></span>
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {t(`status.${order.status.toLowerCase()}`)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleSupportClick(order.id)}
                      className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-primary transition-colors"
                      title="الدعم الفني"
                    >
                      <Headset size={20} />
                    </button>
                    {order.status === 'PENDING' && (
                      <button 
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={isCancelling === order.id}
                        className="px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold transition-all hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-100 dark:border-red-900/30 flex items-center gap-1 disabled:opacity-50"
                      >
                        {isCancelling === order.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                        {isCancelling === order.id ? t('my_orders.reordering') : t('my_orders.cancel')}
                      </button>
                    )}
                    {order.status === 'DELIVERED' && (
                      <button 
                        onClick={() => handleReorder(order)}
                        disabled={isReordering === order.id}
                        className="px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold transition-all hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-1 disabled:opacity-50"
                      >
                        {isReordering === order.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        {isReordering === order.id ? t('my_orders.reordering') : t('my_orders.reorder')}
                      </button>
                    )}
                    {order.status === 'AWAITING_PAYMENT' && (
                      <button 
                        onClick={() => handlePaymentClick(order)}
                        className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-black transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2 animate-bounce-slow"
                      >
                        <CreditCard size={14} />
                        ادفع هنا
                      </button>
                    )}
                    <button 
                      onClick={() => navigate(`/shipping-tracking?id=${order.id}`)}
                      className="px-4 py-2 rounded-lg bg-primary hover:bg-blue-600 text-white text-sm font-bold transition-colors shadow-md shadow-blue-500/20"
                    >
                      {t('my_orders.track')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default MyOrders;
