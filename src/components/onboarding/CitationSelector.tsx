"use client";

import { cn } from "@/lib/utils";

export type CitationFormat = "ISNAD" | "APA" | "Chicago" | "MLA" | "Harvard" | "IEEE";

interface CitationSelectorProps {
  selected: CitationFormat;
  onChange: (format: CitationFormat) => void;
}

const FORMATS: { value: CitationFormat; label: string; description: string }[] = [
  {
    value: "ISNAD",
    label: "ISNAD",
    description: "Turkish academic standard for Islamic studies and theology",
  },
  {
    value: "APA",
    label: "APA 7th",
    description: "Author-date style, common in social sciences",
  },
  {
    value: "Chicago",
    label: "Chicago / Turabian",
    description: "Footnote-based, widely used in humanities",
  },
  {
    value: "MLA",
    label: "MLA 9th",
    description: "Parenthetical citations, common in literature and arts",
  },
  {
    value: "Harvard",
    label: "Harvard",
    description: "Author-date system used across many disciplines",
  },
  {
    value: "IEEE",
    label: "IEEE",
    description: "Numbered references, standard in engineering and CS",
  },
];

export default function CitationSelector({
  selected,
  onChange,
}: CitationSelectorProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FORMATS.map((fmt) => (
        <button
          key={fmt.value}
          type="button"
          onClick={() => onChange(fmt.value)}
          className={cn(
            "rounded-lg border-2 p-4 text-left transition-all",
            selected === fmt.value
              ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-border hover:border-muted-foreground/30"
          )}
        >
          <p className="text-sm font-semibold">{fmt.label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {fmt.description}
          </p>
        </button>
      ))}
    </div>
  );
}
