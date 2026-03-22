import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import WritingWorkspace from "@/components/writing/WritingWorkspace";

interface WritePageProps {
  params: Promise<{ id: string }>;
}

export default async function WritePage({ params }: WritePageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id as string },
    include: {
      chapters: {
        include: {
          sections: {
            include: {
              subsections: {
                select: {
                  id: true,
                  subsectionId: true,
                  title: true,
                  status: true,
                  wordCount: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WritingWorkspace projectId={project.id} projectTitle={project.title} chapters={project.chapters} />
    </div>
  );
}
