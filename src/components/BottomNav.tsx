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

  const lastScrollY = useRef(0);
  const scrollTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Only apply hide/show on scroll for the Home page as requested
    if (location.pathname !== '/') {
      setIsVisible(true);
      return;
    }

    let ticking = false;

    const resolveScrollTarget = () => {
      const scrollingEl = document.scrollingElement as HTMLElement | null;
      if (scrollingEl && scrollingEl.scrollHeight > scrollingEl.clientHeight) return scrollingEl;
      const body = document.body;
      if (body && body.scrollHeight > body.clientHeight) return body;
      const root = document.getElementById('root') as HTMLElement | null;
      if (root && root.scrollHeight > root.clientHeight) return root;
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('main, [data-scroll-container], .scroll-container, .overflow-y-auto'));
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          return el;
        }
      }
      return scrollingEl || body || root || null;
    };

    scrollTargetRef.current = resolveScrollTarget();

    const getScrollY = (e?: Event) => {
      const target = e?.target as HTMLElement | null;
      if (target && typeof target.scrollTop === 'number') {
        const scrollTop = target.scrollTop;
        const scrollHeight = target.scrollHeight;
        const clientHeight = target.clientHeight;
        if (scrollHeight > clientHeight) return scrollTop;
      }
      const fixedTarget = scrollTargetRef.current;
      if (fixedTarget && typeof fixedTarget.scrollTop === 'number') return fixedTarget.scrollTop;
      const se = document.scrollingElement as null | { scrollTop?: unknown };
      if (se && typeof se.scrollTop === 'number') return se.scrollTop;
      return window.pageYOffset || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    };

    lastScrollY.current = getScrollY();

    const handleScroll = (e?: Event) => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = getScrollY(e);
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

    const scrollTarget = scrollTargetRef.current;
    if (scrollTarget) {
      scrollTarget.addEventListener('scroll', handleScroll, { passive: true });
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      if (scrollTarget) {
        scrollTarget.removeEventListener('scroll', handleScroll);
      } else {
        window.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('touchmove', handleScroll);
    };
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
      className={`fixed bottom-0 left-0 right-0 z-40 w-full border-t border-slate-100/50 bg-white/80 px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-900/80 transition-transform duration-300 ease-in-out shadow-[0_-5px_20px_rgba(0,0,0,0.03)] ${
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
              <div key={item.id} className="relative -mt-8">
                <button 
                  onClick={() => !isDisabled && navigate(item.path)}
                  disabled={isDisabled}
                  className={`flex size-14 items-center justify-center rounded-full shadow-lg ring-[5px] ring-white/80 dark:ring-slate-900/80 backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 ${
                    active ? 'bg-primary text-white shadow-primary/30' : 'bg-primary text-white shadow-primary/20'
                  } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Icon size={24} strokeWidth={active ? 2.5 : 2} />
                </button>
                {cartItemsCount > 0 && (
                  <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900 shadow-md animate-in zoom-in duration-300 z-50">
                    {cartItemsCount > 99 ? '99+' : cartItemsCount}
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
              className={`flex flex-col items-center gap-1 transition-all duration-300 active:scale-90 ${
                active ? 'text-primary scale-110' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
              } ${isDisabled ? 'opacity-30 cursor-not-allowed grayscale' : ''}`}
            >
              <Icon size={24} strokeWidth={active ? 2.5 : 2} className="transition-all" />
              <span className={`text-[10px] font-medium transition-all ${active ? 'font-bold' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
