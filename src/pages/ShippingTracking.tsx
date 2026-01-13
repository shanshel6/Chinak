import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  ChevronLeft, 
  Bell, 
  CreditCard, 
  Wallet, 
  RefreshCw, 
  Calendar, 
  XCircle, 
  MapPin, 
  HelpCircle, 
  Copy, 
  Headset,
  ReceiptText,
  CheckCircle2,
  Package,
  Truck,
  PackageSearch,
  Loader2,
  X,
  Home
} from 'lucide-react';
import { Clipboard } from '@capacitor/clipboard';
import { fetchOrderById, cancelOrder, fetchStoreSettings, confirmOrderPayment } from '../services/api';
import LazyImage from '../components/LazyImage';
import { useNotificationStore } from '../store/useNotificationStore';
import { useToastStore } from '../store/useToastStore';
import { useTranslation } from 'react-i18next';
import { socket, connectSocket } from '../services/socket';

const ShippingTracking: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const showToast = useToastStore((state) => state.showToast);
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'zaincash' | 'qicard'>('zaincash');
  const [storeSettings, setStoreSettings] = useState<any>(null);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  
  const unreadNotifications = useNotificationStore(state => state.unreadCount);

  const orderId = new URLSearchParams(location.search).get('id');

  useEffect(() => {
    if (orderId) {
      loadOrder(orderId);
      loadSettings();
      
      // Real-time tracking updates
      connectSocket();
      
      const handleOrderUpdate = (data: any) => {
        console.log('Order status update received:', data);
        if (String(data.id || data.orderId) === String(orderId)) {
          loadOrder(orderId);
          showToast(t('tracking.status_updated_live'), 'info');
        }
      };

      // Listen for both the specific and general update events
      socket.on(`order_status_updated_${orderId}`, handleOrderUpdate);
      socket.on('order_status_update', handleOrderUpdate);

      return () => {
        socket.off(`order_status_updated_${orderId}`, handleOrderUpdate);
        socket.off('order_status_update', handleOrderUpdate);
      };
    }
  }, [orderId]);

  const loadOrder = async (id: number | string) => {
    try {
      const data = await fetchOrderById(id);
      // Enhance order with mock tracking events for realism
      const enhancedOrder = {
        ...data,
        trackingEvents: generateTrackingEvents(data)
      };
      setOrder(enhancedOrder);
    } catch (err) {
      console.error('Failed to load order:', err);
      showToast(t('tracking.order_load_error'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await fetchStoreSettings();
      setStoreSettings(settings);
    } catch (err) {
      console.error('Failed to load store settings:', err);
    }
  };

  const handlePaymentDone = async () => {
    if (!order || isConfirmingPayment) return;
    
    setIsConfirmingPayment(true);
    try {
      await confirmOrderPayment(order.id);
      setPaymentDone(true);
      
      setTimeout(() => {
        setShowPaymentModal(false);
        setPaymentDone(false);
        setIsConfirmingPayment(false);
        showToast('شكراً لك! تم استلام طلب الدفع الخاص بك وجاري تجهيزه.', 'success');
        loadOrder(order.id);
      }, 3000);
    } catch (err: any) {
      console.error('Failed to confirm payment:', err);
      showToast(err.message || 'فشل في تأكيد الدفع. يرجى المحاولة لاحقاً.', 'error');
      setIsConfirmingPayment(false);
    }
  };

  const generateTrackingEvents = (order: any) => {
    const events = [];
    const date = new Date(order.createdAt);
    const lang = 'ar-IQ';
    
    // Define logical status sequence
    const statusSequence = ['PENDING', 'AWAITING_PAYMENT', 'PREPARING', 'SHIPPED', 'ARRIVED_IRAQ', 'DELIVERED'];
    const currentStatusIndex = statusSequence.indexOf(order.status);
    
    // 1. Order Confirmed (Always show as completed)
    events.push({
      status: 'CONFIRMED',
      title: t('status.pending'),
      description: t('tracking.status_desc_pending'),
      time: date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
      date: date.toLocaleDateString(lang, { day: 'numeric', month: 'long' }),
      completed: true,
      icon: ReceiptText
    });
    
    // 2. Awaiting Payment
    if (currentStatusIndex >= 1 || order.internationalShippingFee > 0) {
      const isPaid = currentStatusIndex >= 2;
      const payDate = new Date(date.getTime() + 4 * 60 * 60 * 1000);
      
      events.push({
        status: 'AWAITING_PAYMENT',
        title: isPaid ? "تم دفع تكاليف الشحن" : t('status.awaiting_payment'),
        description: isPaid ? "تم استلام مبلغ الشحن الدولي بنجاح." : t('tracking.status_desc_awaiting_payment'),
        time: payDate.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
        date: payDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' }),
        completed: isPaid,
        icon: isPaid ? CheckCircle2 : CreditCard
      });
    }

    // 3. Preparing
    if (currentStatusIndex >= 2) {
      const isPreparingDone = currentStatusIndex >= 3;
      const procDate = new Date(date.getTime() + 6 * 60 * 60 * 1000);
      events.push({
        status: 'PREPARING',
        title: t('status.preparing'),
        description: t('tracking.status_desc_preparing'),
        time: procDate.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
        date: procDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' }),
        completed: isPreparingDone,
        icon: Package
      });
    }

    // 4. Shipped
    if (currentStatusIndex >= 3) {
      const isShippedDone = currentStatusIndex >= 4;
      const shipDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
      
      let arrivalMessage = '';
      const arrivalDate = new Date(shipDate.getTime());
      if (order.shippingMethod === 'air') {
        arrivalDate.setDate(arrivalDate.getDate() + 12);
        arrivalMessage = `موعد الوصول المتوقع: ${arrivalDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' })}`;
      } else if (order.shippingMethod === 'sea') {
        arrivalDate.setMonth(arrivalDate.getMonth() + 2);
        arrivalMessage = `موعد الوصول المتوقع: ${arrivalDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' })}`;
      }

      events.push({
        status: 'SHIPPED',
        title: t('status.shipped'),
        description: arrivalMessage || t('tracking.status_desc_shipped'),
        time: shipDate.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
        date: shipDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' }),
        completed: isShippedDone,
        icon: Truck
      });
    }

    // 5. Arrived to Iraq
    if (currentStatusIndex >= 4) {
      const isArrivedDone = currentStatusIndex >= 5;
      const arrivedDate = new Date(date.getTime() + 48 * 60 * 60 * 1000);
      events.push({
        status: 'ARRIVED_IRAQ',
        title: t('status.arrived_iraq'),
        description: t('tracking.status_desc_arrived_iraq'),
        time: arrivedDate.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
        date: arrivedDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' }),
        completed: isArrivedDone,
        icon: PackageSearch
      });
    }

    // 6. Delivered
    if (currentStatusIndex >= 5) {
      const delDate = new Date(order.updatedAt || date.getTime() + 72 * 60 * 60 * 1000);
      events.push({
        status: 'DELIVERED',
        title: t('status.delivered'),
        description: t('tracking.status_desc_delivered'),
        time: delDate.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
        date: delDate.toLocaleDateString(lang, { day: 'numeric', month: 'long' }),
        completed: true,
        icon: Home
      });
    }

    return events.reverse(); // Newest first
  };

  const handleCancelOrder = async () => {
    if (!order || !window.confirm(t('dashboard.orders.cancel_confirm'))) return;
    
    setIsCancelling(true);
    try {
      await cancelOrder(order.id);
      await loadOrder(order.id); // Reload to show updated status
      showToast(t('dashboard.orders.cancel_success'), 'success');
    } catch (err) {
      console.error('Failed to cancel order:', err);
      showToast(t('dashboard.orders.cancel_error'), 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  if (loading) return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl items-center justify-center rtl" dir="rtl">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  );

  if (!order) return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl items-center justify-center p-4 text-center rtl" dir="rtl">
      <h2 className="text-xl font-bold mb-2">{t('tracking.order_not_found')}</h2>
      <button onClick={() => navigate('/orders')} className="text-primary font-bold">{t('tracking.back_to_orders')}</button>
    </div>
  );

  const firstItem = order.items?.[0]?.product;

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl font-display text-slate-900 dark:text-slate-100 antialiased selection:bg-primary/30 rtl" dir="rtl">
      <style>{`
        @keyframes pulse-ring {
            0% { transform: scale(0.33); }
            80%, 100% { opacity: 0; }
        }
        @keyframes pulse-subtle {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }
        .pulse-ring {
            position: absolute;
            left: 0;
            top: 0;
            display: block;
            width: 100%;
            height: 100%;
            border-radius: 9999px;
            box-shadow: 0 0 0 0 rgba(43, 140, 238, 0.7);
            animation: pulse-ring 1.25s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
        }
        .animate-pulse-subtle {
            animation: pulse-subtle 2s ease-in-out infinite;
        }
      `}</style>
      
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center bg-background-light/80 dark:bg-background-dark/80 backdrop-blur-md px-4 py-4 justify-between border-b border-slate-200 dark:border-slate-800 transition-colors">
          <button 
            onClick={() => navigate(-1)}
            className="text-slate-900 dark:text-white flex size-10 shrink-0 items-center justify-center rounded-full active:bg-slate-200 dark:active:bg-slate-700 transition-colors cursor-pointer"
          >
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-slate-900 dark:text-white text-lg font-bold leading-tight tracking-[-0.015em] flex-1 text-center pr-2">{t('tracking.title')}</h2>
          <button 
            onClick={() => navigate('/notifications')}
            className="relative text-slate-900 dark:text-white flex size-10 shrink-0 items-center justify-center rounded-full active:bg-slate-200 dark:active:bg-slate-700 transition-colors cursor-pointer"
          >
            <Bell size={24} />
            {unreadNotifications > 0 && (
              <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                {unreadNotifications}
              </span>
            )}
          </button>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 flex flex-col gap-6 p-4 pb-10">
          {/* Need Payment Action Card */}
          {order.status === 'AWAITING_PAYMENT' && (
            <div className="flex flex-col gap-4 bg-purple-50 dark:bg-purple-900/20 rounded-2xl p-5 border border-purple-200 dark:border-purple-800 shadow-sm animate-pulse-subtle">
              <div className="flex items-start gap-4">
                <div className="size-12 rounded-full bg-purple-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-purple-500/30">
                  <CreditCard size={28} />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-purple-900 dark:text-purple-300 text-lg font-bold">بانتظار الدفع</h3>
                  <p className="text-purple-700 dark:text-purple-400 text-sm leading-relaxed">
                    يرجى إتمام عملية دفع تكاليف الشحن الدولي للمباشرة بتجهيز طلبك.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowPaymentModal(true)}
                className="w-full py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-lg shadow-xl shadow-purple-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
              >
                <Wallet size={24} />
                ادفع الآن
              </button>
            </div>
          )}

          {/* Order Summary Card */}
          <div className="flex items-stretch justify-between gap-4 rounded-xl bg-white dark:bg-slate-800 p-4 shadow-sm border border-slate-100 dark:border-slate-700/50 transition-colors">
            <div className="flex flex-[2_2_0px] flex-col justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-slate-900 dark:text-white text-base font-bold leading-tight">
                  {order.items.length > 1 ? t('tracking.order_id_with_qty', { id: order.id, count: order.items.length }) : firstItem?.name}
                </p>
                <p className="text-slate-500 dark:text-slate-400 text-xs font-normal leading-normal">{t('tracking.tracking_no')}: <span dir="ltr">#IQ-{order.id}-{new Date(order.createdAt).getTime().toString().slice(-6)}</span></p>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary text-xs font-semibold px-2 py-1 rounded-md">
                  {t(`status.${order.status.toLowerCase()}`)}
                </span>
              </div>
            </div>
            <div className="w-24 h-24 rounded-lg overflow-hidden shrink-0 border border-slate-100 dark:border-slate-700">
              <LazyImage 
                src={firstItem?.image} 
                alt={firstItem?.name} 
                className="w-full h-full" 
              />
            </div>
          </div>


          {/* Estimated Delivery */}
          {(order.status === 'SHIPPED' || order.status === 'DELIVERED') && (
            <div className="flex items-center gap-4 bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700/50">
              <div className="flex items-center justify-center rounded-full bg-primary/10 text-primary shrink-0 size-12">
                <Calendar size={24} />
              </div>
              <div className="flex flex-col justify-center">
                <p className="text-slate-500 dark:text-slate-400 text-sm font-normal leading-normal">{t('tracking.expected_arrival')}</p>
                <p className="text-slate-900 dark:text-white text-lg font-bold leading-normal">
                  {(() => {
                    const baseDate = order.shippedAt ? new Date(order.shippedAt) : 
                                     order.updatedAt ? new Date(order.updatedAt) :
                                     new Date(new Date(order.createdAt).getTime() + 24 * 60 * 60 * 1000);
                    const arrivalDate = new Date(baseDate.getTime());
                    if (order.shippingMethod === 'air') {
                      arrivalDate.setDate(arrivalDate.getDate() + 12);
                    } else if (order.shippingMethod === 'sea') {
                      arrivalDate.setMonth(arrivalDate.getMonth() + 2);
                    }
                    return arrivalDate.toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long' });
                  })()}
                </p>
              </div>
            </div>
          )}

          {/* Tracking Timeline */}
          <h3 className="text-slate-900 dark:text-white text-lg font-bold px-1 pt-2">{t('tracking.route')}</h3>
          
          <div className="relative px-2 pb-6">
            <div className="absolute top-2 bottom-0 right-[27px] w-0.5 bg-slate-200 dark:bg-slate-700 z-0"></div>

            {order.status === 'CANCELLED' ? (
              <div className="relative flex gap-6 pb-8 z-10">
                <div className="relative shrink-0 flex flex-col items-center">
                  <div className="size-10 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/30 z-10 relative">
                    <XCircle size={20} />
                  </div>
                </div>
                <div className="flex flex-1 flex-col pt-1">
                  <p className="text-red-600 dark:text-red-400 text-base font-bold">{t('status.cancelled')}</p>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('tracking.cancelled_text')}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {order.trackingEvents?.map((event: any, idx: number) => (
                  <div key={idx} className={`relative flex gap-6 pb-8 z-10 ${event.completed ? 'opacity-100' : 'opacity-40'}`}>
                    <div className="relative shrink-0 flex flex-col items-center">
          <div className={`size-10 rounded-full flex items-center justify-center text-white shadow-lg z-10 relative ${event.completed ? 'bg-primary shadow-primary/30' : event.status === 'OUT_FOR_DELIVERY' ? 'bg-amber-500 shadow-amber-500/30' : 'bg-slate-300 dark:bg-slate-600'}`}>
            <event.icon size={20} />
            {(idx === 0 && order.status !== 'DELIVERED' && order.status !== 'CANCELLED') && (
              <div className={`pulse-ring ${event.status === 'OUT_FOR_DELIVERY' ? 'bg-amber-500' : 'bg-primary'}`}></div>
            )}
          </div>
                    </div>
                    <div className="flex flex-1 flex-col pt-1">
                      <div className="flex justify-between items-start">
                        <p className={`text-base font-bold ${event.status === 'OUT_FOR_DELIVERY' && order.status === 'SHIPPED' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{event.title}</p>
                        <span className="text-[10px] text-slate-400 font-medium">{event.date} - {event.time}</span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 leading-relaxed">{event.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Order Items Section */}
          <div className="flex flex-col gap-4 mt-2">
            <h3 className="text-slate-900 dark:text-white text-lg font-bold px-1">{t('tracking.order_contents')}</h3>
            <div className="flex flex-col gap-3">
              {order.items.map((item: any, idx: number) => (
                <div key={idx} className="flex items-center gap-4 bg-white dark:bg-slate-800 p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700/50">
                  <div className="size-16 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-100 dark:border-slate-700">
                    <LazyImage 
                      src={item.product.image} 
                      alt={item.product.name}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{item.product.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t('tracking.qty')}: {item.quantity}</p>
                    <p className="text-sm font-bold text-primary">{item.price.toLocaleString()} {t('common.iqd')}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Price Summary Section */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700/50 flex flex-col gap-3 mt-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500 dark:text-slate-400">{t('tracking.subtotal')}</span>
              <span className="text-slate-900 dark:text-white font-medium">{(order.total + (order.discountAmount || 0)).toLocaleString()} {t('common.iqd')}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between items-center text-sm text-green-600 dark:text-green-400 font-bold">
                <div className="flex items-center gap-1">
                  <span>الخصم</span>
                  {order.couponCode && <span className="text-[10px] bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded uppercase tracking-wider">({order.couponCode})</span>}
                </div>
                <span>-{order.discountAmount.toLocaleString()} {t('common.iqd')}</span>
              </div>
            )}
            {order.internationalShippingFee > 0 && (
              <div className="flex justify-between items-center text-sm text-purple-600 dark:text-purple-400 font-bold">
                <span>{t('tracking.international_shipping')}</span>
                <span>+{order.internationalShippingFee.toLocaleString()} {t('common.iqd')}</span>
              </div>
            )}
            <div className="h-px bg-slate-100 dark:bg-slate-700 my-1"></div>
            <div className="flex justify-between items-center">
              <span className="text-base font-bold text-slate-900 dark:text-white">{t('tracking.total')}</span>
              <span className="text-lg font-bold text-primary">{(order.total + (order.internationalShippingFee || 0)).toLocaleString()} {t('common.iqd')}</span>
            </div>
          </div>

          {/* Shipping Address Section */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700/50 flex flex-col gap-3 mt-2">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
              <MapPin size={20} className="text-primary" />
              <h3>{t('tracking.address')}</h3>
            </div>
            {order.address ? (
              <div className="flex flex-col gap-1 pr-7">
                <p className="text-sm font-bold text-slate-900 dark:text-white">{order.address.name}</p>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 ltr" dir="ltr">
                  <div className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500/10 text-green-600">
                    <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.72.937 3.659 1.432 5.631 1.432h.006c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                  </div>
                  <span>{order.address.phone}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {order.address.city}، {order.address.street}
                  {order.address.buildingNo && `، ${t('tracking.bldg')} ${order.address.buildingNo}`}
                  {order.address.floorNo && `، ${t('tracking.floor')} ${order.address.floorNo}`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400 pr-7 italic">{t('tracking.no_address')}</p>
            )}
            <div className="h-px bg-slate-100 dark:bg-slate-700 my-1 mx-7"></div>
            <div className="flex items-center justify-between pr-7">
              <span className="text-xs text-slate-500 dark:text-slate-400">{t('tracking.shipping_method')}</span>
              <span className="text-xs font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">
                {order.shippingMethod === 'air' ? t('tracking.air_shipping') : t('tracking.sea_shipping')}
              </span>
            </div>
          </div>

          {/* Payment Method Section */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-100 dark:border-slate-700/50 flex flex-col gap-3 mt-2">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
              <CreditCard size={20} className="text-primary" />
              <h3>{t('tracking.payment_method')}</h3>
            </div>
            <div className="flex items-center justify-between pr-7">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {order.paymentMethod === 'zain_cash' ? t('tracking.zain_cash') : 
                 order.paymentMethod === 'super_key' ? t('tracking.super_key') : t('tracking.online_payment')}
              </p>
              <span className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded text-slate-500 uppercase">
                {order.paymentMethod?.replace('_', ' ') || 'PAYMENT'}
              </span>
            </div>
          </div>

          {/* Help Section */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-900/30 flex items-start gap-3 mt-4">
            <HelpCircle size={20} className="text-primary mt-0.5" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{t('tracking.help')}</p>
              <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                {t('tracking.help_desc')}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-100 dark:border-slate-800 p-4 rounded-2xl shadow-sm mt-4">
            <div className="flex gap-3">
              <button 
                onClick={async () => {
                  try {
                    await Clipboard.write({
                      string: `#IQ-${order.id}`
                    });
                    showToast(t('tracking.id_copied'), 'success');
                  } catch (err) {
                    console.error('Clipboard error:', err);
                    // Fallback to navigator if plugin fails
                    try {
                      await navigator.clipboard.writeText(`#IQ-${order.id}`);
                      showToast(t('tracking.id_copied'), 'success');
                    } catch (navErr) {
                      console.error('Navigator clipboard error:', navErr);
                    }
                  }
                }}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl font-bold active:scale-95 transition-all"
              >
                <Copy size={20} />
                نسخ رقم الطلب
              </button>
              <button 
                onClick={() => window.open('https://wa.me/8613223001309', '_blank')}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#25D366] text-white rounded-xl font-bold shadow-lg shadow-green-500/25 active:scale-95 transition-all"
              >
                <Headset size={20} />
                الدعم الفني
              </button>
            </div>
            
            {order.status === 'PENDING' && (
              <button 
                onClick={handleCancelOrder}
                disabled={isCancelling}
                className="w-full mt-3 py-3 text-red-500 dark:text-red-400 font-bold text-sm flex items-center justify-center gap-2 active:bg-red-50 dark:active:bg-red-900/10 rounded-xl transition-all disabled:opacity-50"
              >
                {isCancelling ? <RefreshCw size={20} className="animate-spin" /> : <XCircle size={20} />}
                {t('tracking.cancel_order')}
              </button>
            )}
          </div>
        </div>
      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-500 border-t sm:border border-slate-200 dark:border-slate-800 rtl" dir="rtl">
            {/* Modal Header */}
            <div className="relative p-6 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-col gap-1">
                <h3 className="text-xl font-black text-slate-900 dark:text-white">إكمال عملية الدفع</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">اختر وسيلة الدفع المناسبة لك</p>
              </div>
              
              {/* Payment Tabs */}
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mt-4">
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
                      {(order.total + (order.internationalShippingFee || 0)).toLocaleString()} د.ع
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
    </div>
  );
};

export default ShippingTracking;