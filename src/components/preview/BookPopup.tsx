"use client";

import { useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookPage {
  type: "chapter-cover" | "content" | "image";
  chapterTitle?: string;
  chapterNumber?: number;
  text?: string;
  imageUrl?: string;
  imageCaption?: string;
}

interface BookPopupProps {
  pages: BookPage[];
  open: boolean;
  onClose: () => void;
}

export default function BookPopup({ pages, open, onClose }: BookPopupProps) {
  const [currentSpread, setCurrentSpread] = useState(0);

  if (!open || pages.length === 0) return null;

  // Build spreads (2 pages per spread)
  const spreads: [BookPage | null, BookPage | null][] = [];
  for (let i = 0; i < pages.length; i += 2) {
    spreads.push([pages[i] ?? null, pages[i + 1] ?? null]);
  }

  const [leftPage, rightPage] = spreads[currentSpread] ?? [null, null];

  function renderPage(page: BookPage | null, side: "left" | "right") {
    if (!page) {
      return <div className="flex-1 bg-[#FAF7F0]" />;
    }

    if (page.type === "chapter-cover") {
      return (
        <div className="flex-1 bg-[#FAF7F0] flex flex-col items-center justify-center p-8">
          <div className="h-px w-16 bg-[#C9A84C]/50 mb-6" />
          <p className="font-ui text-sm text-[#C9A84C] tracking-widest uppercase mb-2">
            Chapter {page.chapterNumber}
          </p>
          <h2 className="font-display text-2xl md:text-3xl font-bold text-[#2D1F0E] text-center italic">
            {page.chapterTitle}
          </h2>
          <div className="h-px w-16 bg-[#C9A84C]/50 mt-6" />
        </div>
      );
    }

    if (page.type === "image") {
      return (
        <div className="flex-1 bg-[#FAF7F0] flex flex-col items-center justify-center p-4">
          <img
            src={page.imageUrl}
            alt={page.imageCaption ?? "Illustration"}
            className="max-h-[80%] max-w-full object-contain rounded-sm shadow-md"
          />
          {page.imageCaption && (
            <p className="font-body text-xs text-muted-foreground italic mt-3 text-center">
              {page.imageCaption}
            </p>
          )}
        </div>
      );
    }

    // Content page
    return (
      <div className="flex-1 bg-[#FAF7F0] p-6 md:p-10 overflow-y-auto">
        <div className="font-body text-sm leading-[1.8] text-[#2D1F0E] whitespace-pre-wrap">
          {page.text}
        </div>
        <p className="font-ui text-[10px] text-muted-foreground text-center mt-6 tracking-widest">
          -- {currentSpread * 2 + (side === "left" ? 1 : 2)} --
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#1A0F05]/90 flex items-center justify-center p-4">
      {/* Close button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 text-white/70 hover:text-white hover:bg-white/10"
      >
        <X className="h-6 w-6" />
      </Button>

      {/* Navigation */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCurrentSpread((p) => Math.max(0, p - 1))}
        disabled={currentSpread === 0}
        className="absolute left-4 text-white/70 hover:text-white hover:bg-white/10 z-10"
      >
        <ChevronLeft className="h-8 w-8" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => setCurrentSpread((p) => Math.min(spreads.length - 1, p + 1))}
        disabled={currentSpread >= spreads.length - 1}
        className="absolute right-4 text-white/70 hover:text-white hover:bg-white/10 z-10"
      >
        <ChevronRight className="h-8 w-8" />
      </Button>

      {/* Book spread */}
      <div className="w-full max-w-5xl aspect-[16/10] flex rounded-sm overflow-hidden shadow-2xl">
        {/* Left page */}
        <div className="flex-1 border-r border-[#d4c9b5]/30 flex">
          {renderPage(leftPage, "left")}
        </div>
        {/* Spine shadow */}
        <div className="w-1 bg-gradient-to-r from-[#d4c9b5]/40 to-[#d4c9b5]/10" />
        {/* Right page */}
        <div className="flex-1 flex">
          {renderPage(rightPage, "right")}
        </div>
      </div>

      {/* Page indicator */}
      <p className="absolute bottom-4 font-ui text-xs text-white/50">
        {currentSpread + 1} / {spreads.length}
      </p>
    </div>
  );
}
