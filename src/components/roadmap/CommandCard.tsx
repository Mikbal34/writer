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
  return { borderClass: "border-green-500 bg-green-50 dark:bg-green-950/20", Icon: BookOpen, label: "Kaynak eklendi" };
 }
 if (action === "update_project") {
  return { borderClass: "border-primary bg-accent", Icon: Info, label: "Proje güncellendi" };
 }
 if (action.startsWith("add_")) {
  return { borderClass: "border-green-500 bg-green-50 dark:bg-green-950/20", Icon: Plus, label: "Eklendi" };
 }
 if (action.startsWith("update_")) {
  return { borderClass: "border-blue-500 bg-blue-50 dark:bg-blue-950/20", Icon: Pencil, label: "Güncellendi" };
 }
 if (action.startsWith("remove_")) {
  return { borderClass: "border-red-500 bg-red-50 dark:bg-red-950/20", Icon: Trash2, label: "Silindi" };
 }
 return { borderClass: "border-gray-400 bg-gray-50 dark:bg-gray-950/20", Icon: Info, label: action };
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
