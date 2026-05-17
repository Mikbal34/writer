import Link from "next/link";
import { redirect } from "next/navigation";
import {
  User as UserIcon,
  Sparkles,
  Receipt,
  Archive,
  Check,
  Feather,
  MessageSquare,
  Highlighter,
} from "lucide-react";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tierByName, TIERS } from "@/lib/billing/tiers";
import { ensureMonthlyAllowance } from "@/lib/credits";
import WorkspaceShell from "@/components/shared/WorkspaceShell";
import SignOutButton from "@/components/shared/SignOutButton";
import EditNameButton from "@/components/account/EditNameButton";
import ExportDataButton from "@/components/account/ExportDataButton";
import DeleteAccountButton from "@/components/account/DeleteAccountButton";

export const metadata = { title: "Hesap — Quilpen" };
export const dynamic = "force-dynamic";

interface OperationMeta {
  label: string;
  color: string;
  icon:
    | "feather"
    | "sparkles"
    | "chat"
    | "highlighter"
    | "receipt"
    | "archive";
}

const OPERATION_META: Record<string, OperationMeta> = {
  style_interview: { label: "style_interview", color: "#5a7050", icon: "feather" },
  style_analyze: { label: "style_analyze", color: "#b89149", icon: "sparkles" },
  library_chat: { label: "library_chat", color: "#3a5238", icon: "chat" },
  book_chat: { label: "book_chat", color: "#3a5238", icon: "chat" },
  lit_search: { label: "lit_search", color: "#8a6a3d", icon: "sparkles" },
  literature_search: { label: "literature_search", color: "#8a6a3d", icon: "sparkles" },
  highlight_extract: { label: "highlight_extract", color: "#b89149", icon: "highlighter" },
  write_subsection: { label: "write_subsection", color: "#3a5238", icon: "feather" },
  roadmap_generate: { label: "roadmap_generate", color: "#5a7050", icon: "feather" },
  generate_image: { label: "generate_image", color: "#8a6a3d", icon: "sparkles" },
  initial_grant: { label: "Kayıt hediyesi", color: "#3a7050", icon: "archive" },
  subscription_renewal: { label: "Abonelik yenileme", color: "#3a7050", icon: "archive" },
};

function metaFor(op: string | null, type: string): OperationMeta {
  return (
    OPERATION_META[op ?? ""] ??
    OPERATION_META[type] ?? { label: op ?? type, color: "#5c5642", icon: "receipt" }
  );
}

function iconNode(name: OperationMeta["icon"]) {
  const cls = "h-3 w-3 text-white";
  switch (name) {
    case "feather":
      return <Feather className={cls} />;
    case "sparkles":
      return <Sparkles className={cls} />;
    case "chat":
      return <MessageSquare className={cls} />;
    case "highlighter":
      return <Highlighter className={cls} />;
    case "archive":
      return <Archive className={cls} />;
    case "receipt":
    default:
      return <Receipt className={cls} />;
  }
}

function initialOf(name: string | null | undefined, email: string): string {
  const source = (name && name.trim()) || email.split("@")[0] || "Q";
  const m = source.match(/[a-zA-ZçğıöşüâîûÇĞİÖŞÜ]/);
  return (m ? m[0] : source[0] ?? "Q").toUpperCase();
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const diff = date.getTime() - Date.now();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

export default async function AccountPage() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/account");
  }

  await ensureMonthlyAllowance(session.user.id as string);

  const userId = session.user.id as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      name: true,
      creditBalance: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      creditsResetAt: true,
      paddleCustomerId: true,
      createdAt: true,
    },
  });
  if (!user) redirect("/api/auth/signin");

  const tier = tierByName(user.subscriptionTier);
  const isPaid = tier.name !== "free";
  const isCanceled = user.subscriptionStatus === "canceled";
  const allowance = tier.monthlyCredits;
  const used = Math.max(0, allowance - user.creditBalance);
  const remainPct = allowance > 0 ? Math.max(0, Math.min(100, (user.creditBalance / allowance) * 100)) : 0;
  const renewDate = isPaid ? user.currentPeriodEnd : user.creditsResetAt;
  const renewIn = daysUntil(renewDate);

  const recentTx = await prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      amount: true,
      type: true,
      operation: true,
      balance: true,
      createdAt: true,
    },
  });

  // Pull Zotero connection (if any) to surface in the right rail.
  const zotero = await prisma.zoteroConnection
    .findUnique({
      where: { userId },
      select: { lastSyncAt: true },
    })
    .catch(() => null);

  const emailDisplay = user.email ?? "";
  const displayName = user.name?.trim() || emailDisplay.split("@")[0] || "Hesabım";
  const avatarLetter = initialOf(user.name, emailDisplay);
  const joinedLabel = user.createdAt.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const renewLabel = renewDate
    ? renewDate.toLocaleDateString("tr-TR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <WorkspaceShell fullHeight bareMain>
      <div className="flex flex-1 min-h-0 gap-3.5 bg-page">
        {/* === MAIN === */}
        <main className="flex-1 min-w-0 flex flex-col rounded-2xl bg-elevated overflow-hidden">
          {/* Dark forest hero */}
          <section
            className="relative overflow-hidden px-11 pt-8 pb-7 text-gold-soft"
            style={{
              background:
                "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute right-8 top-3.5 select-none"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 150,
                lineHeight: 1,
                color: "var(--color-gold-soft)",
                opacity: 0.14,
              }}
            >
              §
            </div>

            <div className="font-ui inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gold-soft/65 mb-3">
              <UserIcon className="h-3 w-3" />
              Hesap
            </div>

            {/* Avatar + identity + CTA */}
            <div className="flex items-center gap-5 flex-wrap">
              <div
                className="h-16 w-16 rounded-[14px] flex items-center justify-center text-white font-display italic font-semibold text-[32px] shrink-0"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-gold), var(--color-gold-dark))",
                  boxShadow:
                    "0 4px 12px rgba(0,0,0,0.3), inset -3px -3px 0 rgba(0,0,0,0.15)",
                }}
                aria-hidden
              >
                {avatarLetter}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-display italic font-medium text-[28px] leading-tight tracking-tight text-white truncate">
                  {displayName}
                </h1>
                <div className="mt-0.5 font-body text-[13px] text-gold-soft/85 truncate">
                  {emailDisplay}
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-ui text-[11px] font-semibold uppercase tracking-[0.06em] text-gold-soft border"
                    style={{
                      background: "rgba(232,212,154,0.15)",
                      borderColor: "var(--color-gold)",
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    {tier.label} plan
                    {isCanceled && (
                      <span className="ml-1 normal-case font-normal text-gold-soft/65">
                        (iptal)
                      </span>
                    )}
                  </span>
                  <span className="font-ui text-[11.5px] text-gold-soft/55">
                    Üye olunma · {joinedLabel}
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                {!isPaid ? (
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md bg-gold text-white font-ui text-[13.5px] font-semibold hover:bg-gold-hover transition-colors shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Pro&apos;ya yükselt
                  </Link>
                ) : user.paddleCustomerId ? (
                  <Link
                    href="/api/billing/portal"
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md text-gold-soft font-ui text-[13px] font-medium hover:bg-white/10 transition-colors"
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(232,212,154,0.25)",
                    }}
                  >
                    Aboneliği yönet
                  </Link>
                ) : null}
              </div>
            </div>

            {/* Credit dashboard inside the hero */}
            <div
              className="mt-6 rounded-xl px-5 py-4"
              style={{
                background: "rgba(0,0,0,0.18)",
                border: "1px solid rgba(232,212,154,0.15)",
              }}
            >
              <div className="flex items-baseline gap-3.5 mb-2.5 flex-wrap">
                <span className="font-ui text-[10.5px] uppercase tracking-[0.14em] font-semibold text-gold-soft/70">
                  Bu dönem krediler
                </span>
                {renewLabel && (
                  <span className="font-ui text-[11px] text-gold-soft/55">
                    · {renewLabel}&apos;de yenilenecek
                  </span>
                )}
                <span className="flex-1" />
                <span className="font-display font-semibold text-[28px] leading-none text-white tabular-nums">
                  {user.creditBalance.toLocaleString("tr-TR")}
                </span>
                <span className="font-body text-[13px] text-gold-soft/65">
                  / {allowance.toLocaleString("tr-TR")}
                </span>
              </div>

              {/* Progress bar */}
              <div className="relative h-2 rounded-sm overflow-hidden" style={{ background: "rgba(232,212,154,0.15)" }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${remainPct}%`,
                    background:
                      "linear-gradient(90deg, var(--color-gold), var(--color-gold-soft))",
                  }}
                />
                <div
                  className="absolute top-[-3px] bottom-[-3px] w-0.5 rounded-sm bg-white"
                  style={{
                    left: `${remainPct}%`,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.2)",
                  }}
                />
              </div>

              <div className="mt-2.5 flex items-center gap-6 font-ui text-[11.5px] text-gold-soft/85 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-gold)" }} />
                  {user.creditBalance.toLocaleString("tr-TR")} kaldı
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: "rgba(232,212,154,0.3)" }} />
                  {used.toLocaleString("tr-TR")} kullanıldı
                </span>
                <span className="flex-1" />
                {renewIn !== null && (
                  <span>{renewIn} günde yenilenecek</span>
                )}
              </div>
            </div>
          </section>

          {/* === Body === */}
          <div className="flex-1 overflow-y-auto px-9 pt-6 pb-10">
            {/* Plans */}
            <SectionHeading
              title="Daha fazla alan ister misin?"
              subtitle="Kredilerini, PDF baskı ve EPUB ihracını aç."
              icon={<Archive className="h-4 w-4 text-forest" />}
            />
            <div className="grid gap-3.5 mt-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <PlanCard
                name={TIERS.free.label}
                price={TIERS.free.priceUsd.month}
                credits={TIERS.free.monthlyCredits}
                features={[
                  "Sınırsız kütüphane",
                  "AI sohbet & sor",
                  "MD/TXT ihracı",
                ]}
                isCurrent={tier.name === "free"}
              />
              <PlanCard
                name={TIERS.starter.label}
                price={TIERS.starter.priceUsd.month}
                credits={TIERS.starter.monthlyCredits}
                features={[
                  "Free'deki her şey",
                  "BibTeX/Zotero senkron",
                  "PDF print-ready ihraç",
                ]}
                accent="#8a6a3d"
                isCurrent={tier.name === "starter"}
              />
              <PlanCard
                name={TIERS.pro.label}
                price={TIERS.pro.priceUsd.month}
                credits={TIERS.pro.monthlyCredits}
                features={[
                  "Starter'daki her şey",
                  "EPUB & InDesign ihraç",
                  "Writing Twin sınırsız",
                  "Öncelikli destek",
                ]}
                isRecommended={tier.name !== "pro"}
                isCurrent={tier.name === "pro"}
              />
            </div>

            {/* Recent activity */}
            <div className="mt-9">
              <SectionHeading
                title="Son aktivite"
                subtitle="Bu dönemki kredi hareketlerin."
                icon={<Receipt className="h-4 w-4 text-forest" />}
              />
              <div className="mt-4 rounded-xl border border-sandy/60 bg-panel overflow-hidden">
                {/* Header row */}
                <div
                  className="grid items-center gap-3.5 px-4 py-2.5 bg-page border-b border-sandy/60 font-ui text-[10.5px] uppercase tracking-[0.08em] font-semibold text-ink-muted"
                  style={{ gridTemplateColumns: "140px 1fr 100px 100px" }}
                >
                  <span>Tarih</span>
                  <span>İşlem</span>
                  <span className="text-right">Kredi</span>
                  <span className="text-right">Bakiye</span>
                </div>

                {recentTx.length === 0 ? (
                  <p className="px-4 py-6 text-center font-body italic text-sm text-ink-muted">
                    Henüz aktivite yok.
                  </p>
                ) : (
                  recentTx.map((tx, i) => {
                    const meta = metaFor(tx.operation, tx.type);
                    return (
                      <div
                        key={tx.id}
                        className={
                          "grid items-center gap-3.5 px-4 py-3 text-[13px]" +
                          (i < recentTx.length - 1
                            ? " border-b border-sandy/60"
                            : "")
                        }
                        style={{
                          gridTemplateColumns: "140px 1fr 100px 100px",
                        }}
                      >
                        <span className="font-ui text-ink-light tabular-nums">
                          {tx.createdAt.toLocaleDateString("tr-TR", {
                            day: "numeric",
                            month: "short",
                          })}
                          {", "}
                          {tx.createdAt.toLocaleTimeString("tr-TR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-flex items-center justify-center h-5.5 w-5.5 rounded-sm shrink-0"
                            style={{
                              background: meta.color,
                              width: 22,
                              height: 22,
                            }}
                            aria-hidden
                          >
                            {iconNode(meta.icon)}
                          </span>
                          <span className="font-ui font-medium text-ink truncate">
                            {meta.label}
                          </span>
                        </span>
                        <span
                          className={
                            "text-right font-ui font-semibold tabular-nums " +
                            (tx.amount < 0
                              ? "text-[#a64a3a]"
                              : "text-[#3a7050]")
                          }
                        >
                          {tx.amount > 0 ? "+" : ""}
                          {tx.amount.toLocaleString("tr-TR")}
                        </span>
                        <span className="text-right font-ui text-ink-light tabular-nums">
                          {tx.balance.toLocaleString("tr-TR")}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </main>

        {/* === Right rail === */}
        <aside className="w-[290px] shrink-0 rounded-2xl bg-elevated overflow-hidden flex flex-col hidden lg:flex">
          {/* Profile */}
          <div className="px-4 py-4 border-b border-sandy/60">
            <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2.5">
              Profil
            </div>
            <ProfileRow
              label="İsim"
              value={displayName}
              action={<EditNameButton currentName={user.name ?? ""} />}
            />
            <ProfileRow label="E-posta" value={emailDisplay} verified last />
          </div>

          {/* Connected services */}
          <div className="px-4 py-4 border-b border-sandy/60">
            <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2.5">
              Bağlı servisler
            </div>
            <ConnectionRow
              name="Zotero"
              color="#5a4a2a"
              connected={!!zotero}
              status={zotero ? "Bağlı" : "Bağlı değil"}
              detail={
                zotero?.lastSyncAt
                  ? `Son senkron · ${zotero.lastSyncAt.toLocaleDateString(
                      "tr-TR",
                      { day: "numeric", month: "short" },
                    )}`
                  : undefined
              }
              actionHref="/library"
              last
            />
          </div>

          {/* Account actions */}
          <div className="px-4 py-4">
            <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2.5">
              Veri & hesap
            </div>
            <ExportDataButton />
          </div>

          {/* Footer actions */}
          <div className="mt-auto px-4 pt-3 pb-4 border-t border-sandy/60 bg-panel">
            <SignOutButton className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-[rgba(138,58,42,0.25)] text-[#8a3a2a] font-ui text-[12px] font-semibold hover:bg-[rgba(138,58,42,0.08)] transition-colors" />
            <DeleteAccountButton />
          </div>
        </aside>
      </div>
    </WorkspaceShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function SectionHeading({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-display italic font-medium text-[22px] leading-tight tracking-tight text-forest-deep">
          {title}
        </h2>
      </div>
      <div className="mt-1 font-body text-[12.5px] text-ink-light">
        {subtitle}
      </div>
    </div>
  );
}

function PlanCard({
  name,
  price,
  credits,
  features,
  isCurrent,
  isRecommended,
  accent,
}: {
  name: string;
  price: number;
  credits: number;
  features: string[];
  isCurrent?: boolean;
  isRecommended?: boolean;
  accent?: string;
}) {
  const recommended = !!isRecommended && !isCurrent;
  const planAccent = recommended ? "var(--color-gold)" : accent ?? "var(--color-forest)";
  const cardStyle: React.CSSProperties = recommended
    ? {
        background: "var(--color-forest-deep)",
        borderColor: "var(--color-gold)",
        borderWidth: 1.5,
        color: "#fff",
        padding: 18,
      }
    : {
        background: "var(--color-panel)",
        borderColor: "var(--color-sandy)",
        padding: 18,
      };

  return (
    <div
      className="relative flex flex-col rounded-xl border"
      style={cardStyle}
    >
      {recommended && (
        <span
          className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full font-ui text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white"
          style={{ background: "var(--color-gold)" }}
        >
          Önerilen
        </span>
      )}
      {isCurrent && (
        <span
          className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full font-ui text-[9.5px] font-semibold uppercase tracking-[0.1em] text-gold-soft"
          style={{ background: "var(--color-forest-deep)" }}
        >
          Şu anki plan
        </span>
      )}

      <div
        className="font-ui text-[10.5px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: recommended ? "rgba(232,212,154,0.7)" : planAccent }}
      >
        {name}
      </div>

      <div className="flex items-baseline gap-1 mt-1">
        <span
          className="font-ui text-[11px] font-semibold"
          style={{ color: recommended ? "rgba(232,212,154,0.6)" : "var(--color-ink-muted)" }}
        >
          $
        </span>
        <span
          className="font-display font-medium text-[38px] leading-none tracking-tight"
          style={{ color: recommended ? "#fff" : "var(--color-ink)" }}
        >
          {price}
        </span>
        <span
          className="font-body text-[12px]"
          style={{ color: recommended ? "rgba(232,212,154,0.65)" : "var(--color-ink-muted)" }}
        >
          /ay
        </span>
      </div>

      <div
        className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-body text-[12px]"
        style={{
          background: recommended ? "rgba(232,212,154,0.10)" : "var(--color-elevated)",
          color: recommended ? "var(--color-gold-soft)" : "var(--color-ink-light)",
        }}
      >
        <Sparkles
          className="h-3 w-3"
          style={{ color: recommended ? "var(--color-gold-soft)" : "var(--color-gold)" }}
        />
        <span
          className="font-display font-semibold"
          style={{ color: recommended ? "#fff" : "var(--color-ink)" }}
        >
          {credits.toLocaleString("tr-TR")}
        </span>
        kredi / ay
      </div>

      <ul className="mt-3.5 flex flex-col gap-2 font-body text-[12.5px] leading-snug">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span
              className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-sm shrink-0 mt-0.5"
              style={{
                background: recommended ? "var(--color-gold)" : "rgba(58,82,56,0.15)",
              }}
            >
              <Check
                className="h-2.5 w-2.5"
                style={{ color: recommended ? "#fff" : "var(--color-forest)", strokeWidth: 3 }}
              />
            </span>
            <span
              style={{
                color: recommended
                  ? "rgba(255,255,255,0.85)"
                  : "var(--color-ink-light)",
              }}
            >
              {f}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4">
        {isCurrent ? (
          <button
            type="button"
            disabled
            className="w-full inline-flex items-center justify-center px-3 py-2 rounded-md border border-sandy bg-transparent font-ui text-[12px] text-ink-muted cursor-default"
          >
            Aktif
          </button>
        ) : (
          <Link
            href="/pricing"
            className={
              recommended
                ? "w-full inline-flex items-center justify-center px-3 py-2 rounded-md bg-gold text-white font-ui text-[12px] font-semibold hover:bg-gold-hover transition-colors"
                : "w-full inline-flex items-center justify-center px-3 py-2 rounded-md border border-sandy bg-elevated text-ink font-ui text-[12px] font-semibold hover:bg-panel transition-colors"
            }
          >
            {name}&apos;a yükselt
          </Link>
        )}
      </div>
    </div>
  );
}

function ProfileRow({
  label,
  value,
  action,
  verified,
  last,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
  verified?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-2 py-1.5" +
        (last ? "" : " border-b border-sandy/60")
      }
    >
      <span className="font-ui text-[11.5px] text-ink-muted">{label}</span>
      <span className="inline-flex items-center gap-1.5 min-w-0 max-w-[60%]">
        <span className="font-ui text-[12.5px] text-ink truncate">{value}</span>
        {verified && (
          <span
            className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-[#3a7050] shrink-0"
            title="Onaylı"
            aria-label="Onaylı"
          >
            <Check className="h-2 w-2 text-white" strokeWidth={3} />
          </span>
        )}
        {action}
      </span>
    </div>
  );
}

function ConnectionRow({
  name,
  color,
  status,
  detail,
  connected,
  actionHref,
  last,
}: {
  name: string;
  color: string;
  status: string;
  detail?: string;
  connected?: boolean;
  actionHref?: string;
  last?: boolean;
}) {
  const action = connected ? "Yönet" : "Bağla";
  return (
    <div
      className={
        "flex items-center gap-2.5 py-2" +
        (last ? "" : " border-b border-sandy/60")
      }
    >
      <div
        className="h-7 w-7 rounded-md flex items-center justify-center font-display italic font-semibold text-white text-sm shrink-0"
        style={{ background: color }}
        aria-hidden
      >
        {name[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-ui text-[12.5px] text-ink font-medium truncate">
          {name}
        </div>
        <div
          className={
            "font-ui text-[10.5px] inline-flex items-center gap-1 truncate " +
            (connected ? "text-[#3a7050]" : "text-ink-muted")
          }
        >
          {connected && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#3a7050]" />
          )}
          {status}
          {detail && (
            <span className="text-ink-muted truncate"> · {detail}</span>
          )}
        </div>
      </div>
      {actionHref ? (
        <Link
          href={actionHref}
          className="inline-flex items-center px-2 py-1 rounded-sm text-ink-light hover:bg-panel hover:text-ink font-ui text-[11px] transition-colors"
        >
          {action}
        </Link>
      ) : (
        <button
          type="button"
          className="inline-flex items-center px-2 py-1 rounded-sm text-ink-light hover:bg-panel hover:text-ink font-ui text-[11px] transition-colors"
        >
          {action}
        </button>
      )}
    </div>
  );
}

