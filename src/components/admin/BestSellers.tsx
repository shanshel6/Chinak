import React from 'react';
import { useTranslation } from 'react-i18next';

interface BestSellersProps {
  products: any[];
  onViewAll: () => void;
}

const BestSellers: React.FC<BestSellersProps> = ({ products, onViewAll }) => {
  const { t } = useTranslation();

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700/50 flex flex-col">
      <div className="flex items-center justify-between mb-6 flex-row-reverse">
        <h3 className="text-lg font-black text-slate-900 dark:text-white">{t('dashboard.overview.best_sellers')}</h3>
        <button onClick={onViewAll} className="text-xs font-bold text-primary hover:underline">{t('common.view_all')}</button>
      </div>
      <div className="space-y-4 flex-1">
        {products.slice(0, 6).map((product, i) => (
          <div key={i} className="flex items-center gap-3 p-2 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors flex-row-reverse">
            <div className="relative">
              <img 
                src={product.image} 
                alt="" 
                className="w-12 h-12 rounded-xl object-cover shadow-sm" 
              />
              <div className="absolute -top-1 -left-1 w-5 h-5 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center text-[10px] font-black text-slate-400 border border-slate-100 dark:border-slate-700 shadow-sm">
                {i + 1}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white truncate text-right">{product.name}</p>
              <div className="flex items-center gap-1 justify-end">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{product.price.toLocaleString()} {t('common.iqd')}</span>
              </div>
            </div>
            <div className="text-left">
              <div className="text-[10px] font-black text-primary bg-primary/10 px-2 py-1 rounded-lg">
                {Math.floor(Math.random() * 50) + 10} {t('dashboard.overview.orders_suffix')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BestSellers;
