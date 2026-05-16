"use client";

/**
 * Icon-only left rail (56px). The brand logo sits at the top, primary
 * navigation in the middle, and account utilities at the bottom. The
 * full label for each item appears as a native browser tooltip on hover
 * — once shadcn/Base UI Tooltip lands in Step 3 we'll upgrade these.
 *
 * The rail is one of three columns the WorkspaceShell stitches together
 * (IconRail | ContextPane | main). It sits on `bg-rail` so the seam
 * with the page is a subtle tint shift rather than a heavy border.
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

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  // exact=true means we only highlight on pathname === href. Without it
  // a route like /library/chat would also light up the /library row.
  exact?: boolean;
}

const NAV: NavItem[] = [
  {
    href: "/",
    icon: <BookOpen className="w-5 h-5" />,
    label: "Kitaplarım",
    exact: true,
  },
  {
    href: "/library",
    icon: <LibraryIcon className="w-5 h-5" />,
    label: "Kütüphane",
  },
  {
    href: "/library/literature-search",
    icon: <Sparkles className="w-5 h-5" />,
    label: "Literatür Tara",
  },
  {
    href: "/style",
    icon: <Feather className="w-5 h-5" />,
    label: "Writing Twin",
  },
];

interface CreditState {
  balance: number;
}

function CreditPill() {
  const [state, setState] = useState<CreditState | null>(null);
  // Polling cadence matches the old CreditBalance card so the rail's
  // number stays roughly in sync with whatever the user sees inside
  // /account without spamming the API.
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
      className="h-12 flex flex-col items-center justify-center text-ink-light hover:text-ink hover:bg-page transition-colors gap-0.5"
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
      {/* Brand — clickable home shortcut */}
      <Link
        href="/"
        title="Quilpen"
        className="h-14 flex items-center justify-center hover:bg-page transition-colors"
      >
        <Image
          src="/images/quilpen-icon.png"
          alt="Quilpen"
          width={28}
          height={28}
          className="rounded-md"
        />
      </Link>

      {/* Primary nav */}
      <div className="flex flex-col">
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
              className={cn(
                "h-12 flex items-center justify-center relative transition-colors",
                isActive
                  ? "text-forest"
                  : "text-ink-light hover:text-ink hover:bg-page",
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-forest rounded-r-md" />
              )}
              {item.icon}
            </Link>
          );
        })}
      </div>

      {/* Bottom utilities */}
      <div className="mt-auto flex flex-col border-t border-sandy-soft">
        <div className="h-12 flex items-center justify-center">
          <NotificationBell />
        </div>
        <CreditPill />
        <Link
          href="/account"
          title="Hesabım"
          className={cn(
            "h-12 flex items-center justify-center relative transition-colors",
            pathname.startsWith("/account")
              ? "text-forest"
              : "text-ink-light hover:text-ink hover:bg-page",
          )}
        >
          {pathname.startsWith("/account") && (
            <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-forest rounded-r-md" />
          )}
          <UserIcon className="w-5 h-5" />
        </Link>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Çıkış"
          className="h-12 flex items-center justify-center text-ink-light hover:text-ink hover:bg-page transition-colors"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile toggle — needed because the 56px rail collapses behind
          a slide-in drawer on narrow viewports. */}
      <button
        className="fixed top-3 left-3 z-50 lg:hidden flex h-9 w-9 items-center justify-center rounded-md bg-rail border border-sandy shadow-sm hover:bg-page transition-colors"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Menüyü aç/kapat"
      >
        {mobileOpen ? (
          <X className="h-4 w-4 text-ink" />
        ) : (
          <Menu className="h-4 w-4 text-ink" />
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
          "fixed inset-y-0 left-0 z-40 w-14 bg-rail border-r border-sandy-soft flex flex-col transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {railContent}
      </nav>
    </>
  );
}
