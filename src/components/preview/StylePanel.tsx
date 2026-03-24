"use client";

import { Check } from "lucide-react";

const ART_STYLES = [
  { value: "watercolor", label: "Watercolor", desc: "Soft, flowing colors" },
  { value: "digital_art", label: "Digital Art", desc: "Clean, modern style" },
  { value: "pencil_sketch", label: "Pencil Sketch", desc: "Hand-drawn feel" },
  { value: "oil_painting", label: "Oil Painting", desc: "Rich, textured" },
  { value: "anime", label: "Anime / Manga", desc: "Japanese illustration" },
  { value: "children_book", label: "Children's Book", desc: "Warm, whimsical" },
  { value: "realistic", label: "Realistic", desc: "Photo-realistic" },
];

interface StylePanelProps {
  currentStyle: string | null;
  onStyleSelect: (style: string) => void;
}

export default function StylePanel({ currentStyle, onStyleSelect }: StylePanelProps) {
  return (
    <div className="p-3 space-y-3">
      <p className="font-ui text-xs text-muted-foreground">
        Select an art style. All future illustrations will use this style for consistency.
      </p>
      <div className="space-y-1.5">
        {ART_STYLES.map((style) => (
          <button
            key={style.value}
            onClick={() => onStyleSelect(style.value)}
            className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors border ${
              currentStyle === style.value
                ? "border-foreground/30 bg-muted shadow-sm"
                : "border-transparent hover:bg-muted/50"
            }`}
          >
            <div className="flex-1">
              <span className="font-ui text-xs font-medium block">{style.label}</span>
              <span className="font-body text-[10px] text-muted-foreground">{style.desc}</span>
            </div>
            {currentStyle === style.value && (
              <Check className="h-3.5 w-3.5 text-forest shrink-0" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
