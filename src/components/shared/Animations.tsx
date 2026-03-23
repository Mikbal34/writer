"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { type ReactNode } from "react";

interface AnimateProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Fade in + slide up */
export function FadeUp({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Fade in + slide from left */
export function FadeLeft({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Fade in + slide from right */
export function FadeRight({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Simple fade in */
export function FadeIn({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.5 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Fade in + larger slide up (for hero/cards) */
export function FadeUpLarge({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Scroll-triggered fade up (for landing page sections) */
export function ScrollFadeUp({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Scroll-triggered simple fade */
export function ScrollFadeIn({ children, className, delay = 0, ...props }: AnimateProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Animated progress bar fill */
export function AnimatedBar({
  percentage,
  delay = 0.5,
  className,
  style,
}: {
  percentage: number;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <motion.div
      initial={{ width: 0 }}
      animate={{ width: `${percentage}%` }}
      transition={{ delay, duration: 1, ease: "easeOut" }}
      className={className}
      style={style}
    />
  );
}

/** Staggered list item — capped at 8 items to avoid animation queue buildup */
export function StaggerItem({ children, className, index, baseDelay = 0.1, stagger = 0.08, ...props }: AnimateProps & { index: number; baseDelay?: number; stagger?: number }) {
  // Skip animation for items beyond index 8 — render instantly
  if (index > 8) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: baseDelay + index * stagger, duration: 0.3 }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
