import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Bell, X } from 'lucide-react';
import { useToastStore } from '../store/useToastStore';
import type { ToastType } from '../store/useToastStore';

const Toast: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  const renderIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return <CheckCircle2 size={20} />;
      case 'error': return <AlertCircle size={20} />;
      case 'warning': return <AlertTriangle size={20} />;
      case 'info': return <Info size={20} />;
      default: return <Bell size={20} />;
    }
  };

  const getColor = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'warning': return 'bg-amber-500';
      case 'info': return 'bg-blue-500';
      default: return 'bg-slate-800';
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[100] w-full max-w-xs px-4 pointer-events-none space-y-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 p-4 rounded-2xl text-white shadow-2xl animate-in slide-in-from-top-4 fade-in duration-300 ${getColor(toast.type)}`}
          dir="rtl"
        >
          <div className="shrink-0">{renderIcon(toast.type)}</div>
          <p className="text-sm font-bold flex-1 leading-tight">{toast.message}</p>
          <button 
            onClick={() => removeToast(toast.id)}
            className="shrink-0 size-6 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toast;
