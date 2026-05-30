"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
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
  Zap,
  User as UserIcon,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  statusKey: string;
}

interface ProjectIconRailProps {
  projectId: string;
  projectTitle: string;
  projectStatus: string;
  projectType?: string;
  completionPct?: number;
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

const NAV_BUTTON =
  "w-[38px] h-[38px] mx-auto rounded-[9px] flex items-center justify-center transition-colors relative";
const ACTIVE = "bg-gold text-white";
const INACTIVE = "bg-transparent text-white/55 hover:text-white hover:bg-white/10";

interface CreditState {
  balance: number;
}

function CreditPill() {
  const [state, setState] = useState<CreditState | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/credits");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setState({ balance: data.balance ?? 0 });
      } catch {
        /* ignore */
      }
    }
    tick();
    const i = setInterval(tick, 30000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);
  if (!state) return null;
  const compact =
    state.balance >= 1000
      ? `${(state.balance / 1000).toFixed(state.balance >= 10000 ? 0 : 1)}k`
      : state.balance.toLocaleString("tr-TR");
  return (
    <Link
      href="/account"
      title={`${state.balance.toLocaleString("tr-TR")} kredi`}
      className="w-[38px] py-1 mx-auto flex flex-col items-center justify-center rounded-[9px] text-white/55 hover:text-white hover:bg-white/10 transition-colors gap-0.5"
    >
      <Zap className="w-4 h-4" />
      <span className="font-ui text-[10px] tabular-nums leading-none">
        {compact}
      </span>
    </Link>
  );
}

export default function ProjectIconRail({
  projectId,
  projectTitle,
  projectStatus,
  projectType = "ACADEMIC",
}: ProjectIconRailProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeOps, setActiveOps] = useState(0);
  const needsSources = projectType === "ACADEMIC";

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
      icon: <LayoutDashboard className="w-[18px] h-[18px]" />,
      statusKey: "roadmap",
    },
    {
      label: "Roadmap",
      href: `/projects/${projectId}/roadmap`,
      icon: <Map className="w-[18px] h-[18px]" />,
      statusKey: "roadmap",
    },
    {
      label: "Sources",
      href: `/projects/${projectId}/sources`,
      icon: <Library className="w-[18px] h-[18px]" />,
      statusKey: "sources",
    },
    {
      label: "Write",
      href: `/projects/${projectId}/write`,
      icon: <PenLine className="w-[18px] h-[18px]" />,
      statusKey: "writing",
    },
    {
      label: "Atıflar",
      href: `/projects/${projectId}/citations`,
      icon: <BookmarkCheck className="w-[18px] h-[18px]" />,
      statusKey: "writing",
    },
    {
      label: "Art",
      href: `/projects/${projectId}/preview`,
      icon: <Eye className="w-[18px] h-[18px]" />,
      statusKey: "writing",
    },
    {
      label: "Design",
      href: `/projects/${projectId}/design`,
      icon: <Paintbrush className="w-[18px] h-[18px]" />,
      statusKey: "writing",
    },
    {
      label: "Export",
      href: `/projects/${projectId}/export`,
      icon: <Download className="w-[18px] h-[18px]" />,
      statusKey: "completed",
    },
  ];

  const navItems = allNavItems
    .filter((item) => needsSources || item.statusKey !== "sources")
    .filter((item) =>
      needsSources ? item.label !== "Art" && item.label !== "Design" : true,
    );

  const railContent = (
    <>
      {/* Back to projects + project monogram. Top of the rail is the
          breadcrumb anchor: ChevronLeft + Q icon. Title surfaces on
          hover as a tooltip — the rail is intentionally label-less. */}
      <Link
        href="/"
        title="Tüm projeler"
        className="h-[44px] flex items-center justify-center hover:opacity-90 transition-opacity mb-1"
        onClick={() => setMobileOpen(false)}
      >
        <ChevronLeft className="w-4 h-4 text-white/70" />
      </Link>
      <Link
        href={`/projects/${projectId}`}
        title={projectTitle}
        className="h-[44px] flex items-center justify-center hover:opacity-90 transition-opacity mb-2"
      >
        <Image
          src="/images/quilpen-icon.png"
          alt={projectTitle}
          width={30}
          height={30}
          className="rounded-md"
        />
      </Link>

      {/* Project nav */}
      <div className="flex flex-col gap-1">
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
              title={item.label}
              onClick={() => setMobileOpen(false)}
              className={cn(NAV_BUTTON, isActive ? ACTIVE : INACTIVE)}
            >
              {item.icon}
              {item.label === "Write" && activeOps > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
              {item.label !== "Write" && sectionStatus === "done" && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-gold" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Bottom utilities */}
      <div className="mt-auto pt-2 flex flex-col items-center gap-1">
        <CreditPill />
        <Link
          href="/account"
          title="Hesabım"
          className={cn(NAV_BUTTON, INACTIVE)}
        >
          <UserIcon className="w-[18px] h-[18px]" />
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Çıkış"
          className={cn(NAV_BUTTON, INACTIVE)}
        >
          <LogOut className="w-[18px] h-[18px]" />
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed top-2.5 left-2.5 z-50 lg:hidden flex h-9 w-9 items-center justify-center rounded-md bg-deep text-white shadow-sm hover:opacity-90 transition-opacity"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Menüyü aç/kapat"
      >
        {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <nav
        className={cn(
          "z-40 w-14 shrink-0 bg-deep rounded-2xl flex flex-col py-3.5 transition-transform duration-200 ease-in-out",
          "fixed inset-y-3.5 left-3.5 lg:static lg:translate-x-0 lg:inset-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-[110%] lg:translate-x-0",
        )}
      >
        {railContent}
      </nav>
    </>
  );
}
