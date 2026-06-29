/**
 * Lightweight, dependency-free confetti burst.
 *
 * Pure presentational overlay: pointer-events-none so it never blocks taps,
 * absolutely positioned inside the nearest relative parent. Renders a short
 * one-shot animation and then the pieces settle off-screen / transparent.
 */
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

const COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

interface ConfettiProps {
  /** Number of pieces. */
  count?: number;
  /** Base fall duration in seconds. */
  duration?: number;
}

const Confetti: React.FC<ConfettiProps> = ({ count = 42, duration = 2.4 }) => {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.3,
        color: COLORS[i % COLORS.length],
        rotate: Math.random() * 720 - 360,
        drift: Math.random() * 90 - 45,
        size: 6 + Math.random() * 6,
        dur: duration * (0.7 + Math.random() * 0.6),
      })),
    [count, duration]
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ y: '-12%', x: 0, opacity: 1, rotate: 0 }}
          animate={{ y: '130%', x: p.drift, opacity: [1, 1, 0], rotate: p.rotate }}
          transition={{ duration: p.dur, delay: p.delay, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            top: 0,
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.4,
            backgroundColor: p.color,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
};

export default Confetti;
