"use client";

import { useState } from "react";
import { toast } from "sonner";
import ChapterCard from "./ChapterCard";
import type { ChapterWithSections } from "@/types/project";

interface StructureTreeProps {
  projectId: string;
  chapters: ChapterWithSections[];
  onChaptersChange?: (chapters: ChapterWithSections[]) => void;
}

export default function StructureTree({
  projectId,
  chapters,
  onChaptersChange,
}: StructureTreeProps) {
  const [localChapters, setLocalChapters] = useState<ChapterWithSections[]>(chapters);

  async function patchTitle(
    endpoint: string,
    id: string,
    title: string
  ) {
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title }),
    });
    if (!res.ok) throw new Error("Failed to save");
  }

  function handleChapterTitleChange(chapterId: string, newTitle: string) {
    const updated = localChapters.map((ch) =>
      ch.id === chapterId ? { ...ch, title: newTitle } : ch
    );
    setLocalChapters(updated);
    onChaptersChange?.(updated);

    patchTitle(`/api/projects/${projectId}/chapters/${chapterId}`, chapterId, newTitle).catch(
      () => toast.error("Failed to save chapter title")
    );
  }

  function handleSectionTitleChange(sectionId: string, newTitle: string) {
    const updated = localChapters.map((ch) => ({
      ...ch,
      sections: ch.sections.map((sec) =>
        sec.id === sectionId ? { ...sec, title: newTitle } : sec
      ),
    }));
    setLocalChapters(updated);
    onChaptersChange?.(updated);

    fetch(`/api/projects/${projectId}/sections/${sectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sectionId, title: newTitle }),
    }).catch(() => toast.error("Failed to save section title"));
  }

  function handleSubsectionTitleChange(subsectionId: string, newTitle: string) {
    const updated = localChapters.map((ch) => ({
      ...ch,
      sections: ch.sections.map((sec) => ({
        ...sec,
        subsections: sec.subsections.map((sub) =>
          sub.id === subsectionId ? { ...sub, title: newTitle } : sub
        ),
      })),
    }));
    setLocalChapters(updated);
    onChaptersChange?.(updated);

    fetch(`/api/projects/${projectId}/subsections/${subsectionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: subsectionId, title: newTitle }),
    }).catch(() => toast.error("Failed to save subsection title"));
  }

  if (localChapters.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {localChapters.map((chapter) => (
        <ChapterCard
          key={chapter.id}
          chapter={chapter}
          onTitleChange={handleChapterTitleChange}
          onSectionTitleChange={handleSectionTitleChange}
          onSubsectionTitleChange={handleSubsectionTitleChange}
        />
      ))}
    </div>
  );
}
