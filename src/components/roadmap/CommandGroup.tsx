"use client";

import { useState } from "react";
import { CheckCircle, XCircle, ChevronDown, ChevronRight, Plus, Pencil, Trash2, BookOpen, Info } from "lucide-react";
import CommandCard from "./CommandCard";

interface CommandGroupProps {
  commands: Array<Record<string, unknown>>;
  applied: boolean;
}

function buildSummaryText(commands: Array<Record<string, unknown>>): string {
  let chapters = 0;
  let sections = 0;
  let subsections = 0;
  let sources = 0;
  let updates = 0;
  let removals = 0;
  let projectUpdates = 0;

  for (const cmd of commands) {
    const action = cmd.action as string;
    switch (action) {
      case "add_chapter": chapters++; break;
      case "add_section": sections++; break;
      case "add_subsection": subsections++; break;
      case "add_source": sources++; break;
      case "remove_chapter":
      case "remove_section":
      case "remove_subsection":
      case "remove_source":
        removals++; break;
      case "update_project": projectUpdates++; break;
      case "update_chapter":
      case "update_section":
      case "update_subsection":
      case "update_source":
      case "move_section":
        updates++; break;
    }
  }

  const parts: string[] = [];
  if (chapters > 0) parts.push(`${chapters} bölüm`);
  if (sections > 0) parts.push(`${sections} alt bölüm`);
  if (subsections > 0) parts.push(`${subsections} alt başlık`);
  if (sources > 0) parts.push(`${sources} kaynak`);
  if (updates > 0) parts.push(`${updates} güncelleme`);
  if (removals > 0) parts.push(`${removals} silme`);
  if (projectUpdates > 0) parts.push(`${projectUpdates} proje güncellemesi`);

  return parts.join(" · ");
}

function getGroupIcon(commands: Array<Record<string, unknown>>) {
  const actions = commands.map((c) => c.action as string);
  const hasAdd = actions.some((a) => a.startsWith("add_"));
  const hasRemove = actions.some((a) => a.startsWith("remove_"));
  const hasUpdate = actions.some((a) => a.startsWith("update_") || a === "move_section");

  if (hasRemove && !hasAdd) return { Icon: Trash2, color: "text-red-600" };
  if (hasUpdate && !hasAdd && !hasRemove) return { Icon: Pencil, color: "text-blue-600" };
  if (hasAdd) return { Icon: Plus, color: "text-green-600" };
  return { Icon: Info, color: "text-muted-foreground" };
}

export default function CommandGroup({ commands, applied }: CommandGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = buildSummaryText(commands);
  const { Icon: GroupIcon, color: iconColor } = getGroupIcon(commands);

  return (
    <div className="mt-2 rounded-lg border bg-card text-card-foreground shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-muted/50 transition-colors rounded-lg"
      >
        {applied ? (
          <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-amber-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">
            {applied ? "Roadmap güncellendi" : "Değişiklikler uygulanamadı"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{summary}</p>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t">
          {commands.map((cmd, j) => (
            <CommandCard key={j} command={cmd} />
          ))}
        </div>
      )}
    </div>
  );
}
