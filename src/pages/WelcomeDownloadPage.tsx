import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { initializeClipService, isClipReady } from '../services/clipService';

interface Props {
  onComplete: () => void;
}

const DownloadOverlay: React.FC<Props> = ({ onComplete }) => {
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

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-500">
        {/* Loading Animation - SVG based for reliable circular spinning */}
        <div className="relative flex items-center justify-center w-52 h-52">
          {/* Outer ring - slow spin */}
          <svg className="absolute w-48 h-48 animate-spin" style={{ animationDuration: '3s' }} viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="42"
              fill="none"
              stroke="rgba(99,102,241,0.15)"
              strokeWidth="3"
            />
            <circle
              cx="50" cy="50" r="42"
              fill="none"
              stroke="url(#blueGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="66 198"
              strokeDashoffset="0"
            />
          </svg>
          
          {/* Middle ring - fast spin (opposite) */}
          <svg className="absolute w-40 h-40 animate-spin" style={{ animationDuration: '1.8s', animationDirection: 'reverse' }} viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="35"
              fill="none"
              stroke="rgba(129,140,248,0.15)"
              strokeWidth="3"
            />
            <circle
              cx="50" cy="50" r="35"
              fill="none"
              stroke="url(#indigoGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="55 165"
              strokeDashoffset="0"
            />
          </svg>
          
          {/* Inner ring - medium spin */}
          <svg className="absolute w-32 h-32 animate-spin" style={{ animationDuration: '2.4s' }} viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="27"
              fill="none"
              stroke="rgba(167,139,250,0.15)"
              strokeWidth="3"
            />
            <circle
              cx="50" cy="50" r="27"
              fill="none"
              stroke="url(#purpleGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="42 128"
              strokeDashoffset="0"
            />
          </svg>
          
          {/* Center icon */}
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500/15 to-indigo-600/15 flex items-center justify-center backdrop-blur-sm border border-white/5">
            {isDone ? (
              <CheckCircle className="w-14 h-14 text-green-400 animate-in fade-in zoom-in duration-300" />
            ) : error ? (
              <AlertCircle className="w-14 h-14 text-red-400" />
            ) : (
              <Loader2 className="w-12 h-12 text-blue-400 animate-spin" style={{ animationDuration: '1s' }} />
            )}
          </div>
        </div>
        
        {/* SVG definitions */}
        <svg className="absolute w-0 h-0">
          <defs>
            <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
            <linearGradient id="indigoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
            <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
        </svg>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white text-center leading-tight">
          {isDone ? 'تم التحميل بنجاح!' 
           : error ? 'فشل التحميل' 
           : 'جاري تحميل نموذج البحث'}
        </h2>

        {/* Description */}
        <p className="text-base text-white/50 text-center max-w-sm leading-relaxed">
          {isDone 
            ? 'نموذج البحث جاهز، يمكنك البدء الآن'
            : error 
              ? 'حدث خطأ أثناء تحميل نموذج البحث'
              : 'يرجى الانتظار، قد يستغرق التحميل دقيقة واحدة'}
        </p>

        {/* Loading dots animation */}
        {!isDone && !error && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
          </div>
        )}

        {/* Retry Button for Errors */}
        {error && (
          <button
            onClick={() => window.location.reload()}
            className="px-10 py-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-lg font-medium rounded-full hover:opacity-90 transition-opacity shadow-lg shadow-blue-600/30"
          >
            حاول مرة أخرى
          </button>
        )}
      </div>
    </div>
  );
};

export default DownloadOverlay;