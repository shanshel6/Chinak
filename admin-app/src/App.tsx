import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Package, 
  LogIn, 
  LogOut, 
  Bell, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  RefreshCw,
  ShoppingBag,
  Eye,
  Truck,
  Users,
  ShoppingCart,
  X,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  MessageCircle,
  FileText,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
  Save,
  Trash2,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Order, User } from './types';
import { 
  login, 
  fetchOrders, 
  updateOrderStatus, 
  updateApiUrl, 
  fetchAdminOrderDetails, 
  updateOrderInternationalFee,
  updateProductPriceFromOrder,
  archiveProductFromOrder,
  updateOrderPaymentMethod,
  fetchSettings
} from './services/api';
import { socket, updateSocketUrl } from './services/socket';
import { playOrderSound } from './services/sound';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App as CapApp } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import Invoice from './components/Invoice';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('api_url') || 'https://chinak-production.up.railway.app');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingItem, setEditingItem] = useState<any>(null);
  const [activeItemNote, setActiveItemNote] = useState<{ productName: string; note: string } | null>(null);
  const [newPriceValue, setNewPriceValue] = useState('');
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  
  const invoiceRef = useRef<HTMLDivElement>(null);
  const quotationRef = useRef<HTMLDivElement>(null);

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const handleUpdatePrice = async () => {
    if (!editingItem || !newPriceValue || !selectedOrder) return;
    console.log(`[ADMIN_APP] Attempting price update for product ${editingItem.productId}, order ${selectedOrder.id}, price ${newPriceValue}`);
    try {
      setIsUpdatingPrice(true);
      const response = await updateProductPriceFromOrder(editingItem.productId, selectedOrder.id, parseFloat(newPriceValue));
      console.log('[ADMIN_APP] Price update response:', response);
      
      // Update local state for immediate feedback
      const details = await fetchAdminOrderDetails(selectedOrder.id);
      setSelectedOrder(details);
      
      showSuccess('تم تحديث السعر بنجاح');
      setEditingItem(null);
      loadOrders();
    } catch (err: any) {
      console.error('[ADMIN_APP] Failed to update price:', err);
      if (err.response?.status !== 401) {
        const errorMsg = err.response?.data?.error || err.message || 'فشل تحديث السعر';
        alert(`فشل تحديث السعر: ${errorMsg}\n\nURL: ${apiUrl}`);
      }
    } finally {
      setIsUpdatingPrice(false);
    }
  };

  const handleUpdatePaymentMethod = async (orderId: number, method: string) => {
    try {
      await updateOrderPaymentMethod(orderId, method);
      loadOrders();
      if (selectedOrder && selectedOrder.id === orderId) {
        const updated = await fetchAdminOrderDetails(orderId);
        setSelectedOrder(updated);
      }
      showSuccess('تم تحديث وسيلة الدفع بنجاح');
    } catch (err: any) {
      console.error('Failed to update payment method:', err);
      if (err.response?.status !== 401) {
        alert('فشل في تحديث وسيلة الدفع');
      }
    }
  };

  const handleArchiveProduct = async () => {
    if (!editingItem || !selectedOrder) return;
    console.log(`[ADMIN_APP] Attempting archive for product ${editingItem.productId}, order ${selectedOrder.id}`);
    if (!window.confirm('هل أنت متأكد من حذف هذا المنتج؟ سيتم أرشفته وإخفاؤه عن جميع المستخدمين.')) return;
    
    try {
      setIsArchiving(true);
      const response = await archiveProductFromOrder(editingItem.productId, selectedOrder.id);
      console.log('[ADMIN_APP] Archive response:', response);
      
      showSuccess('تم حذف المنتج بنجاح');
      setEditingItem(null);
      
      const details = await fetchAdminOrderDetails(selectedOrder.id);
      setSelectedOrder(details);
      loadOrders();
    } catch (err: any) {
      console.error('[ADMIN_APP] Failed to archive product:', err);
      if (err.response?.status !== 401) {
        const errorMsg = err.response?.data?.error || err.message || 'فشل حذف المنتج';
        alert(`فشل حذف المنتج: ${errorMsg}\n\nURL: ${apiUrl}`);
      }
    } finally {
      setIsArchiving(false);
    }
  };

  const handleUpdateApiUrl = (url: string) => {
    setApiUrl(url);
    updateApiUrl(url);
    updateSocketUrl(url);
    socket.connect();
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await fetchSettings();
        setSettings(data);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    loadSettings();
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchOrders();
      console.log('[ADMIN_APP] Raw orders data:', data);
      
      let ordersList = [];
      if (Array.isArray(data)) {
        ordersList = data;
      } else if (data && Array.isArray(data.orders)) {
        ordersList = data.orders;
      } else {
        console.warn('[ADMIN_APP] Unexpected data format:', data);
      }
      
      setOrders(ordersList);
    } catch (err: any) {
      console.error('Failed to fetch orders:', err);
      if (err.response?.status !== 401) {
        const msg = err.response?.data?.error || err.message;
        alert(`فشل في تحميل الطلبات: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const joinAdminRoomLocal = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (token && socket.connected) {
      console.log('[ADMIN_APP] Joining admin room...');
      socket.emit('join_admin_room');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email, password);
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setIsAuthenticated(true);
      loadOrders();
      
      socket.connect();
      // Wait a bit for connection before joining room, or use the connect listener
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
    setOrders([]);
    socket.disconnect();
  };

  const handleOpenXianyu = (url: string) => {
    if (!url) return;
    
    // Attempt to convert to xianyu deep link if it's a taobao/xianyu web link
    // Standard format for xianyu/taobao is usually https://item.taobao.com/item.htm?id=xxx
    // Deep link format: fleamarket://item?id=xxx
    // For Android, we can also use intent scheme to force open the app
    let finalUrl = url;
    try {
      const urlObj = new URL(url);
      const id = urlObj.searchParams.get('id');
      if (id && (url.includes('taobao.com') || url.includes('xianyu.com') || url.includes('idlefish.com'))) {
        // Use intent scheme for Android to force open the app directly
        finalUrl = `intent://item?id=${id}#Intent;scheme=fleamarket;package=com.taobao.idlefish;end`;
      }
    } catch (e) {
      console.error('URL parsing failed, using original', e);
    }
    
    window.open(finalUrl, '_blank');
  };

  const handleUpdateStatus = async (orderId: number, status: string) => {
    try {
      await updateOrderStatus(orderId, status);
      loadOrders();
      if (selectedOrder && selectedOrder.id === orderId) {
        const updated = await fetchAdminOrderDetails(orderId);
        setSelectedOrder(updated);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const generateAndSharePDF = async (order: any, mode: 'invoice' | 'quotation') => {
    const ref = mode === 'invoice' ? invoiceRef : quotationRef;
    if (!ref.current) {
      console.error('Ref not found for mode:', mode);
      return null;
    }
    
    try {
      setIsGeneratingPDF(true);
      const element = ref.current;
      
      // Use a smaller scale and windowWidth for mobile performance
      const canvas = await html2canvas(element, {
        scale: 1.5,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 800
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.8);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      
      const pdfBase64 = pdf.output('datauristring').split(',')[1];
      const fileName = `DFC-${mode === 'invoice' ? 'Invoice' : 'Quotation'}-IQ-${order.id}.pdf`;
      
      // Save to temporary filesystem for sharing
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Cache
      });
      
      return savedFile.uri;
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      return null;
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleOpenWhatsApp = async (order: any) => {
    if (!order || !order.address?.phone) {
      alert('رقم الهاتف غير متوفر');
      return;
    }

    const phone = order.address.phone.replace(/\D/g, '');
    const fee = order.internationalShippingFee || 0;
    
    // Generate items list with detailed info and notes
    const itemsList = (order.items || []).map((item: any) => {
      const notes = item.notes ? `\n    └─ ملاحظة: ${item.notes}` : '';
      const options = item.selectedOptions ? 
        `\n    └─ التفاصيل: ${typeof item.selectedOptions === 'string' ? item.selectedOptions : JSON.stringify(item.selectedOptions)}` : '';
      const itemTotal = (item.price * item.quantity).toLocaleString();
      return `• ${item.product?.name || 'منتج'}
    الكمية: ${item.quantity} x ${item.price.toLocaleString()} د.ع = ${itemTotal} د.ع${options}${notes}`;
    }).join('\n\n');

    // Arabic formatted message for quotation
    const message = `مرحباً، هذا هو عرض سعر من DFC للمنتجات التي طلبتها

-----------------------------------
📋 طلب رقم: #IQ-${order.id}
التاريخ: ${new Date(order.createdAt).toLocaleDateString('ar-IQ')}
-----------------------------------

المنتجات المطلوبة:
${itemsList}

-----------------------------------
المجموع الفرعي: ${(order.total - fee).toLocaleString()} د.ع
كلفة الشحن الدولي: ${fee.toLocaleString()} د.ع
-----------------------------------
💰 المجموع الكلي: ${order.total.toLocaleString()} د.ع
-----------------------------------

مدة الشحن المتوقعة:
✈️ شحن جوي: 10 إلى 20 يوم
🚢 شحن بحري: شهرين

رابط التتبع:
https://chinak-production.up.railway.app/shipping-tracking?id=${order.id}`;

    // Copy phone number to clipboard to help user find contact
    try {
      await Clipboard.write({
        string: phone
      });
      showSuccess(`تم نسخ رقم الهاتف: ${phone}`);
    } catch (e) {
      console.error('Failed to copy phone number', e);
    }

    // Generate PDF first
    const pdfUri = await generateAndSharePDF(order, 'quotation');
    
    if (pdfUri) {
      // Share PDF and message together if possible
      try {
        await Share.share({
          title: `Quotation #IQ-${order.id}`,
          text: `رقم العميل: ${phone}\n\n${message}`,
          url: pdfUri,
          dialogTitle: 'ارسال عرض السعر عبر واتساب'
        });
      } catch (e) {
        // Fallback to wa.me if share fails
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/${phone}?text=${encodedMessage}`, '_blank');
      }
    } else {
      const encodedMessage = encodeURIComponent(message);
      window.open(`https://wa.me/${phone}?text=${encodedMessage}`, '_blank');
    }
  };

  const handleSendInvoice = async (order: any) => {
    if (!order || !order.address?.phone) {
      alert('رقم الهاتف غير متوفر');
      return;
    }

    const phone = order.address.phone.replace(/\D/g, '');
    const fee = order.internationalShippingFee || 0;
    
    // Generate items list with detailed info and notes
    const itemsList = (order.items || []).map((item: any) => {
      const notes = item.notes ? `\n    └─ ملاحظة: ${item.notes}` : '';
      const options = item.selectedOptions ? 
        `\n    └─ التفاصيل: ${typeof item.selectedOptions === 'string' ? item.selectedOptions : JSON.stringify(item.selectedOptions)}` : '';
      const itemTotal = (item.price * item.quantity).toLocaleString();
      return `• ${item.product?.name || 'منتج'}
    الكمية: ${item.quantity} x ${item.price.toLocaleString()} د.ع = ${itemTotal} د.ع${options}${notes}`;
    }).join('\n\n');

    // Arabic formatted message for invoice (payment confirmation)
    const message = `مرحباً من DFC، تم استلام مبلغ طلبك بنجاح ✅
إليك فاتورة تأكيد الدفع وتفاصيل طلبك الجاري تجهيزه.

-----------------------------------
🧾 فاتورة رقم: #IQ-${order.id}
التاريخ: ${new Date(order.createdAt).toLocaleDateString('ar-IQ')}
الحالة: تم استلام الدفع - قيد التجهيز
-----------------------------------

تفاصيل المنتجات:
${itemsList}

-----------------------------------
المجموع الفرعي: ${(order.total - fee).toLocaleString()} د.ع
كلفة الشحن الدولي: ${fee.toLocaleString()} د.ع
-----------------------------------
💰 المجموع الكلي المسدد: ${order.total.toLocaleString()} د.ع
-----------------------------------

نشكركم على ثقتكم بنا. سيتم إعلامكم عند شحن الطلب.

رابط التتبع والفاتورة:
https://chinak-production.up.railway.app/shipping-tracking?id=${order.id}`;

    // Copy phone number to clipboard
    try {
      await Clipboard.write({
        string: phone
      });
      showSuccess(`تم نسخ رقم الهاتف: ${phone}`);
    } catch (e) {
      console.error('Failed to copy phone number', e);
    }

    // Generate PDF first
    const pdfUri = await generateAndSharePDF(order, 'invoice');
    
    if (pdfUri) {
      try {
        await Share.share({
          title: `Invoice #IQ-${order.id}`,
          text: `رقم العميل: ${phone}\n\n${message}`,
          url: pdfUri,
          dialogTitle: 'ارسال الفاتورة عبر واتساب'
        });
      } catch (e) {
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://wa.me/${phone}?text=${encodedMessage}`, '_blank');
      }
    } else {
      const encodedMessage = encodeURIComponent(message);
      window.open(`https://wa.me/${phone}?text=${encodedMessage}`, '_blank');
    }
  };

  const handleUpdateFee = async (orderId: number, fee: number) => {
    try {
      await updateOrderInternationalFee(orderId, fee);
      loadOrders();
      if (selectedOrder && selectedOrder.id === orderId) {
        const updated = await fetchAdminOrderDetails(orderId);
        setSelectedOrder(updated);
      }
    } catch (err) {
      console.error('Failed to update fee:', err);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      setIsAuthenticated(true);
      setUser(JSON.parse(savedUser));
      loadOrders();
      if (!socket.connected) {
        socket.connect();
      }
    }

    LocalNotifications.requestPermissions();

    // App State Listener to handle background/foreground
    const stateListener = CapApp.addListener('appStateChange', ({ isActive }) => {
      console.log('[ADMIN_APP] App state changed. Is active:', isActive);
      if (isActive) {
        const token = localStorage.getItem('auth_token');
        if (token) {
          loadOrders();
          if (!socket.connected) {
            socket.connect();
          } else {
            joinAdminRoomLocal();
          }
        }
      }
    });

    // Polling fallback - refresh every 60 seconds even if socket fails
    const pollingInterval = setInterval(() => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        console.log('[ADMIN_APP] Polling orders fallback...');
        loadOrders();
        if (!socket.connected) {
          socket.connect();
        }
      }
    }, 60000);

    const onConnect = () => {
      console.log('[ADMIN_APP] Socket connected');
      joinAdminRoomLocal();
    };

    const onNewOrder = async (order: Order) => {
      console.log('[ADMIN_APP] New order received via socket:', order.id);
      
      setOrders(prev => {
        if (prev.some(o => o.id === order.id)) return prev;
        return [order, ...prev];
      });
      
      playOrderSound();
      
      // Background-friendly notification loop (30 seconds total)
      const notifications = [];
      for (let i = 0; i < 10; i++) {
        notifications.push({
          title: "طلب جديد! 🛍️",
          body: `طلب رقم #${order.id} بمبلغ ${order.total.toLocaleString()} د.ع`,
          id: (Number(order.id) % 1000000) + i,
          schedule: { at: new Date(Date.now() + (i * 3000) + 100) }, // Every 3 seconds
          sound: 'res://raw/order_received',
          actionTypeId: "VIEW_ORDER",
          extra: { orderId: order.id }
        });
      }
      
      try {
        await LocalNotifications.schedule({ notifications });
      } catch (err) {
        console.error('[ADMIN_APP] Failed to schedule notifications:', err);
      }
    };

    const onStatusUpdate = (data: { orderId: number, status: string }) => {
      setOrders(prev => prev.map(o => 
        o.id === data.orderId ? { ...o, status: data.status } : o
      ));
    };

    const onFeeUpdate = (data: { orderId: number, fee: number, total: number }) => {
      setOrders(prev => prev.map(o => 
        o.id === data.orderId ? { ...o, internationalShippingFee: data.fee, total: data.total } : o
      ));
    };

    socket.on('connect', onConnect);
    socket.on('new_order', onNewOrder);
    socket.on('order_status_updated', onStatusUpdate);
    socket.on('order_fee_updated', onFeeUpdate);

    return () => {
      stateListener.then(l => l.remove());
      clearInterval(pollingInterval);
      socket.off('connect', onConnect);
      socket.off('new_order', onNewOrder);
      socket.off('order_status_updated', onStatusUpdate);
      socket.off('order_fee_updated', onFeeUpdate);
    };
  }, [loadOrders, joinAdminRoomLocal]);

  const getStatusConfig = (status: string) => {
    switch (status.toUpperCase()) {
      case 'PENDING': return { label: 'قيد المراجعة', class: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
      case 'AWAITING_PAYMENT': return { label: 'بانتظار الدفع', class: 'bg-orange-100 text-orange-700 border-orange-200' };
      case 'PREPARING': return { label: 'قيد التجهيز', class: 'bg-blue-100 text-blue-700 border-blue-200' };
      case 'SHIPPED': return { label: 'تم الشحن', class: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
      case 'ARRIVED_IRAQ': return { label: 'وصل للعراق', class: 'bg-teal-100 text-teal-700 border-teal-200' };
      case 'DELIVERED': return { label: 'تم التسليم', class: 'bg-green-100 text-green-700 border-green-200' };
      case 'CANCELLED': return { label: 'ملغي', class: 'bg-red-100 text-red-700 border-red-200' };
      default: return { label: status, class: 'bg-gray-100 text-gray-700 border-gray-200' };
    }
  };

  const filteredOrders = orders.filter(o => 
    String(o.id).includes(searchTerm) || 
    o.user?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    o.user?.phone?.includes(searchTerm)
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 border border-slate-100">
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-blue-200">
              <ShoppingBag className="text-white w-10 h-10" />
            </div>
            <h1 className="text-3xl font-black text-slate-900">Admin Dashboard</h1>
            <p className="text-slate-500 mt-2">Manage your orders and store</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Email Address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-slate-900 font-medium" placeholder="admin@example.com" required />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-5 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-slate-900 font-medium" placeholder="••••••••" required />
            </div>
            
            <button type="button" onClick={() => setShowSettings(!showSettings)} className="text-xs font-bold text-blue-600 flex items-center gap-1.5 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors">
              <RefreshCw size={14} className={showSettings ? 'rotate-180' : ''} />
              {showSettings ? 'Hide Advanced Settings' : 'Advanced Server Settings'}
            </button>

            {showSettings && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="p-5 bg-blue-50 rounded-2xl border border-blue-100 space-y-3">
                <label className="block text-[10px] font-black text-blue-700 uppercase tracking-wider">API Server URL</label>
                <input type="text" value={apiUrl} onChange={(e) => handleUpdateApiUrl(e.target.value)} className="w-full px-4 py-3 text-sm rounded-xl border border-blue-200 focus:ring-4 focus:ring-blue-200 outline-none text-slate-800 font-bold" />
                <p className="text-[10px] text-blue-600 leading-relaxed font-medium">Use this to switch between production and local development servers.</p>
              </motion.div>
            )}

            {error && <div className="p-4 rounded-2xl bg-red-50 text-red-600 text-sm font-bold flex items-center gap-3 border border-red-100 animate-shake"><AlertCircle size={20} />{error}</div>}
            
            <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95">
              {loading ? <RefreshCw className="animate-spin" /> : <LogIn size={22} />}
              Sign Into Dashboard
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/80">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100">
              <ShoppingBag className="text-white w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">Admin Orders</h1>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Updates On</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadOrders} className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><RefreshCw size={22} className={loading ? 'animate-spin' : ''} /></button>
            <button onClick={handleLogout} className="p-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"><LogOut size={22} /></button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
              Order Queue
              <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-black shadow-md">
                {orders.length}
              </span>
            </h2>
          </div>
          
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Search by ID, Customer Name, or Phone..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all shadow-sm"
            />
          </div>
        </div>

        <div className="space-y-6">
          <AnimatePresence mode="popLayout">
            {filteredOrders.map((order) => (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-black text-slate-900"># {order.id}</span>
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black border ${getStatusConfig(order.status).class}`}>
                          {getStatusConfig(order.status).label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
                        <div className="flex items-center gap-1.5"><Clock size={14} />{new Date(order.createdAt).toLocaleDateString('ar-IQ')}</div>
                        <div className="flex items-center gap-1.5"><CreditCard size={14} />{order.paymentMethod === 'cash' ? 'Cash' : 'Online'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-black text-blue-600">{(order.total || 0).toLocaleString()} IQD</div>
                      <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">{order.items?.length || 0} Products Included</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 mb-6">
                    <div className="space-y-1">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Customer</div>
                      <div className="text-sm font-black text-slate-700">{order.user?.name || 'Guest User'}</div>
                      <div className="text-xs font-bold text-slate-500">{order.user?.phone}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Delivery Fee</div>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          defaultValue={order.internationalShippingFee || 0}
                          onBlur={(e) => handleUpdateFee(order.id, parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-black text-blue-600 outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={async () => {
                        setModalLoading(true);
                        setShowOrderModal(true);
                        try {
                          const details = await fetchAdminOrderDetails(order.id);
                          setSelectedOrder(details);
                        } catch (err) {
                          console.error(err);
                        } finally {
                          setModalLoading(false);
                        }
                      }}
                      className="flex-1 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white font-black py-3 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm"
                    >
                      <Eye size={18} /> View Details
                    </button>
                    <div className="relative flex-1">
                      <select 
                        value={order.status}
                        onChange={(e) => handleUpdateStatus(order.id, e.target.value)}
                        className={`w-full appearance-none font-black py-3 px-4 rounded-2xl transition-all text-sm border-none cursor-pointer outline-none ${getStatusConfig(order.status).class}`}
                      >
                        <option value="PENDING">PENDING</option>
                        <option value="AWAITING_PAYMENT">AWAITING PAYMENT</option>
                        <option value="PREPARING">PREPARING</option>
                        <option value="SHIPPED">SHIPPED</option>
                        <option value="ARRIVED_IRAQ">ARRIVED IRAQ</option>
                        <option value="DELIVERED">DELIVERED</option>
                        <option value="CANCELLED">CANCELLED</option>
                      </select>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-50" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredOrders.length === 0 && !loading && (
            <div className="text-center py-32 bg-white rounded-3xl border-2 border-dashed border-slate-100">
              <Package className="mx-auto text-slate-200 w-20 h-20 mb-6" />
              <h3 className="text-xl font-black text-slate-400">No Orders Found Matching Search</h3>
            </div>
          )}
        </div>
      </main>

      {/* Order Details Modal */}
      <AnimatePresence>
        {showOrderModal && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="bg-white w-full max-w-2xl h-[90vh] sm:h-auto sm:max-h-[85vh] rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-10">
                <div>
                  <h3 className="text-xl font-black text-slate-900">Order Details</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">ID: #{selectedOrder?.id || '...'}</p>
                </div>
                <button onClick={() => { setShowOrderModal(false); setSelectedOrder(null); }} className="p-3 bg-slate-50 text-slate-400 hover:text-red-500 rounded-2xl transition-all"><X size={24} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
                {modalLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <RefreshCw className="animate-spin text-blue-600 w-10 h-10" />
                    <p className="text-slate-500 font-black">Loading Details...</p>
                  </div>
                ) : selectedOrder && (
                  <>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                        <div className="flex items-center gap-3 mb-4 text-blue-600"><Users size={20} /><h4 className="font-black">Customer Information</h4></div>
                        <div className="space-y-4">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-100 shadow-sm"><Phone size={18} className="text-slate-400" /></div>
                            <div className="flex-1">
                              <div className="text-[10px] font-black text-slate-400 uppercase">Phone Number</div>
                              <div className="text-sm font-black text-slate-700">{selectedOrder.address?.phone}</div>
                            </div>
                            <button 
                              onClick={() => handleOpenWhatsApp(selectedOrder)}
                              className="p-2.5 bg-green-500 text-white rounded-xl shadow-lg shadow-green-200 hover:bg-green-600 active:scale-95 transition-all flex items-center gap-2"
                            >
                              <MessageCircle size={18} />
                              <span className="text-xs font-black">Quotation</span>
                            </button>
                            <button 
                              onClick={() => handleSendInvoice(selectedOrder)}
                              className="p-2.5 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
                            >
                              <FileText size={18} />
                              <span className="text-xs font-black">Invoice</span>
                            </button>
                          </div>
                          <div className="flex items-center gap-4"><div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-100 shadow-sm"><Mail size={18} className="text-slate-400" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase">Email Address</div><div className="text-sm font-black text-slate-700">{selectedOrder.user?.email || 'N/A'}</div></div></div>
                          <div className="flex items-center gap-4"><div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-100 shadow-sm"><MapPin size={18} className="text-slate-400" /></div><div><div className="text-[10px] font-black text-slate-400 uppercase">Shipping Address</div><div className="text-sm font-black text-slate-700 leading-relaxed">{selectedOrder.address?.city}, {selectedOrder.address?.street}, {selectedOrder.address?.buildingNo}</div></div></div>
                        </div>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                        <div className="flex items-center gap-3 mb-6 text-blue-600"><ShoppingCart size={20} /><h4 className="font-black">Order Items</h4></div>
                        <div className="space-y-4">
                          {selectedOrder.items?.map((item: any, idx: number) => (
                          <div key={idx} className="bg-white p-4 rounded-2xl flex items-center gap-4 border border-slate-100 hover:border-blue-200 transition-colors cursor-pointer" onClick={(e) => { 
                            // Only open edit modal if we didn't click an action icon
                            if (!(e.target as HTMLElement).closest('.item-action-btn')) {
                              setEditingItem(item); 
                              setNewPriceValue(item.price.toString()); 
                            }
                          }}>
                              <img src={item.product?.image || 'https://via.placeholder.com/100'} className="w-16 h-16 rounded-xl object-cover" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <h5 className="font-black text-slate-800 text-sm truncate">{item.product?.name}</h5>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {typeof item.notes === 'string' && item.notes.trim() && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setActiveItemNote({
                                            productName: item.product?.name || 'Product note',
                                            note: item.notes.trim()
                                          });
                                        }}
                                        className="item-action-btn p-1.5 bg-amber-100 text-amber-600 rounded-lg shadow-sm hover:bg-amber-200 transition-colors"
                                        title="View customer note"
                                      >
                                        <FileText size={14} />
                                      </button>
                                    )}
                                    {item.product?.purchaseUrl && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenXianyu(item.product.purchaseUrl!);
                                        }}
                                        className="item-action-btn p-1.5 bg-yellow-400 text-slate-900 rounded-lg shadow-sm hover:bg-yellow-500 transition-colors"
                                        title="Open in Xianyu"
                                      >
                                        <ExternalLink size={14} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="text-xs font-bold text-slate-400 mt-1 flex items-center gap-2">
                                  <span>{item.quantity} x {item.price.toLocaleString()} IQD</span>
                                  <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                  <span className="text-blue-600">{item.shippingMethod === 'air' ? '✈️ Air' : '🚢 Sea'}</span>
                                </div>
                                {item.selectedOptions && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {Object.entries(typeof item.selectedOptions === 'string' ? JSON.parse(item.selectedOptions) : item.selectedOptions).map(([k, v]: [any, any]) => (
                                      <span key={k} className="text-[8px] font-black bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-100 text-slate-500 uppercase">{k}: {v}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-blue-600 p-8 rounded-[2rem] text-white shadow-xl shadow-blue-100">
                        <div className="space-y-4">
                          <div className="flex justify-between items-center opacity-80 text-sm font-bold"><span>Subtotal</span><span>{(selectedOrder.total - (selectedOrder.internationalShippingFee || 0)).toLocaleString()} IQD</span></div>
                          <div className="flex justify-between items-center opacity-80 text-sm font-bold"><span>Delivery Fee</span><span>{(selectedOrder.internationalShippingFee || 0).toLocaleString()} IQD</span></div>
                          <div className="h-px bg-white/20 my-4"></div>
                          <div className="flex justify-between items-center">
                            <div><div className="text-xs font-bold opacity-70 uppercase tracking-widest">Grand Total</div><div className="text-3xl font-black">{selectedOrder.total.toLocaleString()} IQD</div></div>
                            <div className="bg-white/20 p-4 rounded-2xl"><CreditCard size={32} /></div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100">
                        <div className="flex items-center gap-3 mb-4 text-purple-600"><CreditCard size={20} /><h4 className="font-black">Payment Method</h4></div>
                        <div className="grid grid-cols-1 gap-3">
                          {[
                            { id: 'zain_cash', label: 'Zain Cash', icon: '📱' },
                            { id: 'super_key', label: 'Super Key', icon: '🔑' },
                            { id: 'cash', label: 'Cash on Delivery', icon: '💵' }
                          ].map((method) => (
                            <button
                              key={method.id}
                              onClick={() => handleUpdatePaymentMethod(selectedOrder.id, method.id)}
                              className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                                selectedOrder.paymentMethod === method.id
                                  ? 'border-purple-600 bg-purple-50 text-purple-700'
                                  : 'border-white bg-white text-slate-400 hover:border-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-xl">{method.icon}</span>
                                <span className="font-black text-sm">{method.label}</span>
                              </div>
                              {selectedOrder.paymentMethod === method.id && <CheckCircle2 size={18} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Price Edit Modal */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-900">تحديث السعر</h3>
                <button onClick={() => setEditingItem(null)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><X size={20} /></button>
              </div>
              <div className="p-8 space-y-6 text-right" dir="rtl">
                <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <img src={editingItem.product?.image} className="w-12 h-12 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-slate-800 truncate">{editingItem.product?.name}</p>
                    <p className="text-[10px] font-bold text-slate-400">السعر الحالي: {editingItem.price.toLocaleString()} د.ع</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">السعر العالمي الجديد (د.ع)</label>
                  <input 
                    type="number" 
                    value={newPriceValue}
                    onChange={(e) => setNewPriceValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleUpdatePrice();
                      }
                    }}
                    autoFocus
                    className="w-full bg-slate-50 border-2 border-slate-100 focus:border-blue-500 rounded-2xl py-4 px-6 text-xl font-black text-blue-600 outline-none transition-all text-center"
                    placeholder="أدخل السعر الجديد..."
                  />
                  <p className="text-[10px] text-orange-500 font-bold leading-relaxed">
                    ⚠️ سيؤدي هذا إلى تغيير السعر لجميع المستخدمين في التطبيق وإشعار هذا الزبون.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handleUpdatePrice}
                    disabled={isUpdatingPrice || isArchiving || !newPriceValue}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isUpdatingPrice ? <RefreshCw className="animate-spin" /> : <Save size={20} />}
                    تطبيق تحديث السعر
                  </button>

                  <button 
                    onClick={handleArchiveProduct}
                    disabled={isUpdatingPrice || isArchiving}
                    className="w-full bg-red-50 text-red-600 hover:bg-red-100 font-bold py-3 rounded-2xl transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isArchiving ? <RefreshCw className="animate-spin" /> : <Trash2 size={18} />}
                    حذف المنتج من التطبيق
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeItemNote && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                    <FileText size={18} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900">Customer Note</h3>
                    <p className="text-xs font-bold text-slate-400 truncate max-w-[220px]">{activeItemNote.productName}</p>
                  </div>
                </div>
                <button onClick={() => setActiveItemNote(null)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6">
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="whitespace-pre-wrap break-words text-sm font-bold leading-relaxed text-slate-700">
                    {activeItemNote.note}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Success Message */}
      <AnimatePresence>
        {successMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] bg-green-600 text-white px-6 py-3 rounded-2xl font-black shadow-2xl flex items-center gap-2"
          >
            <CheckCircle2 size={20} />
            {successMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Invoice Components for PDF Generation */}
      <div className="fixed -left-[2000px] top-0 opacity-0 pointer-events-none overflow-hidden">
        {selectedOrder && (
          <>
            <div ref={invoiceRef}>
              <Invoice order={selectedOrder} settings={settings} mode="invoice" />
            </div>
            <div ref={quotationRef}>
              <Invoice order={selectedOrder} settings={settings} mode="quotation" />
            </div>
          </>
        )}
      </div>

      {/* Loading Overlay for PDF Generation */}
      {isGeneratingPDF && (
        <div className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
            <RefreshCw className="animate-spin text-blue-600" size={48} />
            <p className="font-black text-slate-800">جاري تجهيز الملف...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
