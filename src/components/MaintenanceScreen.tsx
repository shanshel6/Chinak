import React from 'react';
import { WifiOff, RefreshCw, AlertCircle, Globe } from 'lucide-react';
import Logo from './Logo';
import { useMaintenanceStore } from '../store/useMaintenanceStore';

const MaintenanceScreen: React.FC = () => {
  const { lastError, lastUrl } = useMaintenanceStore();
  
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background-light dark:bg-background-dark p-6" dir="rtl">
      <div className="w-full max-w-7xl text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="flex justify-center">
          <Logo size="lg" />
        </div>
        
        <div className="flex justify-center">
          <div className="size-24 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center relative">
            <WifiOff className="text-orange-600 dark:text-orange-400" size={48} />
            <div className="absolute -top-1 -right-1 size-6 bg-red-500 rounded-full border-4 border-background-light dark:border-background-dark"></div>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">عذراً، الخادم غير متوفر حالياً</h2>
          <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
            نواجه حالياً مشكلة في الاتصال بالخادم. قد يكون تحت الصيانة أو هناك مشكلة في الشبكة.
          </p>
        </div>

        {/* Diagnostic Information for Developers */}
        {(lastError || lastUrl) && import.meta.env.DEV && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-2xl text-right space-y-2 border border-red-100 dark:border-red-900/30">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold text-sm">
              <AlertCircle size={16} />
              <span>معلومات التشخيص (للمطورين):</span>
            </div>
            {lastUrl && (
              <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 break-all">
                <Globe size={14} className="mt-0.5 flex-shrink-0" />
                <span>الرابط: {lastUrl}</span>
              </div>
            )}
            {lastError && (
              <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                <span>الخطأ: {lastError}</span>
              </div>
            )}
          </div>
        )}

        <div className="pt-4 space-y-4">
          <button
            onClick={handleRetry}
            className="w-full py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <RefreshCw size={20} />
            إعادة المحاولة
          </button>
          
          <p className="text-xs text-slate-400 dark:text-slate-500">
            إذا استمرت المشكلة، يرجى التأكد من اتصالك بالإنترنت.
          </p>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceScreen;
