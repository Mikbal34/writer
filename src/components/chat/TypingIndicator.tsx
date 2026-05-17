"use client";

export default function TypingIndicator({
  label = "Kütüphane düşünüyor",
}: {
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 pl-1 text-ink-light text-xs">
      <div
        className="h-6 w-6 rounded-sm bg-gold flex items-center justify-center font-display italic text-white text-[13px] font-semibold leading-none shrink-0"
        aria-hidden
      >
        Q
      </div>
      <span>{label}</span>
      <span className="inline-flex gap-1">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </span>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="w-1 h-1 rounded-full bg-ink-muted animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
