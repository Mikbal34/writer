"use client";

import type { StyleProfile } from "@/types/project";

interface StyleProfilePreviewProps {
  profile: Partial<StyleProfile> | null;
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-ui text-[10px] text-[#8a7a65] w-28 shrink-0">
        {label}
      </span>
      <span className="px-2 py-0.5 rounded-sm bg-[#C9A84C]/10 font-ui text-xs text-[#2D1F0E]">
        {value}
      </span>
    </div>
  );
}

function FormalityBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, (value / 10) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="font-ui text-[10px] text-[#8a7a65] w-28 shrink-0">
        Formality
      </span>
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-[#d4c9b5]/40 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#C9A84C]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-ui text-xs text-[#2D1F0E] w-8 text-right">
          {value}/10
        </span>
      </div>
    </div>
  );
}

export default function StyleProfilePreview({
  profile,
}: StyleProfilePreviewProps) {
  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
        <div className="w-16 h-16 rounded-full bg-[#f0ece4] flex items-center justify-center mb-5">
          <svg
            viewBox="0 0 24 24"
            className="w-8 h-8 text-[#c9bfad]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </div>
        <p className="font-body text-sm text-[#8a7a65] max-w-[240px] leading-relaxed">
          Start a conversation or paste a writing sample to build your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 py-6 space-y-4 overflow-y-auto h-full">
      <h3 className="font-display text-base font-semibold text-[#2D1F0E] mb-4">
        Style Profile
      </h3>

      <div className="space-y-2.5">
        {profile.tone && <Pill label="Tone" value={profile.tone} />}
        {profile.sentenceLength && (
          <Pill label="Sentence Length" value={profile.sentenceLength} />
        )}
        {profile.formality !== undefined && (
          <FormalityBar value={profile.formality} />
        )}
        {profile.voicePreference && (
          <Pill label="Voice" value={profile.voicePreference} />
        )}
        {profile.terminologyDensity && (
          <Pill label="Terminology" value={profile.terminologyDensity} />
        )}
        {profile.paragraphStructure && (
          <Pill label="Paragraph" value={profile.paragraphStructure} />
        )}
        {profile.paragraphLength && (
          <Pill label="Para. Length" value={profile.paragraphLength} />
        )}
        {profile.rhetoricalApproach && (
          <Pill label="Rhetoric" value={profile.rhetoricalApproach} />
        )}
        {profile.citationStyle && (
          <Pill label="Citation Style" value={profile.citationStyle} />
        )}
        {profile.usesFirstPerson !== undefined && (
          <Pill
            label="First Person"
            value={profile.usesFirstPerson ? "Yes" : "No"}
          />
        )}
        {profile.usesBlockQuotes !== undefined && (
          <Pill
            label="Block Quotes"
            value={profile.usesBlockQuotes ? "Yes" : "No"}
          />
        )}
      </div>

      {profile.transitionPatterns && profile.transitionPatterns.length > 0 && (
        <div className="pt-2">
          <span className="font-ui text-[10px] text-[#8a7a65] block mb-1.5">
            Transition Patterns
          </span>
          <div className="flex flex-wrap gap-1">
            {profile.transitionPatterns.map((t, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-sm bg-[#2D1F0E]/5 font-body text-[11px] text-[#5C4A32]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {profile.additionalNotes && (
        <div className="pt-2">
          <span className="font-ui text-[10px] text-[#8a7a65] block mb-1.5">
            Additional Notes
          </span>
          <p className="font-body text-xs text-[#2D1F0E] leading-relaxed">
            {profile.additionalNotes}
          </p>
        </div>
      )}
    </div>
  );
}
