import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, RefreshCw, Camera } from 'lucide-react';
import { visionDownloadManager, useVisionDownloadState } from '../services/visionDownloadManager';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user taps "Search now" once vision is ready. */
  onReady?: () => void;
  /**
   * Optional callback when the user taps "Search by text instead".
   * Use this to close the prompt and direct the user to the text input.
   */
  onSearchByTextInstead?: () => void;
}

/**
 * Modal that appears when the user taps the camera icon. Shows a simple
 * loading indicator while the vision model downloads in the background.
 */
const VisionDownloadPrompt: React.FC<Props> = ({ open, onClose, onReady, onSearchByTextInstead }) => {
  const state = useVisionDownloadState();
  const [retrying, setRetrying] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // When the modal opens, kick off the download if it hasn't started
  useEffect(() => {
    if (!open) return;
    if (
      state.status === 'not_started' ||
      state.status === 'paused' ||
      state.status === 'error'
    ) {
      visionDownloadManager.startDownload();
    }
    if (state.status === 'ready' && onReady) {
      onReady();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Once it becomes ready, auto-close
  useEffect(() => {
    if (open && state.status === 'ready' && onReady) {
      const t = setTimeout(() => onReady(), 600);
      return () => clearTimeout(t);
    }
  }, [open, state.status, onReady]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 max-w-sm w-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] text-center relative overflow-hidden border border-white/10 animate-in zoom-in-95 duration-300">
        {/* Background Decorative Element */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-6 left-6 p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors z-20"
          aria-label="إغلاق"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="relative z-10">
          {/* Status Icon / Animation */}
          <div className="flex justify-center mb-8">
            {state.status === 'ready' ? (
              <div className="w-20 h-20 rounded-3xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center shadow-inner">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
            ) : state.status === 'error' ? (
              <div className="w-20 h-20 rounded-3xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center shadow-inner">
                <AlertCircle className="w-10 h-10 text-red-500" />
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="flex gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-3 h-3 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-3 h-3 rounded-full bg-primary animate-bounce"></div>
                </div>
                <div className="w-16 h-16 rounded-3xl bg-primary/5 flex items-center justify-center animate-pulse">
                  <Camera className="w-8 h-8 text-primary opacity-40" />
                </div>
              </div>
            )}
          </div>

          <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-3 tracking-tight">
            {state.status === 'ready'
              ? 'جاهز للبحث!'
              : state.status === 'error'
              ? 'حدث خطأ ما'
              : 'جاري التجهيز...'}
          </h3>

          <p className="text-base text-slate-500 dark:text-slate-400 leading-relaxed mb-8 px-2">
            {state.status === 'ready'
              ? 'تم تحميل تقنيات البحث بالصورة بنجاح. يمكنك الآن البدء.'
              : state.status === 'error'
              ? 'تعذر تحميل ملفات البحث. يرجى التحقق من اتصالك.'
              : 'يرجى الانتظار بضع دقائق بينما نقوم بتجهيز البحث بالصورة. يمكنك الاستمرار في استخدام التطبيق.'}
          </p>

          {/* Error Debug Info (only if error exists) */}
          {state.status === 'error' && state.error && (
            <div className="mb-6 text-right">
              <button 
                onClick={() => setShowDebug(!showDebug)}
                className="text-xs text-primary/60 hover:text-primary transition-colors flex items-center gap-1 mr-auto mb-2 font-medium"
              >
                {showDebug ? 'إخفاء التفاصيل' : 'إظهار تفاصيل الخطأ'}
              </button>
              {showDebug && (
                <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-900/20 text-[10px] font-mono text-red-600 dark:text-red-400 overflow-auto max-h-24 text-left leading-tight">
                  {state.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3 relative z-10">
          {state.status === 'error' && (
            <button
              onClick={async () => {
                setRetrying(true);
                await visionDownloadManager.reset();
                visionDownloadManager.startDownload();
                setRetrying(false);
              }}
              disabled={retrying}
              className="w-full flex items-center justify-center gap-2 py-4 bg-primary text-white rounded-[1.25rem] font-bold shadow-lg shadow-primary/25 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-5 h-5 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'جاري الإعادة…' : 'إعادة المحاولة'}
            </button>
          )}

          {state.status === 'paused' && (
            <button
              onClick={() => visionDownloadManager.startDownload()}
              className="w-full py-4 bg-primary text-white rounded-[1.25rem] font-bold shadow-lg shadow-primary/25 active:scale-[0.98] transition-all"
            >
              استئناف
            </button>
          )}

          {state.status !== 'ready' && onSearchByTextInstead && (
            <button
              onClick={() => {
                onSearchByTextInstead();
                onClose();
              }}
              className="w-full py-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 rounded-[1.25rem] font-bold transition-colors border border-slate-200/50 dark:border-slate-700/50"
            >
              البحث بالنص
            </button>
          )}

          {state.status === 'ready' && (
            <button
              onClick={onReady}
              className="w-full py-4 bg-green-500 text-white rounded-[1.25rem] font-bold shadow-lg shadow-green-500/25 active:scale-[0.98] transition-all"
            >
              ابدأ البحث
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VisionDownloadPrompt;