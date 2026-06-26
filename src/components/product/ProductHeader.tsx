import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Heart, Share2 } from 'lucide-react';

interface ProductHeaderProps {
  onBack: () => void;
  onShare: () => void;
  onToggleWishlist: () => void;
  isWishlisted: boolean;
}

const ProductHeader: React.FC<ProductHeaderProps> = ({
  onBack,
  onShare,
  onToggleWishlist,
  isWishlisted,
}) => {
  // Render via a portal to <body> so `position: fixed` is resolved against the
  // viewport — NOT against the page's <PageTransition> wrapper, whose transform
  // would otherwise become the containing block and make this header drift into
  // the middle of the page (with its hit-box offset from where it's painted)
  // while the entrance animation is still running.
  return createPortal(
    <header className="fixed top-0 left-0 right-0 z-[99999] flex items-center justify-between p-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      <button 
        onClick={onBack}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700"
      >
        <ArrowLeft size={20} className="transform rotate-180" />
      </button>
      <div className="flex items-center gap-3">
        <button 
          onClick={onToggleWishlist}
          className={`flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 ${isWishlisted ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}
        >
          <Heart size={20} fill={isWishlisted ? "currentColor" : "none"} strokeWidth={2.5} />
        </button>
        <button
          onClick={onShare}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <Share2 size={20} />
        </button>
      </div>
    </header>,
    document.body
  );
};

export default ProductHeader;