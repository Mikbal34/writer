"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Feather,
  Loader2,
  ArrowLeft,
  LogOut,
  Library,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Ornament } from "@/components/shared/BookElements";
import { FadeUp } from "@/components/shared/Animations";
import StyleProfileCard from "@/components/style/StyleProfileCard";
import StyleChat from "@/components/style/StyleChat";
import StyleAnalyzeView from "@/components/style/StyleAnalyzeView";
import StyleProfilePreview from "@/components/style/StyleProfilePreview";
import NewProfileDialog from "@/components/style/NewProfileDialog";
import type { StyleProfile } from "@/types/project";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

interface ProfileData {
  id: string;
  name: string;
  profile: Record<string, unknown> | null;
  method: string;
  createdAt: string;
  updatedAt: string;
}

// Shared navbar used across all views
function Navbar() {
  return (
    <nav className="bg-[#1A0F05]/95 backdrop-blur-md border-b border-[#C9A84C]/20 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/images/quilpen-logo-horizontal.png" alt="Quilpen" className="h-20 animate-logo-in" />
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/library"
            className="flex items-center gap-1.5 font-ui text-sm text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
          >
            <Library className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">My Library</span>
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex items-center gap-1.5 font-ui text-sm text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function StylePage() {
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<"list" | "chat" | "analyze">("list");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<Partial<StyleProfile> | null>(null);

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

  // ─── List view ────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div
        className="min-h-screen"
        style={{
          backgroundImage: `url(${TEXTURE_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <Navbar />

        <main className="max-w-6xl mx-auto px-6 py-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 font-ui text-xs text-[#8a7a65] hover:text-[#2D1F0E] transition-colors mb-6"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to My Books
          </Link>

          <FadeUp className="mb-8 text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[#C9A84C]/60" />
              <Feather className="h-5 w-5 text-[#C9A84C]" />
              <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[#C9A84C]/60" />
            </div>
            <h1 className="font-display text-3xl font-bold text-[#2D1F0E] tracking-tight">
              Writing Twin
            </h1>
            <p className="font-body text-sm text-[#6b5a45] mt-1.5">
              Create and manage your writing style profiles.
            </p>
          </FadeUp>

          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <span className="font-ui text-xs text-[#8a7a65]">
              {profiles.length} profile{profiles.length !== 1 ? "s" : ""}
            </span>
            <NewProfileDialog onCreated={handleCreated} />
          </div>

          <Ornament className="w-32 mx-auto text-[#c9bfad] mb-5" />

          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-[#C9A84C]" />
              <span className="font-body text-sm text-[#8a7a65]">Loading...</span>
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-14 h-14 rounded-sm bg-[#C9A84C]/10 flex items-center justify-center mb-4">
                <Feather className="h-7 w-7 text-[#C9A84C]" />
              </div>
              <h2 className="font-display text-lg font-semibold text-[#2D1F0E] mb-2">
                No style profiles yet
              </h2>
              <p className="font-body text-sm text-[#8a7a65] max-w-sm mb-6">
                Create your first Writing Twin profile through a chat interview
                or by analyzing a writing sample.
              </p>
              <NewProfileDialog onCreated={handleCreated} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {profiles.map((p) => (
                <StyleProfileCard
                  key={p.id}
                  profile={p}
                  onOpen={handleOpenProfile}
                  onDelete={handleDeleteProfile}
                />
              ))}
            </div>
          )}

          <div className="text-center py-4 mt-4">
            <span className="font-display text-xs text-[#a89880] italic">
              --- x ---
            </span>
          </div>
        </main>
      </div>
    );
  }

  // ─── Chat / Analyze view ──────────────────────────────────────
  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#FAF7F0]">
        <Loader2 className="h-6 w-6 animate-spin text-[#C9A84C]" />
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
      <div
        className="min-h-screen flex flex-col"
        style={{
          backgroundImage: `url(${TEXTURE_URL})`,
          backgroundSize: "cover",
          backgroundAttachment: "fixed",
        }}
      >
        <Navbar />

        {/* Back bar */}
        <div className="max-w-6xl mx-auto w-full px-6 py-4">
          <button
            onClick={handleBackToList}
            className="inline-flex items-center gap-2 font-ui text-sm text-[#5C4A32] hover:text-[#2D1F0E] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-display font-semibold">{activeProfileName}</span>
          </button>
        </div>

        {/* Card container */}
        <div className="flex-1 max-w-6xl mx-auto w-full px-6 pb-6">
          <div className="bg-white rounded-lg shadow-sm border border-[#e8e0d4] overflow-hidden flex flex-col" style={{ minHeight: "70vh" }}>
            <Tabs defaultValue={view === "analyze" ? "analyze" : "chat"} className="flex flex-col flex-1 min-h-0">
              <TabsList className="w-full shrink-0 rounded-none border-b border-[#e8e0d4] bg-[#faf8f5]">
                <TabsTrigger
                  value={view === "analyze" ? "analyze" : "chat"}
                  className="flex-1 font-ui text-sm data-[state=active]:text-[#2D1F0E] data-[state=active]:border-b-2 data-[state=active]:border-[#C9A84C]"
                >
                  {view === "analyze" ? "Analyze" : "Chat"}
                </TabsTrigger>
                <TabsTrigger
                  value="profile"
                  className="flex-1 font-ui text-sm data-[state=active]:text-[#2D1F0E] data-[state=active]:border-b-2 data-[state=active]:border-[#C9A84C]"
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
      </div>
    );
  }

  // Desktop layout
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
      }}
    >
      <Navbar />

      {/* Back bar */}
      <div className="max-w-6xl mx-auto w-full px-6 py-4">
        <button
          onClick={handleBackToList}
          className="inline-flex items-center gap-2 font-ui text-sm text-[#5C4A32] hover:text-[#2D1F0E] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="font-display font-semibold">{activeProfileName}</span>
        </button>
      </div>

      {/* Card container with split panel */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 pb-6">
        <div className="bg-white rounded-lg shadow-sm border border-[#e8e0d4] overflow-hidden" style={{ height: "calc(100vh - 140px)" }}>
          <PanelGroup orientation="horizontal">
            <Panel id="main" minSize={30} defaultSize={55}>
              {leftPanel}
            </Panel>
            <PanelResizeHandle
              style={{ width: 1, flexShrink: 0 }}
              className="bg-[#e8e0d4] hover:bg-[#C9A84C]/40 transition-colors cursor-col-resize"
            />
            <Panel id="preview" minSize={25} defaultSize={45}>
              {rightPanel}
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </div>
  );
}
