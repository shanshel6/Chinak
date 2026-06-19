import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { initializeClipService, getTextModelProgress, isTextModelDownloading, isClipReady } from '../services/clipService';

const WelcomeDownloadPage: React.FC = () => {
  const navigate = useNavigate();
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize download on component mount
  useEffect(() => {
    const initDownload = async () => {
      try {
        console.log('[Welcome] Starting model download...');
        setIsDownloading(true);
        
        // Start the download process
        await initializeClipService();
        
        setIsInitialized(true);
        console.log('[Welcome] Model download initialized');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Welcome] Failed to initialize download:', err);
        setError(`فشل في تحميل النموذج: ${errorMessage}`);
        setIsDownloading(false);
      }
    };

    initDownload();
  }, []);

  // Track download progress
  useEffect(() => {
    const interval = setInterval(() => {
      const progress = getTextModelProgress();
      setDownloadProgress(progress);
      
      // Check if download is still active
      const downloading = isTextModelDownloading();
      setIsDownloading(downloading);
      
      // Check if model is ready
      if (isClipReady()) {
        console.log('[Welcome] Model ready, navigating to home...');
        clearInterval(interval);
        
        // Small delay to show 100% progress
        setTimeout(() => {
          navigate('/home');
        }, 1000);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [navigate]);

  // Calculate estimated time remaining (very rough estimate)
  const estimatedTimeRemaining = downloadProgress < 5 ? 'جاري التقدير...' : 
    downloadProgress >= 100 ? 'جاهز!' : 
    `${Math.round((100 - downloadProgress) / 5)} ثانية تقريبًا`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex flex-col items-center justify-center p-6 rtl">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
        {/* App Logo/Icon */}
        <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Download className="w-10 h-10 text-white" />
        </div>

        <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
          مرحبًا بك في تطبيقنا!
        </h1>
        
        <p className="text-gray-600 dark:text-gray-300 mb-8">
          نحن نحضر الملفات المهمة لتجربة البحث الممتازة. الرجاء الانتظار...
        </p>

        {/* Download Progress */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              جاري تحميل نموذج البحث النصي
            </span>
            <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
              {downloadProgress}%
            </span>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          
          {/* Status Message */}
          <div className="mt-4 flex items-center justify-center gap-2">
            {isDownloading ? (
              <>
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {downloadProgress < 5 ? 'جاري بدء التحميل...' : 
                   downloadProgress < 20 ? 'جاري تحميل الملفات...' :
                   downloadProgress < 80 ? 'جاري معالجة البيانات...' :
                   'جاري الانتهاء...'}
                </span>
              </>
            ) : downloadProgress >= 100 ? (
              <>
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                  التحميل مكتمل!
                </span>
              </>
            ) : error ? (
              <>
                <AlertCircle className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* Estimated Time */}
        <div className="mb-8 p-4 bg-blue-50 dark:bg-gray-700 rounded-lg">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
            الوقت المتبقي تقريبًا:
          </p>
          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
            {estimatedTimeRemaining}
          </p>
        </div>

        {/* Encouragement Message */}
        <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-800 rounded-lg border border-blue-100 dark:border-gray-600">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-bold text-blue-600 dark:text-blue-400">انتظر قليلاً!</span> 
            {' '}نحن نحضر لك أفضل تجربة بحث. هذا التحميل يحدث مرة واحدة فقط.
          </p>
        </div>

        {/* Retry Button for Errors */}
        {error && (
          <button
            onClick={() => window.location.reload()}
            className="mt-6 w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            حاول مرة أخرى
          </button>
        )}

        {/* Note */}
        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          حجم التحميل: ~64 ميجابايت (يتم التخزين مؤقتًا للمرة القادمة)
        </p>
      </div>
    </div>
  );
};

export default WelcomeDownloadPage;