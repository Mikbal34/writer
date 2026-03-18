"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, BookOpen, Quote, Palette, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import BookBasicsForm, {
 type BookBasicsData,
} from "@/components/onboarding/BookBasicsForm";
import CitationSelector, {
 type CitationFormat,
} from "@/components/onboarding/CitationSelector";
import StyleLearning from "@/components/onboarding/StyleLearning";
import type { StyleProfile } from "@/types/project";

// ==================== STEP CONFIG ====================

interface Step {
 id: number;
 label: string;
 icon: React.ReactNode;
 description: string;
}

const STEPS: Step[] = [
 {
  id: 1,
  label: "Book Basics",
  icon: <BookOpen className="h-4 w-4" />,
  description: "Title, topic, audience, and language",
 },
 {
  id: 2,
  label: "Citation Format",
  icon: <Quote className="h-4 w-4" />,
  description: "How your references will be formatted",
 },
 {
  id: 3,
  label: "Writing Style",
  icon: <Palette className="h-4 w-4" />,
  description: "Teach the AI your voice",
 },
 {
  id: 4,
  label: "Review",
  icon: <Eye className="h-4 w-4" />,
  description: "Confirm and create your project",
 },
];

// ==================== INITIAL STATE ====================

const INITIAL_BASICS: BookBasicsData = {
 title: "",
 topic: "",
 purpose: "",
 audience: "",
 language: "tr",
};

const LANGUAGE_LABELS: Record<string, string> = {
 tr: "Turkish",
 en: "English",
 ar: "Arabic",
 de: "German",
 fr: "French",
};

// ==================== COMPONENT ====================

export default function NewProjectPage() {
 const router = useRouter();
 const [currentStep, setCurrentStep] = useState(1);
 const [basics, setBasics] = useState<BookBasicsData>(INITIAL_BASICS);
 const [citationFormat, setCitationFormat] = useState<CitationFormat>("ISNAD");
 const [styleProfile, setStyleProfile] = useState<Partial<StyleProfile> | null>(null);
 const [isCreating, setIsCreating] = useState(false);

 function canProceed(): boolean {
  if (currentStep === 1) {
   return !!(
    basics.title.trim() &&
    basics.topic.trim() &&
    basics.purpose.trim() &&
    basics.audience.trim()
   );
  }
  return true;
 }

 function handleNext() {
  if (!canProceed()) {
   toast.error("Please fill in all required fields.");
   return;
  }
  setCurrentStep((s) => Math.min(s + 1, STEPS.length));
 }

 function handleBack() {
  setCurrentStep((s) => Math.max(s - 1, 1));
 }

 async function handleCreate() {
  if (!basics.title.trim()) {
   toast.error("Book title is required.");
   return;
  }

  setIsCreating(true);
  try {
   const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     title: basics.title,
     topic: basics.topic,
     purpose: basics.purpose,
     audience: basics.audience,
     language: basics.language,
     citationFormat,
     styleProfile: styleProfile ?? undefined,
    }),
   });

   if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create project" }));
    throw new Error(err.error ?? "Failed to create project");
   }

   const project = await res.json();
   toast.success("Project created! Let's build your roadmap.");
   router.push(`/projects/${project.id}/roadmap`);
  } catch (err) {
   toast.error(err instanceof Error ? err.message : "Failed to create project");
  } finally {
   setIsCreating(false);
  }
 }

 return (
  <div className="min-h-screen bg-background">
   <div className="max-w-3xl mx-auto px-6 py-10">
    {/* Header */}
    <div className="mb-8">
     <h1 className="text-2xl font-bold tracking-tight">New Book Project</h1>
     <p className="text-muted-foreground mt-1 text-sm">
      Set up your book in a few steps. You can update everything later.
     </p>
    </div>

    {/* Stepper */}
    <div className="mb-8">
     <div className="flex items-start gap-0">
      {STEPS.map((step, idx) => {
       const isCompleted = currentStep > step.id;
       const isActive = currentStep === step.id;
       const isLast = idx === STEPS.length - 1;

       return (
        <div key={step.id} className="flex items-start flex-1">
         <div className="flex flex-col items-center">
          <button
           type="button"
           onClick={() => {
            if (step.id < currentStep) setCurrentStep(step.id);
           }}
           disabled={step.id > currentStep}
           className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-medium transition-all",
            isCompleted
             ? "border-primary bg-primary text-primary-foreground cursor-pointer "
             : isActive
             ? "border-primary bg-background text-primary"
             : "border-border bg-background text-muted-foreground cursor-not-allowed"
           )}
           aria-label={`Step ${step.id}: ${step.label}`}
          >
           {isCompleted ? <Check className="h-4 w-4" /> : step.id}
          </button>
          <div className="mt-2 text-center hidden sm:block">
           <p
            className={cn(
             "text-xs font-medium",
             isActive ? "text-foreground" : "text-muted-foreground"
            )}
           >
            {step.label}
           </p>
          </div>
         </div>
         {!isLast && (
          <div
           className={cn(
            "flex-1 h-0.5 mt-4 mx-2 transition-colors",
            isCompleted ? "bg-primary" : "bg-border"
           )}
          />
         )}
        </div>
       );
      })}
     </div>
    </div>

    {/* Step content */}
    <Card>
     <CardContent className="pt-6">
      <div className="mb-6">
       <h2 className="text-lg font-semibold">{STEPS[currentStep - 1].label}</h2>
       <p className="text-sm text-muted-foreground mt-0.5">
        {STEPS[currentStep - 1].description}
       </p>
      </div>

      <Separator className="mb-6" />

      {currentStep === 1 && (
       <BookBasicsForm data={basics} onChange={setBasics} />
      )}

      {currentStep === 2 && (
       <CitationSelector
        selected={citationFormat}
        onChange={setCitationFormat}
       />
      )}

      {currentStep === 3 && (
       <StyleLearning
        onStyleExtracted={(profile) =>
         setStyleProfile((prev) => ({ ...prev, ...profile }))
        }
        extractedProfile={styleProfile}
       />
      )}

      {currentStep === 4 && (
       <ReviewStep
        basics={basics}
        citationFormat={citationFormat}
        styleProfile={styleProfile}
       />
      )}
     </CardContent>
    </Card>

    {/* Navigation buttons */}
    <div className="flex items-center justify-between mt-6">
     <Button
      variant="outline"
      onClick={handleBack}
      disabled={currentStep === 1}
     >
      Back
     </Button>

     <div className="flex items-center gap-2">
      {currentStep === 3 && (
       <Button
        variant="ghost"
        onClick={handleNext}
        className="text-muted-foreground"
       >
        Skip for now
       </Button>
      )}
      {currentStep < STEPS.length ? (
       <Button
        onClick={handleNext}
        disabled={!canProceed()}
        className="bg-primary text-primary-foreground"
       >
        Continue
       </Button>
      ) : (
       <Button
        onClick={handleCreate}
        disabled={isCreating}
        className="bg-primary text-primary-foreground gap-2"
       >
        {isCreating ? (
         <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
         <BookOpen className="h-4 w-4" />
        )}
        {isCreating ? "Creating..." : "Create Project"}
       </Button>
      )}
     </div>
    </div>
   </div>
  </div>
 );
}

// ==================== REVIEW STEP ====================

function ReviewStep({
 basics,
 citationFormat,
 styleProfile,
}: {
 basics: BookBasicsData;
 citationFormat: CitationFormat;
 styleProfile: Partial<StyleProfile> | null;
}) {
 const languageMap: Record<string, string> = {
  tr: "Turkish",
  en: "English",
  ar: "Arabic",
  de: "German",
  fr: "French",
 };

 return (
  <div className="space-y-5">
   <ReviewSection title="Book Basics">
    <ReviewRow label="Title" value={basics.title} />
    <ReviewRow label="Topic" value={basics.topic} />
    <ReviewRow label="Purpose" value={basics.purpose} />
    <ReviewRow label="Audience" value={basics.audience} />
    <ReviewRow
     label="Language"
     value={languageMap[basics.language] ?? basics.language}
    />
   </ReviewSection>

   <ReviewSection title="Citation Format">
    <ReviewRow label="Format" value={citationFormat} />
   </ReviewSection>

   <ReviewSection title="Writing Style">
    {styleProfile && Object.keys(styleProfile).length > 0 ? (
     <>
      {styleProfile.tone && (
       <ReviewRow label="Tone" value={styleProfile.tone} />
      )}
      {styleProfile.sentenceLength && (
       <ReviewRow
        label="Sentence length"
        value={styleProfile.sentenceLength}
       />
      )}
      {styleProfile.formality !== undefined && (
       <ReviewRow
        label="Formality"
        value={`${styleProfile.formality}/10`}
       />
      )}
      {styleProfile.rhetoricalApproach && (
       <ReviewRow
        label="Rhetorical approach"
        value={styleProfile.rhetoricalApproach}
       />
      )}
     </>
    ) : (
     <p className="text-sm text-muted-foreground italic">
      No style profile set — you can add one later in project settings.
     </p>
    )}
   </ReviewSection>
  </div>
 );
}

function ReviewSection({
 title,
 children,
}: {
 title: string;
 children: React.ReactNode;
}) {
 return (
  <div className="rounded-lg border border-border p-4 space-y-2">
   <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
    {title}
   </h3>
   {children}
  </div>
 );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
 return (
  <div className="flex gap-3">
   <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
   <span className="text-sm font-medium flex-1 capitalize">{value}</span>
  </div>
 );
}
