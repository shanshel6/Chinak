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
        {/* Loading Animation */}
        <div className="relative flex items-center justify-center">
          {/* Outer pulsing ring */}
          <div className="absolute w-48 h-48 rounded-full border-4 border-blue-500/20 animate-ping" />
          
          {/* Middle spinning ring */}
          <div className="absolute w-44 h-44 rounded-full border-4 border-transparent border-t-indigo-500 border-r-blue-500 animate-spin" />
          
          {/* Inner spinning ring (opposite direction) */}
          <div className="absolute w-36 h-36 rounded-full border-4 border-transparent border-b-indigo-400 border-l-blue-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          
          {/* Center icon */}
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-600/20 flex items-center justify-center backdrop-blur-sm">
            {isDone ? (
              <CheckCircle className="w-16 h-16 text-green-400 animate-in fade-in zoom-in duration-300" />
            ) : error ? (
              <AlertCircle className="w-16 h-16 text-red-400" />
            ) : (
              <Loader2 className="w-14 h-14 text-blue-400 animate-spin" />
            )}
          </div>
        </div>

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