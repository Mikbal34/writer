"use client";

import { Plus, Pencil, Trash2, BookOpen, Info } from "lucide-react";
import type { ComponentType } from "react";

interface CommandCardProps {
 command: Record<string, unknown>;
}

function getCommandStyle(action: string): {
 borderClass: string;
 Icon: ComponentType<{ className?: string }>;
 label: string;
} {
 if (action === "add_source") {
  return { borderClass: "border-[#C9A84C]/40 bg-[#C9A84C]/5", Icon: BookOpen, label: "Source added" };
 }
 if (action === "update_project") {
  return { borderClass: "border-[#C9A84C]/40 bg-[#C9A84C]/5", Icon: Info, label: "Project updated" };
 }
 if (action.startsWith("add_")) {
  return { borderClass: "border-[#C9A84C]/40 bg-[#C9A84C]/5", Icon: Plus, label: "Added" };
 }
 if (action.startsWith("update_")) {
  return { borderClass: "border-[#8a7a65]/30 bg-[#8a7a65]/5", Icon: Pencil, label: "Updated" };
 }
 if (action.startsWith("remove_")) {
  return { borderClass: "border-[#8a4a4a]/30 bg-[#8a4a4a]/5", Icon: Trash2, label: "Removed" };
 }
 return { borderClass: "border-[#d4c9b5]/50 bg-[#d4c9b5]/10", Icon: Info, label: action };
}

function getDetail(command: Record<string, unknown>): string {
 const action = (command.action as string) ?? "";
 const params = (command.params ?? command) as Record<string, unknown>;

 if (action === "add_source") {
  const author = params.author ?? "";
  const work = params.work ?? params.title ?? "";
  return author && work ? `${author} — ${work}` : `${author}${work}`;
 }

 const title = params.title as string | undefined;
 if (title) return title;

 // For updates, show changed fields
 const skipKeys = ["action", "id", "chapterId", "sectionId", "subsectionId", "params"];
 const fields = Object.keys(params).filter((k) => !skipKeys.includes(k));
 if (fields.length > 0) return fields.join(", ");

 return "";
}

export default function CommandCard({ command }: CommandCardProps) {
 const action = (command.action as string) ?? "unknown";
 const { borderClass, Icon, label } = getCommandStyle(action);
 const detail = getDetail(command);

 return (
  <div className={`rounded-lg border-l-4 ${borderClass} px-3 py-2 my-2 text-xs`}>
   <div className="flex items-center gap-1.5 font-medium">
    <Icon className="h-3.5 w-3.5" />
    <span>{label}</span>
   </div>
   {detail && (
    <p className="text-muted-foreground mt-0.5">{detail}</p>
   )}
  </div>
 );
}
