"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LayoutDashboard,
  Map,
  Library,
  PenLine,
  Download,
  ChevronLeft,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  statusKey: string;
}

interface ProjectSidebarProps {
  projectId: string;
  projectTitle: string;
  projectStatus: string;
  completionPct?: number;
}

const STATUS_ORDER = ["onboarding", "roadmap", "sources", "writing", "completed"];

function getSectionStatus(
  sectionKey: string,
  projectStatus: string
): "done" | "active" | "pending" {
  const sectionIdx = STATUS_ORDER.indexOf(sectionKey);
  const currentIdx = STATUS_ORDER.indexOf(projectStatus);

  if (sectionIdx < currentIdx) return "done";
  if (sectionIdx === currentIdx) return "active";
  return "pending";
}

export default function ProjectSidebar({
  projectId,
  projectTitle,
  projectStatus,
  completionPct = 0,
}: ProjectSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: NavItem[] = [
    {
      label: "Dashboard",
      href: `/projects/${projectId}`,
      icon: <LayoutDashboard className="h-4 w-4" />,
      statusKey: "onboarding",
    },
    {
      label: "Roadmap",
      href: `/projects/${projectId}/roadmap`,
      icon: <Map className="h-4 w-4" />,
      statusKey: "roadmap",
    },
    {
      label: "Sources",
      href: `/projects/${projectId}/sources`,
      icon: <Library className="h-4 w-4" />,
      statusKey: "sources",
    },
    {
      label: "Write",
      href: `/projects/${projectId}/write`,
      icon: <PenLine className="h-4 w-4" />,
      statusKey: "writing",
    },
    {
      label: "Export",
      href: `/projects/${projectId}/export`,
      icon: <Download className="h-4 w-4" />,
      statusKey: "completed",
    },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="p-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4 text-sm"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All Projects
        </Link>
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary mt-0.5">
            <BookOpen className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm leading-tight line-clamp-2">
              {projectTitle}
            </h2>
            <Badge
              variant="secondary"
              className="mt-1 text-xs capitalize"
            >
              {projectStatus}
            </Badge>
          </div>
        </div>
      </div>

      <Separator />

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            item.href === `/projects/${projectId}`
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const sectionStatus = getSectionStatus(item.statusKey, projectStatus);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    isActive ? "text-foreground" : ""
                  )}
                >
                  {item.icon}
                </span>
                {item.label}
              </div>
              {sectionStatus === "done" && (
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
              {sectionStatus === "active" && (
                <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span className="tabular-nums">{completionPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 md:hidden bg-background border border-border shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
      >
        {mobileOpen ? (
          <X className="h-4 w-4" />
        ) : (
          <Menu className="h-4 w-4" />
        )}
      </Button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — mobile drawer + desktop static */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-background border-r border-border transition-transform duration-200 ease-in-out md:static md:translate-x-0 md:flex md:flex-col",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
