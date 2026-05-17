import { redirect } from "next/navigation";

/**
 * Legacy /library/[id]/ask URL collapsed into the unified chat surface.
 * The new canonical route is /library/chat?entryId=<id>, which auto-scopes
 * the chat to a single entry and renders a compact BookHero strip on top.
 */
export default async function BookAskRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/library/chat?entryId=${id}`);
}
