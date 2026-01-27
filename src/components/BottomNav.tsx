import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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

  useEffect(() => {
    if (location.pathname !== prevPathname) {
      setPrevPathname(location.pathname);
      setIsVisible(true);
    }
  }, [location.pathname, prevPathname]);

  const lastScrollY = useRef(window.scrollY);

  useEffect(() => {
    // Only apply hide/show on scroll for the Home page as requested
    if (location.pathname !== '/') {
      setIsVisible(true);
      return;
    }

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          const diff = currentScrollY - lastScrollY.current;

          // Ignore bounces at the very top or bottom (iOS elastic scroll)
          if (currentScrollY < 0) {
            ticking = false;
            return;
          }
          
          // Always show at the top
          if (currentScrollY < 50) {
            setIsVisible(true);
          } else if (Math.abs(diff) > 15) { // Sync threshold with Home.tsx
            if (diff < 0) {
              // Scrolling up - show nav immediately
              setIsVisible(true);
            } else if (diff > 15 && currentScrollY > 200) { // More deliberate down scroll to hide
              // Scrolling down - hide nav
              setIsVisible(false);
            }
            // Only update lastScrollY when threshold is met to lock state
            lastScrollY.current = currentScrollY;
          }

          ticking = false;
        });
        ticking = true;
      }
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
    <nav 
      className={`fixed bottom-0 left-0 right-0 z-40 w-full border-t border-slate-100 bg-white/95 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 transition-transform duration-300 ease-in-out ${
        isVisible ? 'translate-y-0' : 'translate-y-full'
      } ${className}`}
    >
      <div className="mx-auto flex max-w-lg items-center justify-between">
        {navItems.map((item) => {
          const active = isActive(item.path);
          const isDisabled = 'disabled' in item ? (item as any).disabled : false;
          const Icon = item.icon;
          
          if (item.id === 'cart') {
            return (
              <div key={item.id} className="relative -mt-10">
                <button 
                  onClick={() => !isDisabled && navigate(item.path)}
                  disabled={isDisabled}
                  className={`flex size-16 items-center justify-center rounded-full shadow-xl ring-[6px] ring-white dark:ring-slate-900 transition hover:scale-105 ${
                    active ? 'bg-primary text-white' : 'bg-primary text-white'
                  } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Icon size={28} strokeWidth={active ? 2.5 : 2} />
                </button>
                {cartItemsCount > 0 && (
                  <span className="absolute top-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-slate-900 ring-4 ring-white dark:ring-slate-900 shadow-md animate-in zoom-in duration-300 z-50">
                    {cartItemsCount > 99 ? '+99' : cartItemsCount}
                  </span>
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
    </nav>
  );
};

export default BottomNav;
