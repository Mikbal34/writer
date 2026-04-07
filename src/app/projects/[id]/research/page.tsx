"use client";

import { useParams } from "next/navigation";
import ResearchPage from "@/components/research/ResearchPage";

export default function ProjectResearchPage() {
  const params = useParams();
  const projectId = params.id as string;

  return <ResearchPage projectId={projectId} />;
}
