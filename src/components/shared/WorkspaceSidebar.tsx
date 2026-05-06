"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Library as LibraryIcon,
  MessageSquare,
  Feather,
  User as UserIcon,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import CreditBalance from "@/components/shared/CreditBalance";
import NotificationBell from "@/components/shared/NotificationBell";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  // exact-match means we only highlight on pathname === href; otherwise we
  // highlight when pathname.startsWith(href) so /library/chat keeps
  // "Library" from also lighting up.
  exact?: boolean;
}

const NAV: NavItem[] = [
  { label: "My Books", href: "/", icon: <BookOpen className="w-4 h-4" />, exact: true },
  { label: "Library", href: "/library", icon: <LibraryIcon className="w-4 h-4" />, exact: true },
  {
    label: "Kütüphane'yle Konuş",
    href: "/library/chat",
    icon: <MessageSquare className="w-4 h-4" />,
  },
  { label: "Writing Twin", href: "/style", icon: <Feather className="w-4 h-4" /> },
  { label: "Account", href: "/account", icon: <UserIcon className="w-4 h-4" /> },
];

export default function WorkspaceSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Brand header */}
      <div className="p-4 border-b border-[#d4c9b5]/40 hidden lg:block">
        <Link
          href="/"
          className="flex items-center gap-2.5 hover:opacity-70 transition-opacity"
        >
          <img
            src="/images/quilpen-icon.png"
            alt="Quilpen"
            className="w-9 h-9 rounded-lg"
          />
          <div>
            <p className="font-display text-sm font-semibold text-ink leading-tight">
              Quilpen
            </p>
            <p className="font-ui text-[10px] text-muted-foreground mt-0.5">
              Workspace
            </p>
          </div>
        </Link>
      </div>

      {/* Nav items */}
      <div className="flex lg:flex-col lg:py-2 overflow-x-auto lg:overflow-y-auto flex-1 min-h-0">
        {NAV.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
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
                    : "text-ink-light hover:text-ink hover:bg-[#e8dfd0]/30",
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-forest hidden lg:block" />
                )}
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Footer: credits + bell + sign out */}
      <div className="hidden lg:flex flex-col mt-auto border-t border-[#d4c9b5]/40">
        <div className="px-4 py-3 flex items-center justify-between">
          <CreditBalance />
          <NotificationBell />
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex items-center gap-2.5 px-5 py-2.5 font-ui text-sm text-ink-light hover:text-ink hover:bg-[#e8dfd0]/30 transition-colors border-t border-[#d4c9b5]/30"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
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

      <nav
        className={cn(
          "fixed inset-y-0 left-0 z-40 lg:w-52 w-56 border-b lg:border-b-0 lg:border-r border-[#d4c9b5]/60 bg-[#F5F0E6]/50 flex lg:flex-col shrink-0 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </nav>
    </>
  );
}
