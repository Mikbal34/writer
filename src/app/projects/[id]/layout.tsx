import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ProjectSidebar from "@/components/shared/ProjectSidebar";
import { FadeUpLarge } from "@/components/shared/Animations";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

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
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="flex-1 flex items-start justify-center p-4 md:p-6 lg:p-8">
        <FadeUpLarge className="w-full max-w-[1400px] relative">
          {/* Book shadow */}
          <div className="absolute -inset-4 bg-[#3C2415]/8 rounded-sm blur-2xl" />

          {/* Book container */}
          <div className="relative bg-[#FAF7F0] rounded-sm shadow-[0_4px_40px_rgba(60,36,21,0.15)] overflow-hidden">
            {/* Top decorative edge */}
            <div className="h-[3px] bg-gradient-to-r from-transparent via-[#C9A84C]/40 to-transparent" />

            <div className="flex flex-col lg:flex-row h-[93vh] overflow-hidden">
              <ProjectSidebar
                projectId={project.id}
                projectTitle={project.title}
                projectStatus={project.status}
                projectType={project.projectType}
                completionPct={completionPct}
              />
              <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
                <div className="md:hidden h-16" />{/* spacer for mobile menu button */}
                {children}
              </main>
            </div>

            {/* Bottom decorative edge */}
            <div className="h-[3px] bg-gradient-to-r from-transparent via-[#C9A84C]/40 to-transparent" />
          </div>
        </FadeUpLarge>
      </div>
    </div>
  );
}
