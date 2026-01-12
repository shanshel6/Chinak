import React, { useState, useEffect, useRef } from 'react';
import { ImageOff } from 'lucide-react';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholder?: string;
  priority?: boolean;
  width?: number;
  height?: number;
  quality?: number;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  isThumbnail?: boolean;
}

const LazyImage: React.FC<LazyImageProps> = ({ 
  src, 
  alt, 
  className = '',
  priority = false,
  width = 400,
  height,
  quality = 80,
  objectFit = 'cover',
  isThumbnail = false
}) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const imgRef = useRef<HTMLDivElement>(null);

  // Optimize URLs and handle fallbacks using a global image proxy (weserv.nl)
  const optimizedSrc = React.useMemo(() => {
    // Aggressive optimization for thumbnails
    const finalWidth = isThumbnail ? Math.min(width, 250) : width;
    const finalQuality = isThumbnail ? Math.min(quality, 65) : quality;

    if (!src) return `https://images.weserv.nl/?url=https://images.unsplash.com/photo-1560393464-5c69a73c5770&w=${finalWidth}&q=${finalQuality}&output=webp&fit=${objectFit}`;
    
    try {
      const cleanUrl = src.replace(/^https?:\/\//, '');
      let proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=${finalWidth}&q=${finalQuality}&output=webp&fit=${objectFit}&il`;
      
      if (height) {
        proxyUrl += `&h=${height}`;
      }
      
      return proxyUrl;
    } catch (e) {
      console.warn('LazyImage: Failed to optimize URL', src, e);
      return src;
    }
  }, [src, width, height, quality, objectFit, isThumbnail]);

  useEffect(() => {
    if (priority || isInView) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' } // Load images 200px before they come into view
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [priority, isInView]);

  const handleImageError = () => {
    setError(true);
    // Try a reliable fallback if Unsplash fails
    if (src.includes('unsplash.com')) {
      // Use a more reliable placeholder service as fallback
      const fallbackUrl = `https://loremflickr.com/400/400/product?lock=${Math.floor(Math.random() * 1000)}`;
      console.warn(`LazyImage: Unsplash failed for ${src}, using fallback: ${fallbackUrl}`);
      // We don't set src directly here, but we could set a fallback state
    }
  };

  return (
    <div 
      ref={imgRef}
      className={`relative overflow-hidden ${className} bg-slate-100 dark:bg-slate-800`}
    >
      {!loaded && !error && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 animate-pulse" />
      )}
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800">
          <img 
            src={`https://loremflickr.com/400/400/product?lock=${alt.length}`}
            alt="fallback"
            className="w-full h-full object-cover opacity-50 grayscale"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageOff size={24} className="text-slate-400" />
          </div>
        </div>
      ) : (
        (isInView || priority) && (
          <img
            src={optimizedSrc}
            alt={alt}
            loading={priority ? 'eager' : 'lazy'}
            crossOrigin="anonymous"
            onLoad={() => setLoaded(true)}
            onError={handleImageError}
            className={`w-full h-full transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            style={{ objectFit }}
          />
        )
      )}
    </div>
  );
};

export default LazyImage;
