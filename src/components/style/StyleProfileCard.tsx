"use client";

import { Trash2, MessageSquare, FileText } from "lucide-react";

interface StyleProfileCardProps {
  profile: {
    id: string;
    name: string;
    profile: Record<string, unknown> | null;
    method: string;
    createdAt: string;
    updatedAt: string;
  };
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function StyleProfileCard({
  profile,
  onOpen,
  onDelete,
}: StyleProfileCardProps) {
  const hasProfile = profile.profile !== null;
  const data = profile.profile as Record<string, string | number | boolean> | null;

  const date = new Date(profile.updatedAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="border border-[#d4c9b5]/60 rounded-sm bg-[#FAF7F0]/80 hover:border-[#C9A84C]/40 transition-all group">
      <button
        type="button"
        onClick={() => onOpen(profile.id)}
        className="w-full text-left p-4"
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-display text-sm font-semibold text-[#2D1F0E] line-clamp-1">
            {profile.name}
          </h3>
          <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#2D1F0E]/5 font-ui text-[10px] text-[#5C4A32]">
            {profile.method === "chat" ? (
              <MessageSquare className="h-2.5 w-2.5" />
            ) : (
              <FileText className="h-2.5 w-2.5" />
            )}
            {profile.method === "chat" ? "Chat" : "Sample"}
          </span>
        </div>

        {hasProfile && data ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {data.tone && (
              <span className="px-2 py-0.5 rounded-sm bg-[#C9A84C]/10 font-ui text-[10px] text-[#5C4A32]">
                {String(data.tone)}
              </span>
            )}
            {data.formality !== undefined && (
              <span className="px-2 py-0.5 rounded-sm bg-[#C9A84C]/10 font-ui text-[10px] text-[#5C4A32]">
                Formality: {String(data.formality)}/10
              </span>
            )}
            {data.sentenceLength && (
              <span className="px-2 py-0.5 rounded-sm bg-[#C9A84C]/10 font-ui text-[10px] text-[#5C4A32]">
                {String(data.sentenceLength)} sentences
              </span>
            )}
            {data.voicePreference && (
              <span className="px-2 py-0.5 rounded-sm bg-[#C9A84C]/10 font-ui text-[10px] text-[#5C4A32]">
                {String(data.voicePreference)} voice
              </span>
            )}
          </div>
        ) : (
          <p className="font-body text-xs text-[#8a7a65] mb-3">
            Not yet created
          </p>
        )}

        <p className="font-ui text-[10px] text-[#a89880]">{date}</p>
      </button>

      <div className="border-t border-[#d4c9b5]/40 px-4 py-2 flex justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(profile.id);
          }}
          className="flex items-center gap-1 font-ui text-[10px] text-[#a89880] hover:text-red-600 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  );
}
