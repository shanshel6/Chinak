import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartStore } from '../store/useCartStore';
import { useWishlistStore } from '../store/useWishlistStore';
import { useToastStore } from '../store/useToastStore';
import LazyImage from '../components/LazyImage';
import DiscountPopup from '../components/DiscountPopup';

import { useCheckoutStore } from '../store/useCheckoutStore';

import { AlertCircle, ShoppingCart, ArrowLeft, RefreshCw, Minus, Plus, Heart, Trash2, Tag, X, ArrowRight } from 'lucide-react';

import { fetchCoupons } from '../services/api';

const Cart: React.FC = () => {
  const navigate = useNavigate();
  const cartItems = useCartStore((state) => state.items);
  const loading = useCartStore((state) => state.isLoading);
  const error = useCartStore((state) => state.error);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const removeItems = useCartStore((state) => state.removeItems);
  const fetchCart = useCartStore((state) => state.fetchCart);
  const subtotal = useCartStore((state) => state.getSubtotal());
  const toggleWishlist = useWishlistStore((state) => state.toggleWishlist);
  const wishlistItems = useWishlistStore((state) => state.items);
  const showToast = useToastStore((state) => state.showToast);
  
  const { appliedCoupon, setAppliedCoupon } = useCheckoutStore();

  const [isDiscountPopupOpen, setIsDiscountPopupOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<(number | string)[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [hasAvailableCoupons, setHasAvailableCoupons] = useState(false);

  const isProductInWishlist = (productId: number | string) => wishlistItems.some(item => item.productId === productId);

  useEffect(() => {
    // Perform a silent fetch if we already have items to avoid full-screen spinner
    fetchCart(cartItems.length > 0);
    checkAvailableCoupons();
  }, [fetchCart]);

  useEffect(() => {
    if (appliedCoupon && appliedCoupon.minOrderAmount && subtotal < appliedCoupon.minOrderAmount) {
      setAppliedCoupon(null);
      showToast(`تم إزالة الكوبون لأن المجموع أقل من ${appliedCoupon.minOrderAmount.toLocaleString()} د.ع`, 'info');
    }
  }, [subtotal, appliedCoupon, setAppliedCoupon, showToast]);

  const checkAvailableCoupons = async () => {
    try {
      const coupons = await fetchCoupons();
      setHasAvailableCoupons(coupons.length > 0);
    } catch (err) {
      console.error('Failed to fetch coupons:', err);
    }
  };

  const toggleItemSelection = (itemId: number | string) => {
    setSelectedItems(prev => 
      prev.includes(itemId) 
        ? prev.filter(id => id !== itemId) 
        : [...prev, itemId]
    );
  };

  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedItems([]);
  };

  const handleBulkRemove = async () => {
    if (selectedItems.length === 0) return;
    
    try {
      await removeItems(selectedItems);
      showToast(`تم حذف ${selectedItems.length} منتجات من السلة`, 'info');
      setSelectedItems([]);
      setIsSelectMode(false);
    } catch (err: any) {
      showToast('فشل في حذف المنتجات المختارة', 'error');
    }
  };

  const handleUpdateQuantity = async (id: number | string, currentQty: number, delta: number) => {
    const newQty = currentQty + delta;
    if (newQty < 1) return;
    try {
      await updateQuantity(id, newQty);
    } catch (err: any) {
      showToast('فشل في تحديث الكمية', 'error');
    }
  };

  const handleRemove = async (id: number | string) => {
    try {
      await removeItem(id);
      showToast('تم حذف المنتج من السلة', 'info');
    } catch (err: any) {
      showToast('فشل في حذف المنتج', 'error');
    }
  };

  const handleSaveForLater = async (itemId: number | string, product: any) => {
    try {
      if (!isProductInWishlist(product.id)) {
        toggleWishlist(product.id, product);
      }
      await removeItem(itemId);
      showToast('تم نقل المنتج إلى المفضلة', 'success');
    } catch (err: any) {
      showToast('فشل في نقل المنتج للمفضلة', 'error');
    }
  };

  const discountAmount = appliedCoupon ? (
    appliedCoupon.discountType === 'PERCENTAGE' 
      ? Math.min(
          (subtotal * (appliedCoupon.discountValue / 100)), 
          appliedCoupon.maxDiscount || Infinity
        )
      : appliedCoupon.discountValue
  ) : 0;
  const total = subtotal - discountAmount;

  // Function to refresh cart
  const handleRefresh = async () => {
    try {
      await fetchCart();
      showToast('تم تحديث السلة', 'success');
    } catch (err) {
      showToast('فشل تحديث السلة', 'error');
    }
  };

  if (loading && cartItems.length === 0) {
    return (
      <div className="relative flex min-h-screen w-full flex-col items-center justify-center max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl font-display text-text-primary-light dark:text-text-primary-dark antialiased" dir="rtl">
        <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-700">
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce"></div>
            </div>
            <p className="text-sm font-bold text-slate-500 animate-pulse">جاري تحضير طلبك...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl items-center justify-center p-4 text-text-primary-light dark:text-text-primary-dark font-display antialiased" dir="rtl">
        <AlertCircle size={80} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold mb-2">عذراً، حدث خطأ</h2>
        <p className="text-slate-500 text-center mb-8">{error}</p>
        <button 
          onClick={() => fetchCart()}
          className="px-8 py-3 bg-primary text-white rounded-xl font-bold active:scale-95 transition-transform"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return (
      <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl items-center justify-center p-6 text-center" dir="rtl">
        <header className="absolute top-0 left-0 right-0 z-50 bg-transparent">
          <div className="flex items-center p-4 pt-safe-top">
            <button 
              onClick={() => navigate(-1)}
              className="size-11 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-95 transition-all border border-slate-100 dark:border-white/5"
            >
              <ArrowLeft size={24} className="rtl:rotate-180" />
            </button>
          </div>
        </header>
        <div className="size-24 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-6 animate-bounce">
          <ShoppingCart size={48} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">سلتك فارغة</h2>
        <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-[280px]">
          يبدو أنك لم تضف أي منتجات إلى سلتك بعد. ابدأ بالتسوق الآن واكتشف عروضنا المميزة!
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-8 py-3 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all"
        >
          ابدأ التسوق
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-x-hidden max-w-md mx-auto bg-background-light dark:bg-background-dark shadow-2xl font-display text-text-primary-light dark:text-text-primary-dark antialiased pb-32" dir="rtl">
      {/* Top App Bar */}
      <header className="sticky top-0 z-50 bg-background-light/90 dark:bg-background-dark/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between p-4 pt-safe-top">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => navigate(-1)}
              className="size-11 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-95 transition-all border border-slate-100 dark:border-white/5"
            >
              <ArrowLeft size={24} className="rtl:rotate-180" />
            </button>
            {isSelectMode && (
              <button 
                onClick={() => setSelectedItems(selectedItems.length === cartItems.length ? [] : cartItems.map(i => i.id))}
                className="text-xs font-bold text-primary bg-primary/10 px-3 py-2 rounded-xl active:scale-95 transition-all"
              >
                {selectedItems.length === cartItems.length ? 'إلغاء الكل' : 'تحديد الكل'}
              </button>
            )}
          </div>
          
          <div className="flex flex-col items-center">
            <h1 className="text-lg font-black text-slate-900 dark:text-white leading-none">سلة التسوق</h1>
            {isSelectMode && (
              <span className="text-[10px] font-bold text-primary mt-1">تم تحديد {selectedItems.length}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isSelectMode ? (
              <>
                <button 
                  onClick={handleBulkRemove}
                  disabled={selectedItems.length === 0}
                  className={`size-11 rounded-2xl shadow-sm flex items-center justify-center transition-all border ${
                    selectedItems.length > 0 
                      ? 'bg-red-500 text-white border-red-500 active:scale-95' 
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-white/5 opacity-50'
                  }`}
                >
                  <Trash2 size={20} />
                </button>
                <button 
                  onClick={toggleSelectMode}
                  className="size-11 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-95 transition-all border border-slate-100 dark:border-white/5"
                >
                  <X size={20} />
                </button>
              </>
            ) : (
              <>
                <button 
                  onClick={toggleSelectMode}
                  className="size-11 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-95 transition-all border border-slate-100 dark:border-white/5"
                  title="تحديد منتجات للحذف"
                >
                  <Trash2 size={20} className="text-slate-500" />
                </button>
                <button 
                  onClick={handleRefresh}
                  className="size-11 rounded-2xl bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-95 transition-all border border-slate-100 dark:border-white/5"
                >
                  <RefreshCw size={20} className={loading ? 'animate-spin text-primary' : ''} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 flex flex-col gap-6">
        {/* Cart Items List */}
        <div className="flex flex-col gap-4">
          {cartItems.map((item) => (
            <div 
              key={item.id} 
              className={`relative flex gap-4 p-3 rounded-2xl bg-white dark:bg-slate-800 shadow-sm ring-1 transition-all ${
                selectedItems.includes(item.id) 
                  ? 'ring-primary bg-primary/5' 
                  : 'ring-slate-900/5 dark:ring-white/10'
              }`}
              onClick={() => isSelectMode && toggleItemSelection(item.id)}
            >
              {isSelectMode && (
                <div className="absolute top-3 right-3 z-10">
                  <div className={`size-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    selectedItems.includes(item.id) 
                      ? 'bg-primary border-primary' 
                      : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500'
                  }`}>
                    {selectedItems.includes(item.id) && (
                      <div className="size-2 rounded-full bg-white"></div>
                    )}
                  </div>
                </div>
              )}
              <div 
                className="size-24 shrink-0 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700 cursor-pointer"
                onClick={(e) => {
                  if (isSelectMode) return;
                  e.stopPropagation();
                  navigate(`/product?id=${item.product.id}`, { state: { initialProduct: item.product } });
                }}
              >
                <LazyImage 
                  src={item.product.image} 
                  alt={item.product.name} 
                  className="w-full h-full" 
                />
              </div>
              <div className="flex flex-col justify-between grow">
                <div 
                  className="cursor-pointer"
                  onClick={(e) => {
                    if (isSelectMode) return;
                    e.stopPropagation();
                    navigate(`/product?id=${item.product.id}`, { state: { initialProduct: item.product } });
                  }}
                >
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 line-clamp-1">{item.product.name}</h3>
                  {item.variant && item.variant.combination && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(() => {
                        try {
                          const combination = typeof item.variant.combination === 'string' 
                            ? JSON.parse(item.variant.combination) 
                            : item.variant.combination;
                          
                          return Object.entries(combination || {}).map(([key, value]) => (
                            <span key={key} className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded">
                              {key}: {value as string}
                            </span>
                          ));
                        } catch (e) {
                          console.error('Error parsing variant combination:', e);
                          return null;
                        }
                      })()}
                    </div>
                  )}
                  <p className="text-primary font-bold mt-1">{(item.variant?.price || item.product.price).toLocaleString()} د.ع</p>
                </div>
                {!isSelectMode && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 rounded-lg px-2 py-1">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateQuantity(item.id, item.quantity, -1);
                        }}
                        className="text-slate-500 hover:text-primary transition-colors"
                      >
                        <Minus size={18} />
                      </button>
                      <span className="text-sm font-bold w-4 text-center">{item.quantity}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateQuantity(item.id, item.quantity, 1);
                        }}
                        className="text-slate-500 hover:text-primary transition-colors"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveForLater(item.id, item.product);
                        }}
                        className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center transition-colors"
                        title="حفظ لوقت لاحق"
                      >
                        <Heart size={20} className={isProductInWishlist(item.product.id) ? 'fill-red-500 text-red-500' : 'text-slate-400'} />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(item.id);
                        }}
                        className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center text-red-500 transition-colors"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-900/5 dark:ring-white/10 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">ملخص الطلب</h3>
            <button
              onClick={() => setIsDiscountPopupOpen(true)}
              className="relative text-xs font-bold text-primary flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-lg active:scale-95 transition-all"
            >
              <Tag size={16} />
              {appliedCoupon ? 'تغيير الكوبون' : 'إضافة كوبون'}
              {!appliedCoupon && hasAvailableCoupons && (
                <span className="absolute -top-1.5 -left-1.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
              )}
            </button>
          </div>
          
          <div className="flex flex-col gap-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">المجموع الفرعي</span>
              <span className="font-bold">{subtotal.toLocaleString()} د.ع</span>
            </div>

            {appliedCoupon && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800/30 animate-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center text-green-600 dark:text-green-400">
                    <Tag size={16} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-green-600/70 dark:text-green-400/70 font-bold uppercase">كوبون مفعّل</span>
                    <span className="text-xs font-black text-green-700 dark:text-green-300">{appliedCoupon.code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-green-600 dark:text-green-400">- {discountAmount.toLocaleString()} د.ع</span>
                  <button 
                    onClick={() => {
                      setAppliedCoupon(null);
                      showToast('تم إزالة الكوبون', 'info');
                    }}
                    className="size-7 rounded-lg bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-rose-500 hover:bg-rose-50 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">الشحن الدولي</span>
              <span className="font-medium text-orange-500">يحدد لاحقاً</span>
            </div>

            <div className="h-px bg-slate-100 dark:bg-slate-700 w-full my-1"></div>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-base font-bold">
                <span>الإجمالي الكلي</span>
                <span className="text-primary">{total.toLocaleString()} د.ع</span>
              </div>
              <p className="text-[10px] text-slate-400 text-right">
                * سيتم احتساب تكلفة الشحن الدولي ومشاركتها معك عبر واتساب
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Sticky Footer Checkout Button */}
      <div className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-md bg-white/95 dark:bg-slate-900/95 border-t border-slate-200 dark:border-slate-800 p-4 pb-safe-bottom backdrop-blur-md">
        <button 
          onClick={() => navigate('/checkout/shipping')}
          className="w-full h-16 rounded-2xl bg-primary hover:bg-primary/90 active:scale-[0.98] transition-all text-white font-bold text-base shadow-lg shadow-primary/25 flex items-center justify-between px-6"
        >
          <div className="flex flex-col items-start leading-tight">
            <span className="text-[10px] opacity-80 font-bold uppercase tracking-wider">إجمالي الدفع</span>
            <span className="text-xl font-black">{total.toLocaleString()} د.ع</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg">إتمام الشراء</span>
            <ArrowRight size={22} />
          </div>
        </button>
      </div>

      <DiscountPopup
        isOpen={isDiscountPopupOpen}
        onClose={() => setIsDiscountPopupOpen(false)}
        orderAmount={subtotal}
        onApply={setAppliedCoupon}
        appliedCoupon={appliedCoupon}
      />
    </div>
  );
};

export default Cart;
