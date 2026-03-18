"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, BookOpen } from "lucide-react";
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

type CitationFormat = "ISNAD" | "APA" | "CHICAGO" | "MLA";

const LANGUAGES = [
  { value: "tr", label: "Turkish" },
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
];

const CITATION_FORMATS: { value: CitationFormat; label: string }[] = [
  { value: "ISNAD", label: "ISNAD" },
  { value: "APA", label: "APA 7th" },
  { value: "CHICAGO", label: "Chicago" },
  { value: "MLA", label: "MLA 9th" },
];

interface NewProjectDialogProps {
  variant?: "default" | "empty";
}

export default function NewProjectDialog({ variant = "default" }: NewProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("tr");
  const [citationFormat, setCitationFormat] = useState<CitationFormat>("ISNAD");
  const [isCreating, setIsCreating] = useState(false);

  function resetForm() {
    setTitle("");
    setLanguage("tr");
    setCitationFormat("ISNAD");
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
          citationFormat,
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
            <div className="space-y-2">
              <Label htmlFor="book-title">Book Title *</Label>
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

            <div className="grid grid-cols-2 gap-4">
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
            </div>
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
