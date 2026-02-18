import React from 'react';
import { motion } from 'framer-motion';

interface PageTransitionProps {
  children: React.ReactNode;
}

const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => {
        if (containerRef.current) {
          containerRef.current.style.transform = 'none';
        }
      }}
      className="w-full min-h-screen"
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
