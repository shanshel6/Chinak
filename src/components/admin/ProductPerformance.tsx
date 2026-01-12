import React from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

interface ProductPerformanceProps {
  products: any[];
}

const ProductPerformance: React.FC<ProductPerformanceProps> = ({ products }) => {
  const { t } = useTranslation();

  const data = products.slice(0, 8).map(p => ({
    name: p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name,
    orders: Math.floor(Math.random() * 50) + 10,
    revenue: p.price * (Math.floor(Math.random() * 10) + 1)
  }));

  return (
    <div className="lg:col-span-2 bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700/50 flex flex-col">
      <div className="flex items-center justify-between mb-6 flex-row-reverse">
        <div className="flex items-center gap-2 flex-row-reverse">
          <TrendingUp className="text-primary" size={24} />
          <h3 className="text-lg font-black text-slate-900 dark:text-white">{t('dashboard.overview.product_performance')}</h3>
        </div>
        <span className="text-[10px] font-bold text-slate-400">{t('dashboard.overview.by_orders')}</span>
      </div>
      <div className="h-[350px] w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
            <XAxis type="number" hide orientation="top" />
            <YAxis 
              dataKey="name" 
              type="category" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
              width={100}
              orientation="right"
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1e293b', 
                border: 'none', 
                borderRadius: '12px',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 'bold',
                textAlign: 'right'
              }}
            />
            <Area 
              type="monotone" 
              dataKey="orders" 
              stroke="#10b981" 
              fill="#10b981" 
              fillOpacity={0.2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ProductPerformance;
