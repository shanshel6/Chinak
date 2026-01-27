import React from 'react';
import LazyImage from '../LazyImage';
import { calculateInclusivePrice } from '../../utils/shipping';
import type { ShippingRates } from '../../types/shipping';
import type { Product } from '../../types/product';

interface SimilarProductsProps {
  products: Product[];
  onProductClick: (id: number | string) => void;
  rates: ShippingRates;
}

const SimilarProducts: React.FC<SimilarProductsProps> = ({ products, onProductClick, rates }) => {
  if (products.length === 0) return null;

  return (
    <div className="mb-8 px-5">
      <h3 className="text-slate-900 dark:text-white text-lg font-black mb-4">منتجات مشابهة</h3>
      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-4">
        {products.map((p) => {
          const totalPrice = calculateInclusivePrice(
            p.price,
            p.weight,
            p.length,
            p.width,
            p.height,
            rates,
            undefined,
            p.domesticShippingFee || 0,
            p.basePriceRMB,
            p.isPriceCombined
          );

          return (
            <div 
              key={p.id}
              onClick={() => onProductClick(p.id)}
              className="w-40 shrink-0 bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm border border-slate-100 dark:border-white/5 cursor-pointer hover:scale-[1.02] transition-transform"
            >
              <div className="aspect-square relative overflow-hidden bg-slate-100 dark:bg-slate-700">
                <LazyImage 
                  src={p.image} 
                  alt={p.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-3">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 h-8 mb-2 leading-snug">
                  {p.name}
                </h4>
                <div className="text-primary font-black text-sm">
                  {totalPrice.toLocaleString()} د.ع
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SimilarProducts;
