import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ProjectIconRail from "@/components/shared/ProjectIconRail";
import WorkspaceShell from "@/components/shared/WorkspaceShell";

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
    select: {
      id: true,
      title: true,
      status: true,
      projectType: true,
    },
  });

  if (!project) {
    notFound();
  }

  const [totalCount, completedCount] = await Promise.all([
    prisma.subsection.count({
      where: { section: { chapter: { projectId: id } } },
    }),
    prisma.subsection.count({
      where: { section: { chapter: { projectId: id } }, status: "completed" },
    }),
  ]);
  const completionPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Project pages use a single green IconRail (project-specific nav) and
  // no context pane — sidebar duplication is gone. ProjectIconRail
  // shows Dashboard / Roadmap / Sources / Write / Atıflar / Export
  // alongside the standard credit + account + logout footer.
  return (
    <WorkspaceShell
      rail={
        <ProjectIconRail
          projectId={project.id}
          projectTitle={project.title}
          projectStatus={project.status}
          projectType={project.projectType}
          completionPct={completionPct}
        />
      }
      fullHeight
    >
      {children}
    </WorkspaceShell>
  );
}
