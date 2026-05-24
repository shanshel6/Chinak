import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  ExternalLink,
  Save,
  Trash2
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
  archiveProductFromOrder
} from './services/api';
import { socket, joinAdminRoom } from './services/socket';
import { playOrderSound, stopOrderSound } from './services/sound';
import { LocalNotifications } from '@capacitor/local-notifications';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiUrl, setApiUrl] = useState(() => {
    const stored = localStorage.getItem('api_url');
    const productionUrl = 'https://chinak-production.up.railway.app';
    // If no URL stored, or it's not the production URL, default to production
    if (!stored || (stored.includes('railway.app') && stored !== productionUrl)) {
      localStorage.setItem('api_url', productionUrl);
      return productionUrl;
    }
    return stored;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingItem, setEditingItem] = useState<any>(null);
  const [newPriceValue, setNewPriceValue] = useState('');
  const [isUpdatingPrice, setIsUpdatingPrice] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

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
      const errorMsg = err.response?.data?.error || err.message || 'فشل تحديث السعر';
      alert(`فشل تحديث السعر: ${errorMsg}\n\nURL: ${apiUrl}`);
    } finally {
      setIsUpdatingPrice(false);
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
      const errorMsg = err.response?.data?.error || err.message || 'فشل حذف المنتج';
      alert(`فشل حذف المنتج: ${errorMsg}\n\nURL: ${apiUrl}`);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleUpdateApiUrl = (url: string) => {
    setApiUrl(url);
    updateApiUrl(url);
  };

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchOrders();
      setOrders(data.orders || data);
    } catch (err) {
      console.error('Failed to fetch orders:', err);
    } finally {
      setLoading(false);
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
      joinAdminRoom();
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
    socket.disconnect();
  };

  const handleOpenXianyu = (url: string) => {
    if (!url) return;
    
    // Attempt to convert to xianyu deep link if it's a taobao/xianyu web link
    // Standard format for xianyu/taobao is usually https://item.taobao.com/item.htm?id=xxx
    // Deep link format: fleamarket://item?id=xxx
    let finalUrl = url;
    try {
      const urlObj = new URL(url);
      const id = urlObj.searchParams.get('id');
      if (id && (url.includes('taobao.com') || url.includes('xianyu.com') || url.includes('idlefish.com'))) {
        finalUrl = `fleamarket://item?id=${id}`;
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

  const handleOpenWhatsApp = (order: any) => {
    if (!order || !order.address?.phone) {
      alert('رقم الهاتف غير متوفر');
      return;
    }

    const phone = order.address.phone.replace(/\D/g, '');
    const subtotal = order.total - (order.internationalShippingFee || 0);
    const fee = order.internationalShippingFee || 0;
    
    // Arabic formatted message
    const message = `مرحباً، بخصوص طلبك رقم #IQ-${order.id}

المجموع الكلي: ${order.total.toLocaleString()} د.ع
كلفة الشحن الدولي: ${fee.toLocaleString()} د.ع

مدة الشحن المتوقعة:
✈️ شحن جوي: 10 إلى 20 يوم
🚢 شحن بحري: شهرين

رابط الفاتورة والتتبع:
https://chinak-production.up.railway.app/shipping-tracking?id=${order.id}`;

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;
    
    window.open(whatsappUrl, '_blank');
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
      socket.connect();
    }

    LocalNotifications.requestPermissions();

    socket.on('new_order', async (order: Order) => {
      // Add new order to the top of the list immediately
      setOrders(prev => [order, ...prev]);
      playOrderSound();
      
      await LocalNotifications.schedule({
        notifications: [
          {
            title: "طلب جديد! 🛍️",
            body: `طلب رقم #${order.id} بمبلغ ${order.total.toLocaleString()} د.ع`,
            id: order.id,
            schedule: { at: new Date(Date.now() + 100) },
            sound: 'res://raw/order_received',
            actionTypeId: "",
            extra: null
          }
        ]
      });
    });

    socket.on('order_status_updated', (data: { orderId: number, status: string }) => {
      setOrders(prev => prev.map(o => 
        o.id === data.orderId ? { ...o, status: data.status } : o
      ));
      if (selectedOrder && selectedOrder.id === data.orderId) {
        setSelectedOrder((prev: any) => ({ ...prev, status: data.status }));
      }
    });

    socket.on('order_fee_updated', (data: { orderId: number, fee: number, total: number }) => {
      setOrders(prev => prev.map(o => 
        o.id === data.orderId ? { ...o, internationalShippingFee: data.fee, total: data.total } : o
      ));
      if (selectedOrder && selectedOrder.id === data.orderId) {
        setSelectedOrder((prev: any) => ({ ...prev, internationalShippingFee: data.fee, total: data.total }));
      }
    });

    socket.on('connect', () => {
      if (localStorage.getItem('auth_token')) {
        joinAdminRoom();
      }
    });

    return () => {
      socket.off('new_order');
      socket.off('order_status_updated');
      socket.off('order_fee_updated');
      socket.off('connect');
    };
  }, [loadOrders]);

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
                              <span className="text-xs font-black">WhatsApp</span>
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
                            // Only open edit modal if we didn't click the xianyu button
                            if (!(e.target as HTMLElement).closest('.xianyu-btn')) {
                              setEditingItem(item); 
                              setNewPriceValue(item.price.toString()); 
                            }
                          }}>
                              <img src={item.product?.image || 'https://via.placeholder.com/100'} className="w-16 h-16 rounded-xl object-cover" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <h5 className="font-black text-slate-800 text-sm truncate">{item.product?.name}</h5>
                                  {item.product?.purchaseUrl && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation(); // Stop event from reaching the parent div
                                        handleOpenXianyu(item.product.purchaseUrl!);
                                      }}
                                      className="xianyu-btn p-1.5 bg-yellow-400 text-slate-900 rounded-lg shadow-sm hover:bg-yellow-500 transition-colors shrink-0"
                                      title="Open in Xianyu"
                                    >
                                      <ExternalLink size={14} />
                                    </button>
                                  )}
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

      {/* Floating Stop Sound Button (Only visible when sound could be playing) */}
      <button 
        onClick={() => { stopOrderSound(); }} 
        className="fixed bottom-6 right-6 w-14 h-14 bg-red-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-red-700 active:scale-90 transition-all z-[200] border-4 border-white"
        title="Stop Notification Sound"
      >
        <X size={28} />
      </button>
    </div>
  );
};

export default App;
