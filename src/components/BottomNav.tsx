import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCartStore } from '../store/useCartStore';
import { Home, ShoppingBag, ShoppingCart, Heart, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface BottomNavProps {
  className?: string;
}

const BottomNav: React.FC<BottomNavProps> = ({ className = '' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const cartItemsCount = useCartStore((state) => state.getTotalItems());

  const navItems = [
    { id: 'home', label: 'الرئيسية', icon: Home, path: '/' },
    { id: 'orders', label: 'طلباتي', icon: ShoppingBag, path: '/orders' },
    { id: 'favorites', label: 'المفضلة', icon: Heart, path: '/favorites' },
    { id: 'profile', label: 'حسابي', icon: User, path: '/profile' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const leftItems = navItems.slice(0, 2);
  const rightItems = navItems.slice(2);

  return (
    <nav 
      className={`fixed bottom-3 left-0 right-0 z-50 px-4 transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1) translate-y-0 ${className}`}
    >
      <div className="mx-auto w-full max-w-md rounded-[20px] border border-slate-200/60 bg-white/75 px-2.5 pt-0.5 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] backdrop-blur-2xl shadow-[0_8px_22px_rgba(0,0,0,0.10)] dark:border-slate-800/60 dark:bg-slate-900/70 overflow-visible">
        <div className="grid grid-cols-5 items-end gap-0.5">
          {leftItems.map((item) => {
          const active = isActive(item.path);
          const isDisabled = 'disabled' in item ? (item as any).disabled : false;
          const Icon = item.icon;
          
          return (
            <button 
              key={item.id}
              onClick={() => !isDisabled && navigate(item.path)}
              disabled={isDisabled}
              className={`group relative flex w-full flex-col items-center justify-end gap-0.5 pb-0.5 transition-all duration-300 ${
                isDisabled ? 'opacity-30 cursor-not-allowed grayscale' : ''
              }`}
            >
              <div className="relative p-1">
                <motion.div
                  animate={{
                    y: active ? -2 : 0,
                    scale: active ? 1.1 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className={`relative z-10 ${active ? 'text-primary' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'}`}
                >
                  <Icon 
                    size={24} 
                    strokeWidth={active ? 2.5 : 2} 
                    fill={active ? "currentColor" : "none"}
                    className="transition-colors duration-300" 
                  />
                </motion.div>
                
                {active && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 -z-0 rounded-full bg-primary/10 dark:bg-primary/20"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
              </div>
              
              <span className={`text-[9px] font-medium transition-all duration-300 ${
                active ? 'text-primary font-bold translate-y-0 opacity-100' : 'text-slate-400 translate-y-1 opacity-0 h-0 overflow-hidden'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
          <div className="relative flex items-end justify-center h-full">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-50">
              <motion.button 
                onClick={() => navigate('/cart')}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.9 }}
                className={`flex size-16 items-center justify-center rounded-full shadow-xl ring-[6px] ring-white/90 dark:ring-slate-900/90 backdrop-blur-md border border-slate-200/70 dark:border-slate-700/60 ${
                  location.pathname === '/cart'
                    ? 'bg-primary text-white shadow-primary/40 dark:bg-primary dark:text-white' 
                    : 'bg-white text-slate-700 shadow-slate-200/60 dark:bg-slate-800 dark:text-white'
                }`}
              >
                <ShoppingCart size={28} strokeWidth={2.5} />
              </motion.button>
              <AnimatePresence>
                {cartItemsCount > 0 && (
                  <motion.span 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-0 -right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900 shadow-sm"
                  >
                    {cartItemsCount > 99 ? '99+' : cartItemsCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          {rightItems.map((item) => {
          const active = isActive(item.path);
          const isDisabled = 'disabled' in item ? (item as any).disabled : false;
          const Icon = item.icon;
          
          return (
            <button 
              key={item.id}
              onClick={() => !isDisabled && navigate(item.path)}
              disabled={isDisabled}
              className={`group relative flex w-full flex-col items-center justify-end gap-0.5 pb-0.5 transition-all duration-300 ${
                isDisabled ? 'opacity-30 cursor-not-allowed grayscale' : ''
              }`}
            >
              <div className="relative p-1">
                <motion.div
                  animate={{
                    y: active ? -2 : 0,
                    scale: active ? 1.1 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className={`relative z-10 ${active ? 'text-primary' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'}`}
                >
                  <Icon 
                    size={24} 
                    strokeWidth={active ? 2.5 : 2} 
                    fill={active ? "currentColor" : "none"}
                    className="transition-colors duration-300" 
                  />
                </motion.div>
                
                {active && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 -z-0 rounded-full bg-primary/10 dark:bg-primary/20"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  />
                )}
              </div>
              
              <span className={`text-[9px] font-medium transition-all duration-300 ${
                active ? 'text-primary font-bold translate-y-0 opacity-100' : 'text-slate-400 translate-y-1 opacity-0 h-0 overflow-hidden'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
