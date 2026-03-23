"use client";

import { type ReactNode } from "react";

interface AnimateProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  delay?: number;
}

function getDelayStyle(delay: number): React.CSSProperties {
  return delay > 0 ? { animationDelay: `${delay}s` } : {};
}

/** Fade in + slide up */
export function FadeUp({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-up ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Fade in + slide from left */
export function FadeLeft({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-left ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Fade in + slide from right */
export function FadeRight({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-right ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Simple fade in */
export function FadeIn({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-in ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Fade in + larger slide up (for hero/cards) */
export function FadeUpLarge({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-up-large ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Scroll-triggered fade up */
export function ScrollFadeUp({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-up ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}

/** Scroll-triggered simple fade */
export function ScrollFadeIn({ children, className, delay = 0, style, ...rest }: AnimateProps) {
  return (
    <div className={`animate-fade-in ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
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
    <div
      className={`animate-bar-fill ${className ?? ""}`}
      style={{ ...style, "--bar-width": `${percentage}%`, animationDelay: `${delay}s` } as React.CSSProperties}
    />
  );
}

/** Staggered list item */
export function StaggerItem({
  children,
  className,
  index,
  baseDelay = 0.05,
  stagger = 0.03,
  style,
  ...rest
}: AnimateProps & { index: number; baseDelay?: number; stagger?: number }) {
  if (index > 12) {
    return <div className={className} style={style} {...rest}>{children}</div>;
  }
  const delay = baseDelay + index * stagger;
  return (
    <div className={`animate-fade-left ${className ?? ""}`} style={{ ...getDelayStyle(delay), ...style }} {...rest}>
      {children}
    </div>
  );
}
