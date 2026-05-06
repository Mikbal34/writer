import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import LibraryChat from "@/components/library/LibraryChat";

export const metadata = { title: "Kütüphane Sohbeti — Quilpen" };
export const dynamic = "force-dynamic";

export default async function LibraryChatPage() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/library/chat");
  }
  return <LibraryChat />;
}
