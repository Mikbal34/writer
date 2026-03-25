"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  LayoutDashboard,
  Map,
  Library,
  Eye,
  PenLine,
  Download,
  ChevronLeft,
  Menu,
  X,
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
  projectType = "ACADEMIC",
  completionPct = 0,
}: ProjectSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeOps, setActiveOps] = useState(0);
  const needsSources = projectType === "ACADEMIC";

  // Poll for active operations
  const checkActiveOps = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/active-operations`);
      if (res.ok) {
        const data = await res.json();
        setActiveOps(data.writing?.length ?? 0);
      }
    } catch { /* ignore */ }
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
      statusKey: "onboarding",
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
      label: "Art & Design",
      href: `/projects/${projectId}/preview`,
      icon: <Eye className="w-4 h-4" />,
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
    .filter((item) => needsSources ? item.label !== "Art & Design" : true);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Project header */}
      <div className="p-4 border-b border-[#d4c9b5]/40 hidden lg:block">
        <Link
          href="/"
          className="flex items-center gap-2 mb-1 hover:opacity-70 transition-opacity"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-ink-light" />
          <span className="font-ui text-xs text-muted-foreground tracking-wide">
            All Projects
          </span>
        </Link>
        <div className="mt-3 flex items-center gap-2.5">
          <img src="/images/quilpen-icon.png" alt="Quilpen" className="w-9 h-9 rounded-lg" />
          <div>
            <p className="font-display text-sm font-semibold text-ink leading-tight line-clamp-2">
              {projectTitle}
            </p>
            <p className="font-ui text-[10px] text-muted-foreground mt-0.5 capitalize">
              {projectStatus}
            </p>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <div className="flex lg:flex-col lg:py-2 overflow-x-auto lg:overflow-y-auto flex-1 min-h-0">
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
            >
              <div
                className={cn(
                  "flex items-center gap-2.5 px-5 py-2.5 lg:py-2 font-ui text-sm transition-all duration-200 relative whitespace-nowrap",
                  isActive
                    ? "text-forest font-medium bg-forest/5"
                    : "text-ink-light hover:text-ink hover:bg-[#e8dfd0]/30"
                )}
              >
                {isActive && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[2px] bg-forest hidden lg:block"
                  />
                )}
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {item.label === "Write" && activeOps > 0 && (
                  <span className="ml-auto flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span className="font-ui text-[10px] text-amber-600">{activeOps}</span>
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
      </div>

      {/* Bottom credit balance */}
      <div className="hidden lg:flex mt-auto p-4 items-center justify-between border-t border-[#d4c9b5]/40">
        <CreditBalance />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden flex h-9 w-9 items-center justify-center rounded-md bg-[#FAF7F0] border border-[#d4c9b5] shadow-sm transition-colors hover:bg-[#e8dfd0]/50"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
      >
        {mobileOpen ? (
          <X className="h-4 w-4 text-ink" />
        ) : (
          <Menu className="h-4 w-4 text-ink" />
        )}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — mobile drawer + desktop static */}
      <nav
        className={cn(
          "fixed inset-y-0 left-0 z-40 lg:w-52 w-56 border-b lg:border-b-0 lg:border-r border-[#d4c9b5]/60 bg-[#F5F0E6]/50 flex lg:flex-col shrink-0 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </nav>
    </>
  );
}
