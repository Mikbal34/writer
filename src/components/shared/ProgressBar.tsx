"use client";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "success" | "warning";
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: "[&>div]:bg-primary",
  success: "[&>div]:bg-emerald-500",
  warning: "[&>div]:bg-amber-500",
};

const sizeClasses: Record<string, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2.5",
};

export default function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = false,
  size = "md",
  variant = "default",
  className,
}: ProgressBarProps) {
  const percentage = Math.round((value / max) * 100);

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between">
          {label && (
            <span className="text-xs font-medium text-muted-foreground">
              {label}
            </span>
          )}
          {showPercentage && (
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {percentage}%
            </span>
          )}
        </div>
      )}
      <Progress
        value={percentage}
        className={cn(sizeClasses[size], variantClasses[variant])}
      />
    </div>
  );
}
