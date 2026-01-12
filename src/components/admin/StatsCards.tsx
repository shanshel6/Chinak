import React from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, BarChart3, CheckCircle2, Clock, Users } from 'lucide-react';

interface StatsCardsProps {
  stats: any;
}

const StatsCards: React.FC<StatsCardsProps> = ({ stats }) => {
  const { t } = useTranslation();

  const statItems = [
    { label: t('dashboard.overview.total_sales'), value: `${stats?.totalSales?.toLocaleString() || 0} ${t('common.iqd')}`, icon: CreditCard, color: 'bg-emerald-500' },
    { label: t('dashboard.overview.avg_order'), value: `${Math.round(stats?.averageOrderValue || 0).toLocaleString()} ${t('common.iqd')}`, icon: BarChart3, color: 'bg-blue-500' },
    { label: t('dashboard.overview.completed_orders'), value: stats?.deliveredOrders || 0, icon: CheckCircle2, color: 'bg-indigo-500' },
    { label: t('dashboard.overview.pending_orders'), value: stats?.pendingOrders || 0, icon: Clock, color: 'bg-amber-500' },
    { label: t('dashboard.overview.users_count'), value: stats?.totalUsers || 0, icon: Users, color: 'bg-slate-600' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      {statItems.map((stat, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700/50 group hover:border-primary/30 transition-all duration-300 text-right">
          <div className="flex items-center gap-4 flex-row-reverse">
            <div className={`${stat.color} w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-${stat.color.split('-')[1]}-500/20`}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className="text-xl font-black text-slate-900 dark:text-white">{stat.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatsCards;
