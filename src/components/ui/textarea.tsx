import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, dir, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // Default dir="auto" so Arabic / Persian / Urdu content
      // renders RTL while Latin stays LTR — per-paragraph and
      // per-field. Pages can override when they need a fixed
      // direction (e.g. always-LTR code editors).
      dir={dir ?? "auto"}
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-sandy bg-elevated px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
