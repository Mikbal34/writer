/*
 * DESIGN: "Open Codex" — Shared decorative elements
 * Ornaments, page numbers, section headers, etc.
 */

// Decorative SVG ornament divider
export function Ornament({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1="10" x2="75" y2="10" stroke="currentColor" strokeWidth="0.5" />
      <path d="M85 10 C88 5, 92 3, 95 5 C98 3, 102 5, 100 10 C102 15, 98 17, 95 15 C92 17, 88 15, 85 10Z" fillOpacity="0.6" />
      <circle cx="95" cy="10" r="1.5" />
      <path d="M80 10 C82 7, 84 6, 85 10 C84 14, 82 13, 80 10Z" fillOpacity="0.4" />
      <path d="M105 10 C108 7, 110 6, 110 10 C110 14, 108 13, 105 10Z" fillOpacity="0.4" transform="scale(-1,1) translate(-215,0)" />
      <line x1="115" y1="10" x2="200" y2="10" stroke="currentColor" strokeWidth="0.5" />
    </svg>
  );
}

// Page number component
export function PageNumber({ number }: { number: string }) {
  return (
    <div className="text-center py-3">
      <span className="font-display text-xs text-muted-foreground italic">— {number} —</span>
    </div>
  );
}

// Section title with § symbol
export function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`font-display text-lg font-semibold text-ink flex items-center gap-2 ${className}`}>
      <span className="text-gold-dark italic text-sm">§</span>
      {children}
    </h2>
  );
}

// Book page title (large)
export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-2xl md:text-3xl font-bold text-ink tracking-tight leading-tight">
        {title}
      </h1>
      {subtitle && (
        <p className="font-body text-sm text-muted-foreground mt-1.5">{subtitle}</p>
      )}
    </div>
  );
}

// Spine shadow divider (vertical between two pages)
export function SpineShadow() {
  return (
    <div className="hidden lg:block w-6 relative shrink-0">
      <div className="absolute inset-0 bg-gradient-to-r from-[#3C2415]/8 via-[#3C2415]/15 to-[#3C2415]/8" />
      <div className="absolute inset-y-0 left-1/2 w-[1px] bg-[#3C2415]/10" />
    </div>
  );
}
