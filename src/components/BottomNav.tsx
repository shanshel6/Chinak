import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCartStore } from '../store/useCartStore';
import { Home, ShoppingBag, ShoppingCart, Heart, User } from 'lucide-react';

interface BottomNavProps {
  className?: string;
}

const BottomNav: React.FC<BottomNavProps> = ({ className = '' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const cartItemsCount = useCartStore((state) => state.getTotalItems());
  const [isVisible, setIsVisible] = useState(true);
  const [prevPathname, setPrevPathname] = useState(location.pathname);

  if (location.pathname !== prevPathname) {
    setPrevPathname(location.pathname);
    setIsVisible(true);
  }

  const lastScrollY = useRef(0);
  const scrollThreshold = 20; // Increased threshold for "not right away" feel

  useEffect(() => {
    // Only apply hide/show on scroll for the Home page as requested
    if (location.pathname !== '/') {
      return;
    }

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Calculate the difference between current and last scroll position
      const diff = currentScrollY - lastScrollY.current;

      // Always show at the very top
      if (currentScrollY < 50) {
        setIsVisible(true);
        lastScrollY.current = currentScrollY;
        return;
      }

      // Don't do anything if we haven't scrolled past the threshold
      if (Math.abs(diff) < scrollThreshold) {
        return;
      }

      if (diff > 0) {
        // Scrolling down - hide
        setIsVisible(false);
      } else {
        // Scrolling up - show
        setIsVisible(true);
      }
      
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]);

  const navItems = [
    { id: 'home', label: 'الرئيسية', icon: Home, path: '/' },
    { id: 'orders', label: 'طلباتي', icon: ShoppingBag, path: '/orders' },
    { id: 'cart', label: 'السلة', icon: ShoppingCart, path: '/cart' },
    { id: 'favorites', label: 'المفضلة', icon: Heart, path: '/favorites' },
    { id: 'profile', label: 'حسابي', icon: User, path: '/profile' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <motion.nav 
      initial={{ y: 0 }}
      animate={{ y: isVisible ? 0 : 120 }}
      transition={{ 
        type: 'spring',
        stiffness: 300,
        damping: 30,
        mass: 0.8
      }}
      className={`fixed bottom-0 left-0 right-0 z-40 w-full border-t border-slate-200 bg-white/95 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 ${className}`}
    >
      <div className="mx-auto flex max-w-lg items-center justify-between">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const isDisabled = 'disabled' in item ? (item as any).disabled : false;
          const Icon = item.icon;
          
          if (item.id === 'cart') {
            return (
              <div key={item.id} className="relative -mt-8">
                <button 
                  onClick={() => !isDisabled && navigate(item.path)}
                  disabled={isDisabled}
                  className={`flex size-14 items-center justify-center rounded-full shadow-lg ring-4 ring-white dark:ring-slate-900 transition hover:scale-105 ${
                    active ? 'bg-primary text-white' : 'bg-primary text-white'
                  } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Icon size={26} strokeWidth={active ? 2.5 : 2} />
                </button>
                {cartItemsCount > 0 && (
                  <motion.span 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900"
                  >
                    {cartItemsCount > 99 ? '+99' : cartItemsCount}
                  </motion.span>
                )}
              </div>
            );
          }

          return (
            <button 
              key={item.id}
              onClick={() => !isDisabled && navigate(item.path)}
              disabled={isDisabled}
              className={`flex flex-col items-center gap-1 transition-colors ${
                active ? 'text-primary' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              } ${isDisabled ? 'opacity-30 cursor-not-allowed grayscale' : ''}`}
            >
              <Icon size={24} strokeWidth={active ? 2.5 : 2} />
              <span className={`text-[10px] font-medium ${active ? 'font-bold' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </motion.nav>
  );
};

export default BottomNav;
