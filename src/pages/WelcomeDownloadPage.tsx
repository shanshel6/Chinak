import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { initializeClipService, getTextModelProgress, isTextModelDownloading, isClipReady } from '../services/clipService';

interface Props {
  onComplete: () => void;
}

const DownloadOverlay: React.FC<Props> = ({ onComplete }) => {
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  // Initialize download on component mount
  useEffect(() => {
    const initDownload = async () => {
      if (isClipReady()) {
        setIsDone(true);
        setTimeout(() => onComplete(), 600);
        return;
      }

      try {
        console.log('[Download] Starting model download...');
        await initializeClipService();
        console.log('[Download] Model download completed');
        setIsDone(true);
        setTimeout(() => onComplete(), 600);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Download] Failed:', err);
        setError(`فشل في تحميل النموذج: ${errorMessage}`);
      }
    };

    initDownload();
  }, [onComplete]);

  // Track download progress
  useEffect(() => {
    const interval = setInterval(() => {
      setDownloadProgress(getTextModelProgress());
      if (!isTextModelDownloading() && getTextModelProgress() >= 100) {
        setIsDone(true);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Circular progress SVG dimensions
  const radius = 72;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (downloadProgress / 100) * circumference;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-300">
        {/* Circular Progress */}
        <div className="relative flex items-center justify-center">
          <svg width={radius * 2 + strokeWidth * 2} height={radius * 2 + strokeWidth * 2} className="transform -rotate-90">
            {/* Background circle */}
            <circle
              cx={radius + strokeWidth}
              cy={radius + strokeWidth}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={strokeWidth}
            />
            {/* Progress circle */}
            <circle
              cx={radius + strokeWidth}
              cy={radius + strokeWidth}
              r={radius}
              fill="none"
              stroke="url(#gradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={progressOffset}
              className="transition-all duration-300 ease-out"
            />
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
          </svg>
          
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isDone ? (
              <CheckCircle className="w-16 h-16 text-green-400" />
            ) : error ? (
              <AlertCircle className="w-16 h-16 text-red-400" />
            ) : (
              <>
                <span className="text-4xl font-bold text-white tabular-nums">
                  {downloadProgress}%
                </span>
                <span className="text-xs text-white/50 mt-1">جاري التحميل</span>
              </>
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white text-center">
          {isDone ? 'تم التحميل بنجاح!' 
           : error ? 'فشل التحميل' 
           : 'تحضير نموذج البحث'}
        </h2>

        <p className="text-sm text-white/60 text-center max-w-xs">
          {isDone 
            ? 'نموذج البحث جاهز للاستخدام'
            : error 
              ? 'حدث خطأ أثناء تحميل نموذج البحث'
              : 'يتم تحميل نموذج البحث النصي، هذا يحدث مرة واحدة فقط'}
        </p>

        {/* Retry Button for Errors */}
        {error && (
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-full hover:opacity-90 transition-opacity shadow-lg"
          >
            حاول مرة أخرى
          </button>
        )}
      </div>
    </div>
  );
};

export default DownloadOverlay;