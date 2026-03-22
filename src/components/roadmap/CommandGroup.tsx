"use client";

import { CheckCircle, XCircle } from "lucide-react";

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
  if (chapters > 0) parts.push(`${chapters} chapter${chapters !== 1 ? 's' : ''}`);
  if (sections > 0) parts.push(`${sections} section${sections !== 1 ? 's' : ''}`);
  if (subsections > 0) parts.push(`${subsections} subsection${subsections !== 1 ? 's' : ''}`);
  if (sources > 0) parts.push(`${sources} source${sources !== 1 ? 's' : ''}`);
  if (updates > 0) parts.push(`${updates} update${updates !== 1 ? 's' : ''}`);
  if (removals > 0) parts.push(`${removals} removal${removals !== 1 ? 's' : ''}`);
  if (projectUpdates > 0) parts.push(`${projectUpdates} project update${projectUpdates !== 1 ? 's' : ''}`);

  return parts.join(" · ");
}

export default function CommandGroup({ commands, applied }: CommandGroupProps) {
  const summary = buildSummaryText(commands);

  return (
    <div className="mt-2 rounded-lg border bg-card text-card-foreground shadow-sm px-3 py-2.5 flex items-center gap-2">
      {applied ? (
        <CheckCircle className="h-4 w-4 text-[#C9A84C] shrink-0" />
      ) : (
        <XCircle className="h-4 w-4 text-[#8a4a4a] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-ui text-xs font-medium">
          {applied ? "Roadmap updated" : "Changes could not be applied"}
        </p>
        <p className="font-ui text-[11px] text-muted-foreground mt-0.5">{summary}</p>
      </div>
    </div>
  );
}
