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
  Loader2,
  CheckCircle2,
  Wallet
} from 'lucide-react';
import { fetchOrders, cancelOrder, confirmOrderPayment } from '../services/api';
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
  
  // Payment Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [paymentDone, setPaymentDone] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  const handlePaymentDone = async () => {
    if (!selectedOrder || isConfirmingPayment) return;
    
    setIsConfirmingPayment(true);
    try {
      console.log(`[Payment] Confirming payment for order ${selectedOrder.id}`);
      const result = await confirmOrderPayment(selectedOrder.id);
      console.log(`[Payment] API Response:`, result);
      
      setPaymentDone(true);
      
      // Delay to show success animation/message
      setTimeout(() => {
        setShowPaymentModal(false);
        setSelectedOrder(null);
        setPaymentDone(false);
        setIsConfirmingPayment(false);
        showToast('شكراً لك! تم استلام طلب الدفع الخاص بك وجاري تجهيزه.', 'success');
        loadOrders(); // Refresh orders to show status update
      }, 3000);
    } catch (err: any) {
      console.error('[Payment] Failed to confirm payment:', err);
      showToast(err.message || 'فشل في تأكيد الدفع. يرجى المحاولة لاحقاً.', 'error');
      setIsConfirmingPayment(false);
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
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowPaymentModal(true);
                        }}
                        className="px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-black transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2 animate-bounce-slow"
                      >
                        <CreditCard size={14} />
                        ادفع الآن
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

      {/* Payment Modal */}
      {showPaymentModal && selectedOrder && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div 
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-500 border-t sm:border border-slate-200 dark:border-slate-800 rtl flex flex-col max-h-[95vh]"
            dir="rtl"
          >
            {/* Modal Handle (for mobile) */}
            <div className="w-full flex justify-center pt-3 sm:hidden">
              <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
            </div>

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <Wallet size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">إتمام عملية الدفع</h3>
                  <p className="text-xs text-slate-500">طلب رقم #{selectedOrder.id}</p>
                </div>
              </div>
              <button 
                onClick={() => !isConfirmingPayment && setShowPaymentModal(false)}
                className="size-10 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              {!paymentDone ? (
                <div className="flex flex-col gap-6">
                  {/* Amount Section */}
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 text-center">
                    <p className="text-sm text-slate-500 mb-1">المبلغ المطلوب دفعه</p>
                    <div className="text-3xl font-black text-primary font-sans tracking-tight">
                      {(selectedOrder.total + (selectedOrder.internationalShippingFee || 0)).toLocaleString()} <span className="text-sm">د.ع</span>
                    </div>
                  </div>

                  {/* Payment Instructions */}
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <div className="size-1.5 rounded-full bg-primary"></div>
                      اختر وسيلة الدفع المناسبة لك:
                    </p>

                    <div className="grid grid-cols-1 gap-4">
                      {/* Zain Cash */}
                      <div className="flex flex-col gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 dark:text-white">زين كاش (Zain Cash)</span>
                          <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full font-bold">نشط</span>
                        </div>
                        <div className="aspect-square w-full max-w-[200px] mx-auto bg-white rounded-xl p-2 shadow-inner border border-slate-100 flex items-center justify-center overflow-hidden">
                          <img 
                            src="/assets/payment/zaincash_qr.png" 
                            alt="Zain Cash QR" 
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              console.error('Failed to load ZainCash QR image');
                              e.currentTarget.src = 'https://placehold.co/400x400?text=ZainCash+QR';
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-center text-slate-500">قم بمسح الكود أعلاه عبر تطبيق زين كاش</p>
                      </div>

                      {/* Qi Card */}
                      <div className="flex flex-col gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 dark:text-white">كي كارد (Qi Card)</span>
                          <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full font-bold">نشط</span>
                        </div>
                        <div className="aspect-square w-full max-w-[200px] mx-auto bg-white rounded-xl p-2 shadow-inner border border-slate-100 flex items-center justify-center overflow-hidden">
                          <img 
                            src="/assets/payment/qicard_qr.png" 
                            alt="Qi Card QR" 
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              console.error('Failed to load QiCard QR image');
                              e.currentTarget.src = 'https://placehold.co/400x400?text=QiCard+QR';
                            }}
                          />
                        </div>
                        <p className="text-[10px] text-center text-slate-500">قم بمسح الكود أعلاه عبر تطبيق كي كارد</p>
                      </div>
                    </div>
                  </div>

                  {/* Warning Box */}
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-100 dark:border-amber-900/30">
                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                      * يرجى الضغط على "تم التحويل" بعد إتمام العملية لكي يتم تحديث حالة طلبك.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="size-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center text-green-600 dark:text-green-400 mb-6 animate-bounce">
                    <CheckCircle2 size={48} />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-3">تم إرسال الطلب!</h3>
                  <p className="text-slate-500 dark:text-slate-400 max-w-[250px]">
                    شكراً لك! لقد استلمنا إشعار الدفع الخاص بك. سيتم مراجعة العملية وتحديث حالة طلبك خلال دقائق.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
              {!paymentDone ? (
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handlePaymentDone}
                    disabled={isConfirmingPayment}
                    className="w-full py-4 bg-primary hover:bg-blue-600 disabled:bg-slate-300 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                  >
                    {isConfirmingPayment ? (
                      <Loader2 size={24} className="animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 size={24} />
                        تم التحويل
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => setShowPaymentModal(false)}
                    disabled={isConfirmingPayment}
                    className="w-full py-3 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-sm transition-all active:scale-[0.98]"
                  >
                    إلغاء
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setShowPaymentModal(false)}
                  className="w-full py-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-black text-lg transition-all active:scale-[0.98]"
                >
                  إغلاق
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyOrders;
