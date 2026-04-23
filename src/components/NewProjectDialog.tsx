"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, BookOpen, GraduationCap, Feather } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type ProjectType = "ACADEMIC" | "CREATIVE";
type CitationFormat = "ISNAD" | "APA" | "CHICAGO" | "MLA" | "HARVARD" | "VANCOUVER" | "IEEE" | "AMA" | "TURABIAN";

const PROJECT_TYPES: { value: ProjectType; label: string; desc: string; icon: typeof GraduationCap }[] = [
  { value: "ACADEMIC", label: "Akademik", desc: "Araştırma, tez, kaynaklı makaleler", icon: GraduationCap },
  { value: "CREATIVE", label: "Serbest Yazım", desc: "Kurgu, kurgu-dışı, anı, deneme — kaynaksız", icon: Feather },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "tr", label: "Turkish" },
  { value: "ar", label: "Arabic" },
  { value: "fa", label: "Persian" },
  { value: "ur", label: "Urdu" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "ru", label: "Russian" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "id", label: "Indonesian" },
  { value: "ms", label: "Malay" },
  { value: "hi", label: "Hindi" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish" },
  { value: "no", label: "Norwegian" },
  { value: "fi", label: "Finnish" },
  { value: "el", label: "Greek" },
  { value: "cs", label: "Czech" },
  { value: "ro", label: "Romanian" },
  { value: "hu", label: "Hungarian" },
  { value: "uk", label: "Ukrainian" },
  { value: "bg", label: "Bulgarian" },
  { value: "hr", label: "Croatian" },
  { value: "sr", label: "Serbian" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "lt", label: "Lithuanian" },
  { value: "lv", label: "Latvian" },
  { value: "et", label: "Estonian" },
  { value: "th", label: "Thai" },
  { value: "vi", label: "Vietnamese" },
  { value: "tl", label: "Filipino" },
  { value: "bn", label: "Bengali" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "ml", label: "Malayalam" },
  { value: "sw", label: "Swahili" },
  { value: "am", label: "Amharic" },
  { value: "he", label: "Hebrew" },
  { value: "ka", label: "Georgian" },
  { value: "az", label: "Azerbaijani" },
  { value: "uz", label: "Uzbek" },
  { value: "kk", label: "Kazakh" },
  { value: "ca", label: "Catalan" },
  { value: "gl", label: "Galician" },
  { value: "eu", label: "Basque" },
  { value: "af", label: "Afrikaans" },
  { value: "sq", label: "Albanian" },
  { value: "mk", label: "Macedonian" },
  { value: "bs", label: "Bosnian" },
  { value: "mn", label: "Mongolian" },
  { value: "my", label: "Burmese" },
  { value: "km", label: "Khmer" },
  { value: "lo", label: "Lao" },
  { value: "ne", label: "Nepali" },
  { value: "si", label: "Sinhala" },
  { value: "ku", label: "Kurdish" },
  { value: "ps", label: "Pashto" },
  { value: "ky", label: "Kyrgyz" },
  { value: "tg", label: "Tajik" },
  { value: "tk", label: "Turkmen" },
];

const CITATION_FORMATS: { value: CitationFormat; label: string }[] = [
  { value: "ISNAD", label: "ISNAD" },
  { value: "APA", label: "APA 7th" },
  { value: "CHICAGO", label: "Chicago" },
  { value: "MLA", label: "MLA 9th" },
  { value: "HARVARD", label: "Harvard" },
  { value: "VANCOUVER", label: "Vancouver" },
  { value: "IEEE", label: "IEEE" },
  { value: "AMA", label: "AMA 11th" },
  { value: "TURABIAN", label: "Turabian 9th" },
];

interface NewProjectDialogProps {
  variant?: "default" | "empty";
}

interface StyleProfileOption {
  id: string;
  name: string;
  profile: unknown;
}

export default function NewProjectDialog({ variant = "default" }: NewProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectType, setProjectType] = useState<ProjectType>("ACADEMIC");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("en");
  const [citationFormat, setCitationFormat] = useState<CitationFormat>("ISNAD");
  const [styleProfileId, setStyleProfileId] = useState("none");
  const [styleProfiles, setStyleProfiles] = useState<StyleProfileOption[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/style-profiles")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const withProfile = (data as StyleProfileOption[]).filter((p) => p.profile !== null);
        setStyleProfiles(withProfile);
      })
      .catch(() => setStyleProfiles([]));
  }, [open]);

  const needsSources = projectType === "ACADEMIC";

  function resetForm() {
    setProjectType("ACADEMIC");
    setTitle("");
    setLanguage("en");
    setCitationFormat("ISNAD");
    setStyleProfileId("none");
  }

  async function handleCreate() {
    if (!title.trim()) {
      toast.error("Book title is required.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          language,
          projectType,
          ...(needsSources && { citationFormat }),
          ...(styleProfileId !== "none" && { styleProfileId }),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create project" }));
        throw new Error(err.error ?? "Failed to create project");
      }

      const project = await res.json();
      toast.success("Project created!");
      setOpen(false);
      resetForm();
      router.push(`/projects/${project.id}/roadmap`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      {variant === "empty" ? (
        <Button
          onClick={() => setOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Create your first book
        </Button>
      ) : (
        <Button
          onClick={() => setOpen(true)}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Book Project</DialogTitle>
            <DialogDescription>
              Enter a title to get started. You&apos;ll build the roadmap through
              conversation with AI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Project Type */}
            <div className="space-y-2">
              <Label>Project Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {PROJECT_TYPES.map((pt) => {
                  const Icon = pt.icon;
                  return (
                    <button
                      key={pt.value}
                      type="button"
                      onClick={() => setProjectType(pt.value)}
                      className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                        projectType === pt.value
                          ? "border-foreground/30 bg-muted shadow-sm"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="h-4 w-4 mb-1 text-muted-foreground" />
                      <span className="font-ui text-xs font-medium block">{pt.label}</span>
                      <span className="font-body text-[10px] text-muted-foreground block">{pt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="book-title">Title *</Label>
              <Input
                id="book-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Islamic Philosophy in the Ottoman Era"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim()) handleCreate();
                }}
                autoFocus
              />
            </div>

            <div className={`grid ${needsSources ? "grid-cols-2" : "grid-cols-1"} gap-4`}>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {needsSources && (
                <div className="space-y-2">
                  <Label>Citation Format</Label>
                  <Select value={citationFormat} onValueChange={(v) => v && setCitationFormat(v as CitationFormat)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CITATION_FORMATS.map((fmt) => (
                        <SelectItem key={fmt.value} value={fmt.value}>
                          {fmt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {styleProfiles.length > 0 && (
              <div className="space-y-2">
                <Label>Writing Style Profile</Label>
                <Select value={styleProfileId} onValueChange={(v) => v && setStyleProfileId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No style profile">
                      {styleProfileId === "none"
                        ? "No style profile"
                        : styleProfiles.find((p) => p.id === styleProfileId)?.name ?? styleProfileId}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No style profile</SelectItem>
                    {styleProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!title.trim() || isCreating}
              className="gap-2"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="h-4 w-4" />
              )}
              {isCreating ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
