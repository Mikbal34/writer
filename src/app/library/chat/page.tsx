import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import LibraryChat from "@/components/library/LibraryChat";
import WorkspaceShell from "@/components/shared/WorkspaceShell";

export const metadata = { title: "Kütüphane Sohbeti — Quilpen" };
export const dynamic = "force-dynamic";

interface PageProps {
  // Next 16 awaits searchParams at the page level, so the type is a
  // Promise we resolve before reading.
  searchParams: Promise<{
    entryId?: string | string[];
    collectionId?: string | string[];
    tagId?: string | string[];
  }>;
}

export default async function LibraryChatPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/library/chat");
  }

  // Read entryId on the server so LibraryChat's first paint already
  // reflects single-book mode. Without this the page hydrated as
  // library-wide (useSearchParams returns undefined on the SSR pass),
  // flashed the "Kütüphanenle konuş" header + generic fallback
  // suggestions, then re-rendered as the book-scoped surface once
  // the client read the URL.
  const params = await searchParams;
  const firstOf = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const initialEntryId = firstOf(params.entryId);

  // Resolve the entry title on the server too. The client otherwise
  // doesn't know the title until allEntries fetch resolves a beat
  // later, so the header briefly rendered as library-wide even
  // though initialEntryId was correct.
  let initialEntryTitle: string | null = null;
  if (initialEntryId) {
    const entry = await prisma.libraryEntry.findFirst({
      where: { id: initialEntryId, userId: session.user.id },
      select: { title: true },
    });
    initialEntryTitle = entry?.title ?? null;
  }

  return (
    <WorkspaceShell fullHeight bareMain>
      <LibraryChat
        initialEntryId={initialEntryId}
        initialEntryTitle={initialEntryTitle}
      />
    </WorkspaceShell>
  );
}
