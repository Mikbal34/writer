"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Feather,
  Loader2,
  ArrowLeft,
  Plus,
  Pencil,
  FileText,
  Eye,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WorkspaceShell from "@/components/shared/WorkspaceShell";
import StyleChat from "@/components/style/StyleChat";
import StyleAnalyzeView from "@/components/style/StyleAnalyzeView";
import StyleProfilePreview from "@/components/style/StyleProfilePreview";
import NewProfileDialog from "@/components/style/NewProfileDialog";
import WriteWithVoiceDialog from "@/components/style/WriteWithVoiceDialog";
import type { StyleProfile } from "@/types/project";

interface ProfileData {
  id: string;
  name: string;
  profile: Record<string, unknown> | null;
  method: string;
  createdAt: string;
  updatedAt: string;
}

// Voice colour palette — hash a profile's name to a stable colour so
// every card on the shelf reads as its own object instead of a wall of
// the same olive. Matches the v8 mock palette.
const VOICE_COLORS = [
  "#3a5238", // forest
  "#8a6a3d", // tobacco
  "#6a3a2a", // brick
  "#5a7050", // sage
  "#a08a5a", // sand
  "#5c1e2d", // burgundy
];
function voiceColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return VOICE_COLORS[Math.abs(h) % VOICE_COLORS.length];
}
// Slight tint for the cover gradient end.
function shadeHex(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.min(255, parseInt(h.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(h.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(h.slice(4, 6), 16) + amt));
  return `#${[r, g, b]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
}

// Profile JSON → numeric metrics for the radar + bars. We don't yet
// store per-axis scores, so these derive from the 5 qualitative fields
// the analyzer + chat both emit. Tolerant of missing keys.
interface FingerprintMetrics {
  formality: number;
  sentenceLength: number;
  analytical: number;
  metaphor: number;
  firstPerson: number;
  passive: number;
}
function fingerprintMetrics(
  profile: Record<string, unknown> | null,
): FingerprintMetrics {
  const p = (profile ?? {}) as Partial<StyleProfile>;
  const sentenceLength =
    p.sentenceLength === "short"
      ? 0.9
      : p.sentenceLength === "medium"
        ? 0.5
        : p.sentenceLength === "long"
          ? 0.2
          : 0.6;
  const analytical =
    p.rhetoricalApproach === "analytical"
      ? 0.92
      : p.rhetoricalApproach === "argumentative"
        ? 0.78
        : p.rhetoricalApproach === "comparative"
          ? 0.65
          : 0.45;
  const formality =
    p.paragraphStructure === "topic-sentence-first" || p.paragraphStructure === "deductive"
      ? 0.85
      : 0.55;
  const transitions = Array.isArray(p.transitionPatterns)
    ? (p.transitionPatterns as string[]).length
    : 0;

  // Prefer the quantitative scores baked in by the analyze pipeline.
  // Pre-extension profiles omit them — fall back to the older
  // heuristic so the radar never goes flat for legacy rows.
  const metaphor =
    typeof p.metaphorScore === "number"
      ? Math.max(0, Math.min(1, p.metaphorScore))
      : Math.max(0.15, Math.min(0.85, 0.3 + transitions * 0.04));
  const firstPerson =
    typeof p.firstPersonScore === "number"
      ? Math.max(0, Math.min(1, p.firstPersonScore))
      : p.rhetoricalApproach === "argumentative"
        ? 0.4
        : 0.2;
  const passive =
    typeof p.passiveScore === "number"
      ? Math.max(0, Math.min(1, p.passiveScore))
      : formality > 0.7
        ? 0.7
        : 0.35;
  return {
    formality,
    sentenceLength,
    analytical,
    metaphor,
    firstPerson,
    passive,
  };
}

function describeAxis(value: number): string {
  if (value >= 0.8) return "Yüksek";
  if (value >= 0.55) return "Belirgin";
  if (value >= 0.35) return "Orta";
  return "Düşük";
}

function describeSentenceLen(p: Partial<StyleProfile> | null): string {
  switch (p?.sentenceLength) {
    case "short":
      return "Kısa";
    case "long":
      return "Uzun";
    case "varied":
      return "Değişken";
    default:
      return "Orta";
  }
}

function profileTagline(profile: Record<string, unknown> | null): string {
  const p = (profile ?? {}) as Partial<StyleProfile>;
  if (p.additionalNotes && typeof p.additionalNotes === "string") {
    const trimmed = p.additionalNotes.trim();
    if (trimmed) return trimmed;
  }
  // Synthesise a short tagline from the structural fields.
  const len = describeSentenceLen(p).toLowerCase();
  const rhetoric =
    p.rhetoricalApproach === "analytical"
      ? "analitik"
      : p.rhetoricalApproach === "argumentative"
        ? "argümana dayalı"
        : p.rhetoricalApproach === "descriptive"
          ? "betimsel"
          : p.rhetoricalApproach === "comparative"
            ? "karşılaştırmalı"
            : "ölçülü";
  const structure =
    p.paragraphStructure === "topic-sentence-first"
      ? "konu-cümlesi öncelikli"
      : p.paragraphStructure === "inductive"
        ? "tümevarımcı"
        : p.paragraphStructure === "deductive"
          ? "tümdengelimli"
          : "akışkan";
  return `${len.charAt(0).toUpperCase()}${len.slice(1)} cümleler, ${structure}, ${rhetoric}.`;
}

function profileSample(profile: Record<string, unknown> | null): string {
  const p = (profile ?? {}) as Partial<StyleProfile>;
  // No stored sample text — show a synthesised demo line that reflects
  // the structural fields. Real "İkizi dene" output replaces this once
  // the trial endpoint ships.
  const intro =
    p.rhetoricalApproach === "argumentative"
      ? "Tartışmanın temeli"
      : p.rhetoricalApproach === "comparative"
        ? "İki gelenek karşılaştırıldığında"
        : "Konunun özü";
  return `${intro}, ${describeSentenceLen(p).toLowerCase()} cümlelerle ve ${
    p.paragraphStructure === "topic-sentence-first"
      ? "konu cümlesi önce gelecek"
      : "akışkan bir mantıkla"
  } biçimde açılır.`;
}

export default function StylePage() {
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<"list" | "chat" | "analyze">("list");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<Partial<StyleProfile> | null>(null);
  // List-view selection — drives the right-side detail panel.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    setMounted(true);
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/style-profiles");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setProfiles(data);
    } catch {
      toast.error("Failed to load style profiles");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  function handleOpenProfile(id: string) {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setActiveProfileId(id);
    setActiveProfile(p.profile as Partial<StyleProfile> | null);
    setView(p.method === "analyze" ? "analyze" : "chat");
  }

  async function handleDeleteProfile(id: string) {
    if (!confirm("Are you sure you want to delete this profile?")) return;
    try {
      const res = await fetch(`/api/style-profiles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Profile deleted");
      fetchProfiles();
    } catch {
      toast.error("Delete failed");
    }
  }

  function handleCreated(created: { id: string; method: string }) {
    fetchProfiles();
    setActiveProfileId(created.id);
    setActiveProfile(null);
    setView(created.method === "analyze" ? "analyze" : "chat");
  }

  function handleProfileUpdate(profile: Partial<StyleProfile>) {
    setActiveProfile(profile);
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === activeProfileId
          ? { ...p, profile: profile as Record<string, unknown> }
          : p
      )
    );
  }

  function handleBackToList() {
    setView("list");
    setActiveProfileId(null);
    setActiveProfile(null);
    fetchProfiles();
  }

  const activeProfileName =
    profiles.find((p) => p.id === activeProfileId)?.name ?? "Profile";

  // ─── List view (v8 redesign) ──────────────────────────────────
  if (view === "list") {
    return (
      <ListView
        profiles={profiles}
        isLoading={isLoading}
        selectedProfileId={selectedProfileId}
        onSelect={setSelectedProfileId}
        onOpen={handleOpenProfile}
        onCreated={handleCreated}
        onDelete={handleDeleteProfile}
      />
    );
  }

  // ─── Chat / Analyze view ──────────────────────────────────────
  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-page">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  const leftPanel =
    view === "chat" && activeProfileId ? (
      <StyleChat
        profileId={activeProfileId}
        onProfileUpdate={handleProfileUpdate}
      />
    ) : view === "analyze" && activeProfileId ? (
      <StyleAnalyzeView
        profileId={activeProfileId}
        currentProfile={activeProfile}
        onProfileUpdate={handleProfileUpdate}
      />
    ) : null;

  const rightPanel = <StyleProfilePreview profile={activeProfile} />;

  // Mobile layout
  if (isMobile) {
    return (
      <WorkspaceShell fullHeight>
        {/* Back bar */}
        <div className="max-w-6xl mx-auto w-full px-6 py-4">
          <button
            onClick={handleBackToList}
            className="inline-flex items-center gap-2 font-ui text-sm text-ink-light hover:text-ink transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-display font-semibold">{activeProfileName}</span>
          </button>
        </div>

        {/* Card container */}
        <div className="flex-1 max-w-6xl mx-auto w-full px-6 pb-6">
          <div className="bg-white rounded-lg shadow-sm border border-sandy-soft overflow-hidden flex flex-col" style={{ minHeight: "70vh" }}>
            <Tabs defaultValue={view === "analyze" ? "analyze" : "chat"} className="flex flex-col flex-1 min-h-0">
              <TabsList className="w-full shrink-0 rounded-none border-b border-sandy-soft bg-[#faf8f5]">
                <TabsTrigger
                  value={view === "analyze" ? "analyze" : "chat"}
                  className="flex-1 font-ui text-sm data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-gold"
                >
                  {view === "analyze" ? "Analyze" : "Chat"}
                </TabsTrigger>
                <TabsTrigger
                  value="profile"
                  className="flex-1 font-ui text-sm data-[state=active]:text-ink data-[state=active]:border-b-2 data-[state=active]:border-gold"
                >
                  Profile
                </TabsTrigger>
              </TabsList>
              <TabsContent value={view === "analyze" ? "analyze" : "chat"} className="flex-1 min-h-0 mt-0">
                {leftPanel}
              </TabsContent>
              <TabsContent value="profile" className="flex-1 min-h-0 overflow-y-auto mt-0">
                {rightPanel}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  // Desktop layout
  return (
    <WorkspaceShell fullHeight>
      {/* Back bar */}
      <div className="max-w-6xl mx-auto w-full px-6 py-4">
        <button
          onClick={handleBackToList}
          className="inline-flex items-center gap-2 font-ui text-sm text-ink-light hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="font-display font-semibold">{activeProfileName}</span>
        </button>
      </div>

      {/* Card container with split panel */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 pb-6">
        <div className="bg-white rounded-lg shadow-sm border border-sandy-soft overflow-hidden" style={{ height: "calc(100vh - 140px)" }}>
          <PanelGroup orientation="horizontal">
            <Panel id="main" minSize={30} defaultSize={55}>
              {leftPanel}
            </Panel>
            <PanelResizeHandle
              style={{ width: 1, flexShrink: 0 }}
              className="bg-sandy-soft hover:bg-gold/40 transition-colors cursor-col-resize"
            />
            <Panel id="preview" minSize={25} defaultSize={45}>
              {rightPanel}
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </WorkspaceShell>
  );
}

// ── v8 list view ─────────────────────────────────────────────────

function ListView({
  profiles,
  isLoading,
  selectedProfileId,
  onSelect,
  onOpen,
  onCreated,
  onDelete,
}: {
  profiles: ProfileData[];
  isLoading: boolean;
  selectedProfileId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  onCreated: (created: { id: string; method: string }) => void;
  onDelete: (id: string) => void;
}) {
  // Auto-select the first profile when the list loads.
  useEffect(() => {
    if (!isLoading && profiles.length > 0 && selectedProfileId === null) {
      onSelect(profiles[0].id);
    }
    if (
      selectedProfileId &&
      profiles.find((p) => p.id === selectedProfileId) === undefined
    ) {
      onSelect(profiles[0]?.id ?? null);
    }
  }, [isLoading, profiles, selectedProfileId, onSelect]);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  // Hero stats — real user-level rollups via /api/style-profiles/stats.
  // sampleCount approximates with user-role StyleChatMessage rows until
  // the StyleSample table ships; analysisWordCount is summed word count.
  const [statsData, setStatsData] = useState<{
    sampleCount: number;
    analysisWordCount: number;
  } | null>(null);
  useEffect(() => {
    fetch("/api/style-profiles/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setStatsData({
          sampleCount: data.sampleCount ?? 0,
          analysisWordCount: data.analysisWordCount ?? 0,
        });
      })
      .catch(() => undefined);
  }, [profiles.length]);

  const totalSamples = statsData?.sampleCount ?? 0;
  const totalWords =
    statsData === null
      ? "—"
      : statsData.analysisWordCount >= 1000
        ? `${(statsData.analysisWordCount / 1000).toFixed(1)}k`
        : String(statsData.analysisWordCount);

  // "Bu sesle yaz" dialog state — set to the profile to bind.
  const [writeWith, setWriteWith] = useState<{
    id: string;
    name: string;
  } | null>(null);

  return (
    <WorkspaceShell fullHeight bareMain>
      <div className="flex flex-1 min-h-0 gap-3.5 bg-page">
        <main className="flex-1 min-w-0 flex flex-col rounded-2xl bg-elevated overflow-hidden">
          {/* === Dark forest hero === */}
          <section
            className="relative overflow-hidden px-11 pt-8 pb-7 text-gold-soft"
            style={{
              background:
                "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
            }}
          >
            {/* Feather ornament */}
            <Feather
              aria-hidden
              className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 select-none"
              style={{
                width: 160,
                height: 160,
                color: "var(--color-gold-soft)",
                opacity: 0.12,
                strokeWidth: 0.8,
              }}
            />

            <div className="font-ui inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gold-soft/65 mb-1.5">
              <Feather className="h-3 w-3" />
              Sesinin ikizi
            </div>
            <h1 className="font-display italic font-medium text-[42px] leading-none tracking-tight text-white">
              Writing Twin
            </h1>
            <p className="mt-2.5 font-body text-sm leading-relaxed text-gold-soft/85 max-w-[580px]">
              Kendi ses ve üslubunu farklı modlara ayır. Akademik makalende
              ciddi, blog yazında oyuncu — Quilpen hangi sesi istediğini bilsin.
            </p>

            {/* Stats inline */}
            <div className="mt-6 flex items-end gap-9 flex-wrap">
              <HeroStatTwin num={String(profiles.length)} label="profil" />
              <HeroDividerTwin />
              <HeroStatTwin num={String(totalSamples)} label="örnek metin" />
              <HeroDividerTwin />
              <HeroStatTwin num={totalWords} label="kelime analizi" />
              <span className="flex-1" />
              <div className="self-end">
                <NewProfileDialog onCreated={onCreated} />
              </div>
            </div>
          </section>

          {/* === Body: profiles + detail === */}
          <div className="flex flex-1 min-h-0">
            {/* Profile list */}
            <div className="flex-[1.05] min-w-0 flex flex-col border-r border-sandy/60 px-8 py-6">
              <div className="flex items-baseline gap-2.5 mb-4">
                <h3 className="font-display italic font-medium text-[20px] leading-none text-forest-deep">
                  Ses profillerim
                </h3>
                <span className="font-ui text-xs text-ink-muted">
                  {profiles.length} profil
                </span>
              </div>

              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
                {isLoading ? (
                  <div className="flex items-center gap-2 py-10 justify-center text-ink-light">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="font-body text-sm">Yükleniyor…</span>
                  </div>
                ) : profiles.length === 0 ? (
                  <EmptyVoice onCreated={onCreated} />
                ) : (
                  profiles.map((p) => (
                    <ProfileCard
                      key={p.id}
                      p={p}
                      active={p.id === selectedProfileId}
                      onClick={() => onSelect(p.id)}
                    />
                  ))
                )}

                {profiles.length > 0 && (
                  <>
                    {/* Empty-slot dashed button */}
                    <button
                      type="button"
                      onClick={() => {
                        // NewProfileDialog uses its own internal trigger;
                        // this dashed CTA mirrors the mock visually so the
                        // user has a card-grid affordance too. Click forwards
                        // to the hero's dialog button via a synthetic click.
                        const heroBtn = document.querySelector<HTMLButtonElement>(
                          "[data-new-profile-trigger]",
                        );
                        heroBtn?.click();
                      }}
                      className="rounded-xl border-2 border-dashed border-sandy bg-transparent px-4 py-5 font-display italic text-[14px] text-ink-light hover:border-gold hover:text-ink transition-colors inline-flex items-center justify-center gap-2.5"
                    >
                      <Plus className="h-4 w-4 text-ink-muted" />
                      Yeni bir ses profili oluştur
                    </button>

                    {/* Tip card */}
                    <div className="mt-2 rounded-xl border border-sandy/60 bg-panel px-4 py-3.5 flex gap-3 font-body text-[12.5px] text-ink-light leading-relaxed">
                      <Sparkles className="h-4 w-4 text-gold shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-ink">İpucu: </span>
                        En az 3 örnek metin yükle. Quilpen cümle uzunluğunu,
                        kelime tercihlerini, ritmi ve yapıyı çıkarır. Ne kadar
                        çok örnek, o kadar sadık ikiz.
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right detail panel */}
            <aside className="hidden lg:flex w-[420px] shrink-0 flex-col bg-panel px-6 py-5 overflow-y-auto">
              {selected ? (
                <ProfileDetail
                  selected={selected}
                  rank={
                    profiles.findIndex((p) => p.id === selected.id) + 1
                  }
                  onEdit={() => onOpen(selected.id)}
                  onDelete={() => onDelete(selected.id)}
                  onWriteWith={() =>
                    setWriteWith({ id: selected.id, name: selected.name })
                  }
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-center font-display italic text-sm text-ink-muted px-4">
                  Bir ses profili seç — parmak izi burada açılır.
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>

      <WriteWithVoiceDialog
        open={writeWith !== null}
        onOpenChange={(open) => {
          if (!open) setWriteWith(null);
        }}
        profileId={writeWith?.id ?? ""}
        profileName={writeWith?.name ?? ""}
      />
    </WorkspaceShell>
  );
}

// ── v8 helper components ────────────────────────────────────────

function HeroStatTwin({ num, label }: { num: string; label: string }) {
  return (
    <div>
      <div className="font-display font-medium text-[36px] leading-none tracking-tight text-white">
        {num}
      </div>
      <div className="mt-1 font-ui text-[11px] uppercase tracking-[0.1em] text-gold-soft/70">
        {label}
      </div>
    </div>
  );
}

function HeroDividerTwin() {
  return (
    <span
      aria-hidden
      className="w-px h-9 self-center"
      style={{ background: "rgba(232,212,154,0.25)" }}
    />
  );
}

function ProfileCard({
  p,
  active,
  onClick,
}: {
  p: ProfileData;
  active: boolean;
  onClick: () => void;
}) {
  const color = voiceColor(p.name);
  const fp = useMemo(() => fingerprintMetrics(p.profile), [p.profile]);
  const tagline = useMemo(() => profileTagline(p.profile), [p.profile]);
  const sample = useMemo(() => profileSample(p.profile), [p.profile]);

  // Three mini bars use the most distinguishing axes per profile.
  const miniBars = [
    { label: "KISA", v: fp.sentenceLength },
    { label: "RESMÎ", v: fp.formality },
    { label: "ANALİTİK", v: fp.analytical },
  ];

  return (
    <article
      onClick={onClick}
      className={cn(
        "relative flex gap-4 cursor-pointer rounded-xl p-4 transition-all",
        active
          ? "bg-elevated border border-gold shadow-md shadow-gold/15"
          : "bg-panel border border-sandy/60 hover:border-sandy",
      )}
    >
      {/* Voice glyph (book-cover sized) */}
      <div
        className="relative flex flex-col justify-between shrink-0 rounded-[3px_6px_6px_3px] px-2.5 py-3"
        style={{
          width: 80,
          height: 100,
          background: `linear-gradient(135deg, ${color}, ${shadeHex(color, -25)})`,
          boxShadow:
            "inset -3px 0 0 rgba(0,0,0,0.2), inset 3px 0 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.15)",
        }}
      >
        <div className="h-px" style={{ background: "rgba(255,255,255,0.3)" }} />
        <VoiceWave />
        <div className="font-display italic font-semibold text-[11px] text-white text-center leading-tight line-clamp-1">
          {p.name}
        </div>
        <div className="h-px" style={{ background: "rgba(255,255,255,0.3)" }} />
      </div>

      {/* Right side */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-display italic font-semibold text-[20px] text-ink line-clamp-1">
            {p.name}
          </h3>
          {active && (
            <span className="font-ui inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] font-semibold text-gold">
              <span className="w-1.5 h-1.5 rounded-full bg-gold" />
              aktif
            </span>
          )}
        </div>
        <div className="font-display italic text-xs text-ink-light line-clamp-1">
          {tagline}
        </div>

        {/* Mini fingerprint bars */}
        <div className="mt-2.5 flex gap-3.5 font-ui text-[10.5px] text-ink-muted">
          {miniBars.map((m) => (
            <div key={m.label} className="flex-1 flex flex-col gap-1">
              <span className="tracking-wider">{m.label}</span>
              <div className="h-1 rounded-sm bg-sandy-soft overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${Math.round(m.v * 100)}%`,
                    background: color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Sample text */}
        <div
          className="mt-3 px-3 py-2 rounded-r-md font-display italic text-[12px] text-ink leading-relaxed line-clamp-2 bg-elevated"
          style={{ borderLeft: `2px solid ${color}` }}
        >
          “{sample}”
        </div>

        {/* Tags + footer */}
        <div className="mt-auto pt-3 flex items-center gap-1.5 flex-wrap">
          {(Array.isArray(p.profile?.transitionPatterns)
            ? ((p.profile?.transitionPatterns as string[]) ?? []).slice(0, 3)
            : []
          ).map((tag) => (
            <span
              key={tag}
              className="font-ui text-[10px] px-1.5 py-0.5 rounded-sm border border-sandy/60 bg-elevated text-ink-light"
            >
              {tag}
            </span>
          ))}
          <span className="flex-1" />
          <span className="font-ui text-[10.5px] text-ink-muted inline-flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {p.method === "analyze" ? "analiz" : "sohbet"} ·{" "}
            {new Date(p.updatedAt).toLocaleDateString("tr-TR", {
              day: "numeric",
              month: "short",
            })}
          </span>
        </div>
      </div>
    </article>
  );
}

function VoiceWave() {
  // Decorative bar chart inside the profile glyph. Heights are static
  // so different profiles don't visually disagree about their own
  // shape — colour comes from the gradient behind.
  const heights = [10, 18, 26, 14, 32, 20, 28, 12, 22, 16, 8];
  return (
    <svg viewBox="0 0 60 40" className="w-full block" aria-hidden>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 5.5 + 3}
          y={20 - h / 2}
          width={2.5}
          height={h}
          fill="rgba(255,255,255,0.85)"
          rx={1.2}
        />
      ))}
    </svg>
  );
}

function ProfileDetail({
  selected,
  rank,
  onEdit,
  onDelete,
  onWriteWith,
}: {
  selected: ProfileData;
  rank: number;
  onEdit: () => void;
  onDelete: () => void;
  onWriteWith?: () => void;
}) {
  const fp = useMemo(
    () => fingerprintMetrics(selected.profile),
    [selected.profile],
  );

  // Trial output state — null until the user fires "Üret", error
  // becomes a toast, real text replaces the synthesised fallback in
  // the "İkizi dene" block.
  const [trialOutput, setTrialOutput] = useState<string | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const trialPrompt = useMemo(
    () => `${selected.name} üslubunda kısa bir paragraf yaz.`,
    [selected.name],
  );

  async function runTrial() {
    setTrialBusy(true);
    try {
      const res = await fetch(
        `/api/style-profiles/${selected.id}/try`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trialPrompt }),
        },
      );
      if (res.status === 402) {
        const err = await res.json().catch(() => ({}));
        toast.error(
          `Yetersiz kredi (${err.balance ?? 0} kalan).`,
        );
        return;
      }
      if (!res.ok) {
        toast.error("Üretim başarısız oldu.");
        return;
      }
      const data = (await res.json()) as { paragraph?: string };
      if (!data.paragraph) {
        toast.error("Boş yanıt geldi.");
        return;
      }
      setTrialOutput(data.paragraph);
    } catch {
      toast.error("Bağlantı hatası.");
    } finally {
      setTrialBusy(false);
    }
  }

  // Reset trial output when the user switches between profiles.
  useEffect(() => {
    setTrialOutput(null);
  }, [selected.id]);

  // Sample list — pulled from the StyleSample table the analyze
  // pipeline writes to. Re-fetches whenever the user opens the
  // dialog-driven add flow or switches profiles.
  interface StyleSampleRow {
    id: string;
    filename: string;
    wordCount: number;
    origin: string;
    createdAt: string;
    preview?: string;
  }
  const [samples, setSamples] = useState<StyleSampleRow[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [addingSample, setAddingSample] = useState(false);
  const [sampleDraft, setSampleDraft] = useState("");

  const reloadSamples = useCallback(() => {
    setSamplesLoading(true);
    fetch(`/api/style-profiles/${selected.id}/samples`)
      .then((r) => (r.ok ? r.json() : { samples: [] }))
      .then((data) => {
        setSamples(data.samples ?? []);
      })
      .catch(() => undefined)
      .finally(() => setSamplesLoading(false));
  }, [selected.id]);

  useEffect(() => {
    reloadSamples();
  }, [reloadSamples]);

  async function deleteSample(id: string) {
    if (!confirm("Bu örnek metin silinsin mi?")) return;
    try {
      const res = await fetch(
        `/api/style-profiles/${selected.id}/samples/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        toast.error("Silinemedi");
        return;
      }
      reloadSamples();
    } catch {
      toast.error("Bağlantı hatası");
    }
  }

  async function submitSample() {
    const content = sampleDraft.trim();
    if (content.length < 40) {
      toast.error("Örnek metin çok kısa (en az 40 karakter).");
      return;
    }
    try {
      const res = await fetch(
        `/api/style-profiles/${selected.id}/samples`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, origin: "paste" }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Eklenemedi");
        return;
      }
      toast.success("Örnek metin eklendi");
      setSampleDraft("");
      setAddingSample(false);
      reloadSamples();
    } catch {
      toast.error("Bağlantı hatası");
    }
  }
  const tagline = useMemo(
    () => profileTagline(selected.profile),
    [selected.profile],
  );
  const tags = useMemo(() => {
    const p = (selected.profile ?? {}) as Partial<StyleProfile>;
    return Array.isArray(p.transitionPatterns)
      ? ((p.transitionPatterns as string[]) ?? []).slice(0, 8)
      : [];
  }, [selected.profile]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-ui text-[10px] uppercase tracking-[0.14em] text-forest">
          Aktif ses · #{rank}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm font-ui text-[11px] text-ink-light hover:bg-elevated hover:text-ink transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Düzenle
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-ink-light hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Profili sil"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <h2 className="font-display italic font-medium text-[26px] leading-tight text-forest-deep">
        {selected.name}
      </h2>
      <div className="mt-1 font-display italic text-[12.5px] text-ink-light">
        “{tagline}”
      </div>

      {/* Voice fingerprint card */}
      <div className="mt-4 rounded-xl border border-sandy/60 bg-elevated p-4">
        <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-3">
          Ses parmak izi
        </div>
        <div className="flex items-center gap-4">
          <VoiceRadar fp={fp} />
          <div className="flex-1 flex flex-col gap-1.5 font-ui text-[11.5px]">
            <FingerprintRow color="#3a5238" label="Resmiyet" v={fp.formality} />
            <FingerprintRow color="#8a6a3d" label="Cümle uzunluğu" valueLabel={describeSentenceLen(selected.profile as Partial<StyleProfile> | null)} v={fp.sentenceLength} />
            <FingerprintRow color="#b89149" label="Analitik" v={fp.analytical} />
            <FingerprintRow color="#5a7050" label="Mecaz kullanımı" v={fp.metaphor} />
            <FingerprintRow color="#6a4a2a" label="Birinci tekil" v={fp.firstPerson} />
            <FingerprintRow color="#a08a5a" label="Pasif çatı" v={fp.passive} />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3.5 pt-3 border-t border-sandy/60">
            {tags.map((t) => (
              <span
                key={t}
                className="font-ui text-[10px] px-1.5 py-0.5 rounded-sm border border-forest/40 bg-forest/10 text-forest"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Samples — real rows from /api/style-profiles/[id]/samples.
          Empty state surfaces an inviting prompt because the analyze
          flow saves its inputs here automatically. */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest">
            Örnek metinler {samples.length > 0 && `· ${samples.length}`}
          </span>
          <button
            type="button"
            onClick={() => setAddingSample((v) => !v)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-ui text-[11px] text-ink-light hover:text-ink"
          >
            <Plus className="h-3 w-3" />
            {addingSample ? "İptal" : "Ekle"}
          </button>
        </div>

        {addingSample && (
          <div className="mt-2 flex flex-col gap-2 p-2.5 rounded-md border border-sandy/60 bg-elevated">
            <textarea
              value={sampleDraft}
              onChange={(e) => setSampleDraft(e.target.value)}
              placeholder="Bu profile beslemek istediğin metni yapıştır (en az 40 karakter)…"
              rows={4}
              className="w-full resize-y rounded-sm border border-sandy bg-page px-2 py-1.5 font-body text-[12px] text-ink placeholder:italic placeholder:text-ink-muted focus:outline-none focus:border-gold"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSampleDraft("");
                  setAddingSample(false);
                }}
                className="font-ui text-[11px] text-ink-muted hover:text-ink"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={submitSample}
                disabled={sampleDraft.trim().length < 40}
                className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1 font-ui text-[11px] font-semibold text-white hover:bg-gold-hover transition-colors disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                Kaydet
              </button>
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-1.5">
          {samplesLoading ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 text-ink-muted font-ui text-[11.5px]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Yükleniyor…
            </div>
          ) : samples.length === 0 ? (
            <p className="px-2.5 py-3 font-body italic text-[12px] text-ink-muted text-center">
              Henüz örnek metin yok — bir şeyler yapıştır, profil zenginleşsin.
            </p>
          ) : (
            samples.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-elevated border border-sandy/60 font-ui text-[11.5px] text-ink-light"
              >
                <FileText className="h-3 w-3 text-ink-muted shrink-0" />
                <span className="flex-1 truncate" title={s.filename}>
                  {s.filename}
                </span>
                <span className="font-mono text-[10.5px] text-ink-muted tabular-nums shrink-0">
                  {s.wordCount.toLocaleString("tr-TR")} kel.
                </span>
                <button
                  type="button"
                  onClick={() => deleteSample(s.id)}
                  className="text-ink-muted hover:text-red-600 transition-colors"
                  title="Sil"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* "İkizi dene" preview block — dark olive panel, mock-styled.
          Real Haiku output when the user fires "Üret"; falls back to a
          synthesised demo cümle for new profiles where no trial has
          run yet so the panel never reads empty. */}
      <div
        className="mt-5 rounded-xl px-4 py-3.5 text-gold-soft"
        style={{
          background: "var(--color-forest-deep)",
        }}
      >
        <div className="flex items-center gap-1.5 font-ui text-[10px] uppercase tracking-[0.1em] text-gold-soft/70 mb-2">
          <Sparkles className="h-3 w-3 text-gold-soft" />
          İkizi dene
        </div>
        <div className="font-body text-xs text-white/85 leading-relaxed">
          <span className="font-display italic text-gold-soft/60">Sen:</span>{" "}
          “{trialPrompt}”
        </div>
        <div
          className="mt-2.5 pt-2.5 border-t font-display text-[12.5px] leading-relaxed text-white whitespace-pre-line"
          style={{ borderColor: "rgba(232,212,154,0.2)" }}
        >
          {trialBusy ? (
            <span className="inline-flex items-center gap-2 text-gold-soft/80 italic">
              <Loader2 className="h-3 w-3 animate-spin" />
              {selected.name} üslubunda üretiyor…
            </span>
          ) : trialOutput ? (
            trialOutput
          ) : samples[0]?.preview ? (
            // Prefer the most recent saved sample as the empty-state
            // preview — gerçek metin gerçek üslubu daha doğru gösterir.
            <span className="italic text-gold-soft/85">
              “{samples[0].preview.trim()}
              {samples[0].preview.length >= 280 ? "…" : ""}”
              <br />
              <span className="text-[10.5px] text-gold-soft/55 not-italic">
                (kayıtlı örnek — Üret&apos;e bas, ses ikizin yeni paragraf
                yazsın.)
              </span>
            </span>
          ) : (
            <span className="italic text-gold-soft/70">
              {profileSample(selected.profile)}
              <br />
              <span className="text-[10.5px] text-gold-soft/55 not-italic">
                (sentez metin — Üret&apos;e bas, ses ikizin gerçek paragraf
                yazsın.)
              </span>
            </span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onWriteWith}
            disabled={!onWriteWith}
            className="inline-flex items-center gap-1 rounded-md bg-gold px-3 py-1.5 font-ui text-[12px] font-semibold text-white hover:bg-gold-hover transition-colors disabled:opacity-50"
          >
            <Feather className="h-3 w-3" />
            Bu sesle yaz
          </button>
          <button
            type="button"
            onClick={runTrial}
            disabled={trialBusy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 font-ui text-[11px] text-gold-soft/85 hover:text-gold-soft transition-colors disabled:opacity-50"
            title={trialOutput ? "Yeniden üret" : "Üret"}
          >
            {trialBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 text-gold-soft" />
            )}
            {trialOutput ? "Yeniden üret" : "Üret"}
          </button>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-gold-soft/55">
            ~Haiku · birkaç cr
          </span>
        </div>
      </div>
    </div>
  );
}

function FingerprintRow({
  color,
  label,
  v,
  valueLabel,
}: {
  color: string;
  label: string;
  v: number;
  valueLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span className="flex-1 text-ink-light">{label}</span>
      <span className="font-semibold text-ink">
        {valueLabel ?? describeAxis(v)}
      </span>
    </div>
  );
}

function VoiceRadar({ fp }: { fp: FingerprintMetrics }) {
  // 6 axes, mock order: resmiyet, cümle uzunluğu, analitik, mecaz,
  // birinci tekil, pasif çatı.
  const points = [
    fp.formality,
    fp.sentenceLength,
    fp.analytical,
    fp.metaphor,
    fp.firstPerson,
    fp.passive,
  ];
  const cx = 60;
  const cy = 60;
  const r = 50;
  const angleAt = (i: number) => (Math.PI * 2 * i) / 6 - Math.PI / 2;
  const px = (v: number, i: number) => cx + Math.cos(angleAt(i)) * r * v;
  const py = (v: number, i: number) => cy + Math.sin(angleAt(i)) * r * v;
  const poly = points.map((v, i) => `${px(v, i)},${py(v, i)}`).join(" ");
  return (
    <svg
      viewBox="0 0 120 120"
      width={120}
      height={120}
      className="shrink-0"
      aria-hidden
    >
      {[0.33, 0.66, 1].map((s) => (
        <polygon
          key={s}
          points={[0, 1, 2, 3, 4, 5]
            .map((i) => `${px(s, i)},${py(s, i)}`)
            .join(" ")}
          fill="none"
          stroke="var(--color-sandy-soft)"
          strokeWidth={1}
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={px(1, i)}
          y2={py(1, i)}
          stroke="var(--color-sandy-soft)"
          strokeWidth={1}
        />
      ))}
      <polygon
        points={poly}
        fill="rgba(58,82,56,0.25)"
        stroke="var(--color-forest)"
        strokeWidth={1.6}
      />
      {points.map((v, i) => (
        <circle
          key={i}
          cx={px(v, i)}
          cy={py(v, i)}
          r={2.5}
          fill="var(--color-gold)"
        />
      ))}
    </svg>
  );
}

function EmptyVoice({
  onCreated,
}: {
  onCreated: (created: { id: string; method: string }) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-sm bg-gold/10 flex items-center justify-center mb-4">
        <Feather className="h-7 w-7 text-gold" />
      </div>
      <h2 className="font-display italic text-lg font-semibold text-ink mb-2">
        Henüz bir ses profilin yok
      </h2>
      <p className="font-body text-sm text-ink-light max-w-sm mb-5">
        İlk Writing Twin&apos;ini sohbet üzerinden ya da örnek metin analiziyle
        oluştur.
      </p>
      <NewProfileDialog onCreated={onCreated} />
    </div>
  );
}
