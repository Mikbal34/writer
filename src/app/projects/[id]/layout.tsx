import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ProjectSidebar from "@/components/shared/ProjectSidebar";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const project = await prisma.project.findFirst({
    where: {
      id,
      userId: session.user.id as string,
    },
    include: {
      chapters: {
        include: {
          sections: {
            include: {
              subsections: {
                select: { status: true, wordCount: true },
              },
            },
          },
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const allSubsections = project.chapters.flatMap((c) =>
    c.sections.flatMap((s) => s.subsections)
  );
  const completedSubsections = allSubsections.filter(
    (s) => s.status === "completed"
  ).length;
  const completionPct =
    allSubsections.length > 0
      ? Math.round((completedSubsections / allSubsections.length) * 100)
      : 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ProjectSidebar
        projectId={project.id}
        projectTitle={project.title}
        projectStatus={project.status}
        completionPct={completionPct}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="md:hidden h-16" />{/* spacer for mobile menu button */}
        {children}
      </main>
    </div>
  );
}
