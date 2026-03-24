"use client";

import { Loader2, UserCircle } from "lucide-react";

interface Character {
  id: string;
  name: string;
  description: string | null;
  visualTraits: string | null;
  referenceData: string | null; // base64 data URL
}

interface CharacterPanelProps {
  characters: Character[];
  isLoading: boolean;
}

export default function CharacterPanel({ characters, isLoading }: CharacterPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="font-body text-sm">Loading characters...</span>
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <UserCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-body text-sm">No characters yet.</p>
        <p className="font-body text-xs mt-1 opacity-70">
          Ask the AI to create characters for your book.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {characters.map((char) => (
        <div key={char.id} className="border border-[#d4c9b5]/50 rounded-md p-3 bg-white/50">
          <div className="flex gap-3">
            {/* Portrait */}
            <div className="shrink-0 w-16 h-16 rounded-md overflow-hidden bg-muted/30 flex items-center justify-center">
              {char.referenceData ? (
                <img src={char.referenceData} alt={char.name} className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="h-8 w-8 text-muted-foreground/40" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h4 className="font-display text-sm font-bold truncate">{char.name}</h4>
              {char.description && (
                <p className="font-body text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {char.description}
                </p>
              )}
            </div>
          </div>

          {char.visualTraits && (
            <p className="font-ui text-[10px] text-muted-foreground/70 mt-2 italic line-clamp-2">
              Visual: {char.visualTraits}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
