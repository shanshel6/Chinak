import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { initializeClipService, getTextModelProgress, isTextModelDownloading, isClipReady } from '../services/clipService';

interface Props {
  onComplete: () => void;
}

const DownloadOverlay: React.FC<Props> = ({ onComplete }) => {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const realProgressRef = useRef(0);
  const animFrameRef = useRef<number>(0);

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

  // Smooth animation loop: interpolate displayProgress towards realProgress
  useEffect(() => {
    const poll = setInterval(() => {
      const real = getTextModelProgress();
      realProgressRef.current = real;
      if (!isTextModelDownloading() && real >= 100) {
        setIsDone(true);
      }
    }, 200);

    const animate = () => {
      setDisplayProgress(prev => {
        const target = realProgressRef.current;
        // Smooth interpolation: move faster at the start, slower near target
        const diff = target - prev;
        if (Math.abs(diff) < 0.3) return target;
        // Ease-in-out: move at ~15% of remaining distance per frame (60fps)
        return prev + diff * 0.12;
      });
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      clearInterval(poll);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Circular progress SVG dimensions
  const radius = 90;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (displayProgress / 100) * circumference;

  // Generate particles around the circle
  const particles = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 360 + displayProgress * 3.6; // Rotate with progress
    const rad = (angle * Math.PI) / 180;
    const particleRadius = radius + strokeWidth + 14;
    const x = Math.cos(rad) * particleRadius;
    const y = Math.sin(rad) * particleRadius;
    return { x, y, delay: i * 0.15 };
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
        {/* Circular Progress */}
        <div className="relative flex items-center justify-center">
          <svg 
            width={(radius + strokeWidth + 28) * 2} 
            height={(radius + strokeWidth + 28) * 2}
            className="transform -rotate-90"
          >
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              {/* Ring shimmer gradient */}
              <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.8">
                  <animate attributeName="stopOpacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite" />
                </stop>
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.8">
                  <animate attributeName="stopOpacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite" />
                </stop>
              </linearGradient>
            </defs>

            {/* Background circle */}
            <circle
              cx={radius + strokeWidth + 28}
              cy={radius + strokeWidth + 28}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={strokeWidth}
            />

            {/* Progress circle with glow */}
            {displayProgress > 1 && (
              <>
                {/* Outer glow ring */}
                <circle
                  cx={radius + strokeWidth + 28}
                  cy={radius + strokeWidth + 28}
                  r={radius}
                  fill="none"
                  stroke="rgba(99,102,241,0.3)"
                  strokeWidth={strokeWidth + 6}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={progressOffset}
                  className="transition-all duration-100 ease-linear"
                  filter="url(#glow)"
                  style={{ opacity: isDone ? 0 : 0.6 }}
                />
                {/* Main progress ring */}
                <circle
                  cx={radius + strokeWidth + 28}
                  cy={radius + strokeWidth + 28}
                  r={radius}
                  fill="none"
                  stroke={isDone ? "rgba(34,197,94,0.9)" : "url(#shimmer)"}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={progressOffset}
                  className="transition-all duration-150 ease-linear"
                  filter={isDone ? undefined : "url(#glow)"}
                />
              </>
            )}

            {/* Orbiting particles */}
            {!isDone && !error && displayProgress > 0 && (
              <>
                {particles.map((p, i) => (
                  <circle
                    key={i}
                    cx={radius + strokeWidth + 28 + p.x}
                    cy={radius + strokeWidth + 28 + p.y}
                    r={2.5}
                    fill={i % 3 === 0 ? "#60a5fa" : i % 3 === 1 ? "#818cf8" : "#a78bfa"}
                    opacity={0.7}
                  >
                    <animate
                      attributeName="opacity"
                      values="0.2;0.9;0.2"
                      dur={`${1.5 + p.delay}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ))}
              </>
            )}
          </svg>
          
          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isDone ? (
              <div className="animate-in fade-in zoom-in duration-300 flex flex-col items-center">
                <CheckCircle className="w-20 h-20 text-green-400" />
                <span className="text-lg font-bold text-green-300 mt-2">اكتمل!</span>
              </div>
            ) : error ? (
              <AlertCircle className="w-20 h-20 text-red-400" />
            ) : (
              <>
                <span className="text-6xl font-extrabold text-white tabular-nums tracking-tight">
                  {Math.round(displayProgress)}
                </span>
                <span className="text-sm font-medium text-white/50 mt-1">%</span>
              </>
            )}
          </div>
        </div>

        {/* Title - bigger */}
        <h2 className="text-2xl font-bold text-white text-center leading-tight">
          {isDone ? 'تم التحميل بنجاح!' 
           : error ? 'فشل التحميل' 
           : 'يتم تحميل نموذج البحث'}
        </h2>

        <p className="text-base text-white/50 text-center max-w-xs leading-relaxed">
          {isDone 
            ? 'نموذج البحث جاهز، يمكنك البدء الآن'
            : error 
              ? 'حدث خطأ أثناء تحميل نموذج البحث'
              : 'هذه العملية تتم مرة واحدة فقط'}
        </p>

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