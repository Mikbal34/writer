"use client";

/**
 * Floating icon-only left rail (56px). Sits as the first flex child of
 * WorkspaceShell, inside the shell's 14px outer gutter. The brand logo
 * sits at the top, primary navigation in the middle, account utilities
 * at the bottom. Active items are a 38×38 gold square; inactive items
 * are white/55 on the dark forest-deep surface.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Library as LibraryIcon,
  Sparkles,
  Feather,
  User as UserIcon,
  LogOut,
  Menu,
  X,
  Zap,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/shared/NotificationBell";
import NavProcessingBadge from "@/components/shared/NavProcessingBadge";

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  exact?: boolean;
}

const NAV: NavItem[] = [
  {
    href: "/",
    icon: <BookOpen className="w-[18px] h-[18px]" />,
    label: "Kitaplarım",
    exact: true,
  },
  {
    href: "/library",
    icon: <LibraryIcon className="w-[18px] h-[18px]" />,
    label: "Kütüphane",
    // /library/literature-search gets its own nav slot below.
    exact: true,
  },
  {
    href: "/library/literature-search",
    icon: <Sparkles className="w-[18px] h-[18px]" />,
    label: "Literatür Tara",
  },
  {
    href: "/style",
    icon: <Feather className="w-[18px] h-[18px]" />,
    label: "Writing Twin",
  },
];

const NAV_BUTTON =
  "w-[38px] h-[38px] mx-auto rounded-[9px] flex items-center justify-center transition-colors";
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
        /* silent */
      }
    }
    tick();
    const interval = setInterval(tick, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const compact =
    state === null
      ? "—"
      : state.balance >= 1000
        ? `${(state.balance / 1000).toFixed(1)}k`
        : state.balance.toLocaleString("tr-TR");

  return (
    <Link
      href="/account"
      title={
        state === null
          ? "Krediler yükleniyor"
          : `${state.balance.toLocaleString("tr-TR")} kredi`
      }
      className="w-[38px] py-1 mx-auto flex flex-col items-center justify-center rounded-[9px] text-white/55 hover:text-white hover:bg-white/10 transition-colors gap-0.5"
    >
      <Zap className="w-4 h-4" />
      <span className="font-ui text-[10px] tabular-nums leading-none">
        {compact}
      </span>
    </Link>
  );
}

export default function IconRail() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const railContent = (
    <>
      {/* Brand */}
      <Link
        href="/"
        title="Quilpen"
        className="h-[44px] flex items-center justify-center hover:opacity-90 transition-opacity mb-1"
      >
        <Image
          src="/images/quilpen-icon.png"
          alt="Quilpen"
          width={30}
          height={30}
          className="rounded-md"
        />
      </Link>

      {/* Primary nav */}
      <div className="flex flex-col gap-1">
        {NAV.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href ||
              pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              onClick={() => setMobileOpen(false)}
              className={cn(NAV_BUTTON, isActive ? ACTIVE : INACTIVE)}
            >
              {item.icon}
            </Link>
          );
        })}
      </div>

      {/* Bottom utilities */}
      <div className="mt-auto pt-2 flex flex-col items-center gap-1">
        <NavProcessingBadge />
        <div className="flex items-center justify-center [&_button]:px-0 [&_button]:py-1.5 [&_button]:w-[38px] [&_button]:h-[38px] [&_button]:rounded-[9px] [&_button]:justify-center">
          <NotificationBell tone="dark" />
        </div>
        <CreditPill />
        <Link
          href="/account"
          title="Hesabım"
          className={cn(
            NAV_BUTTON,
            pathname.startsWith("/account") ? ACTIVE : INACTIVE,
          )}
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
      {/* Mobile toggle — the 56px rail collapses behind a slide-in
          drawer on narrow viewports. */}
      <button
        className="fixed top-2.5 left-2.5 z-50 lg:hidden flex h-9 w-9 items-center justify-center rounded-md bg-deep text-white shadow-sm hover:opacity-90 transition-opacity"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Menüyü aç/kapat"
      >
        {mobileOpen ? (
          <X className="h-4 w-4" />
        ) : (
          <Menu className="h-4 w-4" />
        )}
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
          // On lg+ the rail is a flex sibling inside WorkspaceShell.
          // On <lg the rail becomes a slide-in fixed drawer.
          "fixed inset-y-3.5 left-3.5 lg:static lg:translate-x-0 lg:inset-auto",
          mobileOpen ? "translate-x-0" : "-translate-x-[110%] lg:translate-x-0",
        )}
      >
        {railContent}
      </nav>
    </>
  );
}
