"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Map,
  Library,
  Eye,
  PenLine,
  Download,
  ChevronLeft,
  Paintbrush,
  BookmarkCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CreditBalance from "@/components/shared/CreditBalance";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  statusKey: string;
  badge?: boolean;
}

interface ProjectSidebarProps {
  projectId: string;
  projectTitle: string;
  projectStatus: string;
  projectType?: string;
  completionPct?: number;
  /** When this project is part of a multi-volume series the sidebar
   *  header shows "Seri Adı · Cilt N" above the title. */
  seriesName?: string | null;
  seriesOrder?: number | null;
}

const STATUS_ORDER = ["roadmap", "sources", "writing", "completed"];

function getSectionStatus(
  sectionKey: string,
  projectStatus: string,
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
  projectType = "ACADEMIC",
  completionPct = 0,
  seriesName = null,
  seriesOrder = null,
}: ProjectSidebarProps) {
  const pathname = usePathname();
  const [activeOps, setActiveOps] = useState(0);
  const needsSources = projectType === "ACADEMIC";

  // Poll for active operations (write jobs running in the background).
  const checkActiveOps = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/active-operations`);
      if (res.ok) {
        const data = await res.json();
        setActiveOps(data.writing?.length ?? 0);
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    checkActiveOps();
    const interval = setInterval(checkActiveOps, 10000);
    return () => clearInterval(interval);
  }, [checkActiveOps]);

  const allNavItems: NavItem[] = [
    {
      label: "Dashboard",
      href: `/projects/${projectId}`,
      icon: <LayoutDashboard className="w-4 h-4" />,
      statusKey: "roadmap",
    },
    {
      label: "Roadmap",
      href: `/projects/${projectId}/roadmap`,
      icon: <Map className="w-4 h-4" />,
      statusKey: "roadmap",
      badge: true,
    },
    {
      label: "Sources",
      href: `/projects/${projectId}/sources`,
      icon: <Library className="w-4 h-4" />,
      statusKey: "sources",
    },
    {
      label: "Write",
      href: `/projects/${projectId}/write`,
      icon: <PenLine className="w-4 h-4" />,
      statusKey: "writing",
    },
    {
      label: "Atıflar",
      href: `/projects/${projectId}/citations`,
      icon: <BookmarkCheck className="w-4 h-4" />,
      statusKey: "writing",
    },
    {
      label: "Art",
      href: `/projects/${projectId}/preview`,
      icon: <Eye className="w-4 h-4" />,
      statusKey: "writing",
    },
    {
      label: "Design",
      href: `/projects/${projectId}/design`,
      icon: <Paintbrush className="w-4 h-4" />,
      statusKey: "writing",
    },
    {
      label: "Export",
      href: `/projects/${projectId}/export`,
      icon: <Download className="w-4 h-4" />,
      statusKey: "completed",
    },
  ];

  const navItems = allNavItems
    .filter((item) => needsSources || item.statusKey !== "sources")
    .filter((item) =>
      needsSources ? item.label !== "Art" && item.label !== "Design" : true,
    );

  return (
    <div className="flex flex-col h-full">
      {/* Project header */}
      <div className="p-4 border-b border-sandy/40">
        <Link
          href="/"
          className="flex items-center gap-1.5 mb-3 hover:opacity-70 transition-opacity"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-ink-light" />
          <span className="font-ui text-xs text-muted-foreground tracking-wide">
            Tüm projeler
          </span>
        </Link>
        <div className="flex items-center gap-2.5">
          <img
            src="/images/quilpen-icon.png"
            alt="Quilpen"
            className="w-9 h-9 rounded-lg shrink-0"
          />
          <div className="min-w-0 flex-1">
            {seriesName && (
              <p className="font-ui text-[10px] text-gold-dark uppercase tracking-wider mb-0.5 truncate">
                {seriesName}
                {seriesOrder !== null && seriesOrder !== undefined && (
                  <span className="text-muted-foreground"> · Cilt {seriesOrder}</span>
                )}
              </p>
            )}
            <p className="font-display text-sm font-semibold text-ink leading-tight line-clamp-2">
              {projectTitle}
            </p>
            <p className="font-ui text-[10px] text-muted-foreground mt-0.5 capitalize">
              {projectStatus} · %{completionPct}
            </p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col py-2 overflow-y-auto flex-1 min-h-0">
        {navItems.map((item) => {
          const isActive =
            item.href === `/projects/${projectId}`
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const sectionStatus = getSectionStatus(item.statusKey, projectStatus);

          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-2.5 px-5 py-2 font-ui text-sm transition-all duration-200 relative",
                  isActive
                    ? "text-forest font-medium bg-forest/5"
                    : "text-ink-light hover:text-ink hover:bg-sandy-soft/30",
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-forest" />
                )}
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {item.label === "Write" && activeOps > 0 && (
                  <span className="ml-auto flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span className="font-ui text-[10px] text-amber-600">
                      {activeOps}
                    </span>
                  </span>
                )}
                {item.label !== "Write" && sectionStatus === "done" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-forest ml-auto" />
                )}
                {sectionStatus === "active" && item.badge && (
                  <span className="w-1.5 h-1.5 rounded-full bg-forest ml-auto" />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom credit balance */}
      <div className="mt-auto p-4 flex items-center justify-between border-t border-sandy/40">
        <CreditBalance />
      </div>
    </div>
  );
}
