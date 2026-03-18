"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type CitationFormat = "ISNAD" | "APA" | "CHICAGO" | "MLA";

interface CitationOption {
 id: CitationFormat;
 name: string;
 description: string;
 example: string;
 bestFor: string;
}

const CITATION_OPTIONS: CitationOption[] = [
 {
  id: "ISNAD",
  name: "ISNAD",
  description: "Islamic scholarly citation system used in Turkish academia",
  example: 'İbn Haldûn, Mukaddime, thk. Dervîş el-Cüveydî, Beyrut 1996, s. 47.',
  bestFor: "Islamic studies, Ottoman history, Turkish academic works",
 },
 {
  id: "APA",
  name: "APA 7th",
  description: "American Psychological Association format",
  example: "Smith, J. (2023). Title of work. Publisher. https://doi.org/...",
  bestFor: "Social sciences, psychology, education",
 },
 {
  id: "CHICAGO",
  name: "Chicago",
  description: "Chicago Manual of Style — notes & bibliography system",
  example: "Smith, John. Title of Work. New York: Publisher, 2023.",
  bestFor: "Humanities, history, literature, arts",
 },
 {
  id: "MLA",
  name: "MLA 9th",
  description: "Modern Language Association format",
  example: 'Smith, John. "Article Title." Journal Name, vol. 5, no. 2, 2023, pp. 10–25.',
  bestFor: "Literature, language studies, humanities",
 },
];

interface CitationSelectorProps {
 selected: CitationFormat;
 onChange: (format: CitationFormat) => void;
}

export default function CitationSelector({
 selected,
 onChange,
}: CitationSelectorProps) {
 return (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
   {CITATION_OPTIONS.map((option) => {
    const isSelected = selected === option.id;
    return (
     <button
      key={option.id}
      type="button"
      onClick={() => onChange(option.id)}
      className={cn(
       "relative flex flex-col items-start text-left rounded-xl border-2 p-5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
       isSelected
        ? "border-primary bg-accent dark:border-primary"
        : "border-border hover:border-primary/30 bg-card"
      )}
      aria-pressed={isSelected}
     >
      {isSelected && (
       <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="h-3 w-3" />
       </span>
      )}
      <div className="flex items-center gap-2 mb-2">
       <span
        className={cn(
         "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tracking-wide",
         isSelected
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
        )}
       >
        {option.name}
       </span>
      </div>
      <p className="text-sm font-medium mb-1">{option.description}</p>
      <p className="text-xs text-muted-foreground mb-3">
       {option.bestFor}
      </p>
      <div className="w-full rounded-md bg-muted px-3 py-2">
       <p className="text-xs font-mono text-muted-foreground leading-relaxed">
        {option.example}
       </p>
      </div>
     </button>
    );
   })}
  </div>
 );
}
