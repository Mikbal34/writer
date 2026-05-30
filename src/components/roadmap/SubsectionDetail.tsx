"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Target, ClipboardList, Library, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import type { SourceMapping, Bibliography } from "@prisma/client";

interface SourceMappingWithBibliography extends SourceMapping {
  bibliography: Bibliography;
}

interface SubsectionDetailProps {
  whatToWrite: string | null;
  keyPoints: string[];
  writingStrategy: string | null;
  sourceMappings: SourceMappingWithBibliography[];
  /** V4 roadmap metadata — gizli advanced bölümde gösterilir. */
  synthesisMode?: string | null;
  sectionGoal?: string | null;
  analysisDepth?: number | null;
}

export default function SubsectionDetail({
  whatToWrite,
  keyPoints,
  writingStrategy,
  sourceMappings,
  synthesisMode,
  sectionGoal,
  analysisDepth,
}: SubsectionDetailProps) {
  const classicalSources = sourceMappings.filter(
    (sm) => sm.sourceType === "classical"
  );
  const modernSources = sourceMappings.filter(
    (sm) => sm.sourceType === "modern"
  );

  const hasAdvanced = Boolean(synthesisMode || sectionGoal || typeof analysisDepth === "number");
  const hasContent =
    whatToWrite || keyPoints.length > 0 || writingStrategy || sourceMappings.length > 0 || hasAdvanced;

  if (!hasContent) {
    return (
      <div className="px-20 py-3 text-xs text-muted-foreground italic">
        No detailed information available for this subsection.
      </div>
    );
  }

  return (
    <div className="px-20 py-3 space-y-3 bg-muted/5 border-t border-border/30">
      {/* What to Write */}
      {whatToWrite && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-ui text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3 w-3" />
            What to Write
          </div>
          <p className="font-body text-sm text-foreground/90">
            {whatToWrite}
          </p>
        </div>
      )}

      {/* Key Points */}
      {keyPoints.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-ui text-xs font-medium text-muted-foreground">
            <Target className="h-3 w-3" />
            Key Points
          </div>
          <ul className="space-y-0.5">
            {keyPoints.map((point, i) => (
              <li key={i} className="font-body text-sm text-foreground/90 flex items-start gap-2">
                <span className="text-muted-foreground mt-1 shrink-0">&#8226;</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Writing Strategy */}
      {writingStrategy && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-ui text-xs font-medium text-muted-foreground">
            <ClipboardList className="h-3 w-3" />
            Writing Strategy
          </div>
          <p className="font-body text-sm text-foreground/90">
            {writingStrategy}
          </p>
        </div>
      )}

      {/* Sources */}
      {sourceMappings.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-ui text-xs font-medium text-muted-foreground">
            <Library className="h-3 w-3" />
            Sources
          </div>
          <Tabs defaultValue={classicalSources.length > 0 ? "classical" : "modern"} className="w-full">
            <TabsList className="h-7 p-0.5">
              {classicalSources.length > 0 && (
                <TabsTrigger value="classical" className="text-xs px-2.5 h-6">
                  Classical ({classicalSources.length})
                </TabsTrigger>
              )}
              {modernSources.length > 0 && (
                <TabsTrigger value="modern" className="text-xs px-2.5 h-6">
                  Modern ({modernSources.length})
                </TabsTrigger>
              )}
            </TabsList>
            {classicalSources.length > 0 && (
              <TabsContent value="classical" className="mt-2 space-y-2">
                {classicalSources.map((sm) => (
                  <SourceCard key={sm.id} mapping={sm} />
                ))}
              </TabsContent>
            )}
            {modernSources.length > 0 && (
              <TabsContent value="modern" className="mt-2 space-y-2">
                {modernSources.map((sm) => (
                  <SourceCard key={sm.id} mapping={sm} />
                ))}
              </TabsContent>
            )}
          </Tabs>
        </div>
      )}

      {/* Advanced Metadata — gizli, sade kullanıcıyı dağıtmaz; güç kullanıcısı açar.
          Roadmap üretiminin akademik niyetini (mode/goal/depth) görünür kılar. */}
      {hasAdvanced && (
        <AdvancedMetadata
          synthesisMode={synthesisMode ?? null}
          sectionGoal={sectionGoal ?? null}
          analysisDepth={typeof analysisDepth === "number" ? analysisDepth : null}
        />
      )}
    </div>
  );
}

function AdvancedMetadata({
  synthesisMode,
  sectionGoal,
  analysisDepth,
}: {
  synthesisMode: string | null;
  sectionGoal: string | null;
  analysisDepth: number | null;
}) {
  const [open, setOpen] = useState(false);

  const modeTooltip: Record<string, string> = {
    SPECIFIC: "Tek-konulu / dar-kapsamlı: tanım, açıklama, kavram kurma.",
    THEMATIC: "Birden çok kaynağı tema üzerinden sentezler.",
    COMPARATIVE: "İki tarafı (X vs Y) karşılaştırır.",
    SYNTHESIS: "Bölüm/tezin sonunda büyük resmi kurar.",
  };
  const goalTooltip: Record<string, string> = {
    DEFINE: "Terim/kavram tanımı, dar metin analizi.",
    CONTEXT: "Tarihsel/entelektüel arka plan.",
    COMPARE: "Karşıt görüşler arasındaki farkı ortaya koyar.",
    SYNTHESIZE: "Kaynakları birleştirir, ortak/farklı noktalar üretir.",
    LITERATURE_GAP: "Literatürdeki eksiği gösterir, tezin müdahalesini konumlar.",
    THESIS_CONCLUSION: "Tezin payoff'u — yük taşıyan iddialar + araştırma agenda'sı.",
  };

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 font-ui text-[11px] text-muted-foreground/80 hover:text-muted-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Settings2 className="h-3 w-3" />
        Advanced Metadata
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {synthesisMode && (
            <Badge
              variant="outline"
              className="text-[10px] font-ui font-normal py-0 h-5 px-1.5"
              title={modeTooltip[synthesisMode] ?? synthesisMode}
            >
              <span className="text-muted-foreground/80 mr-1">mode</span>
              {synthesisMode}
            </Badge>
          )}
          {sectionGoal && (
            <Badge
              variant="outline"
              className="text-[10px] font-ui font-normal py-0 h-5 px-1.5"
              title={goalTooltip[sectionGoal] ?? sectionGoal}
            >
              <span className="text-muted-foreground/80 mr-1">goal</span>
              {sectionGoal}
            </Badge>
          )}
          {analysisDepth !== null && (
            <Badge
              variant="outline"
              className="text-[10px] font-ui font-normal py-0 h-5 px-1.5"
              title="Yorum yoğunluğu: 1-3 betimleyici, 4-6 analitik, 7-10 yorum-ağırlıklı."
            >
              <span className="text-muted-foreground/80 mr-1">depth</span>
              {analysisDepth}/10
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function SourceCard({ mapping }: { mapping: SourceMappingWithBibliography }) {
  const bib = mapping.bibliography;
  const authorDisplay = bib.authorName
    ? `${bib.authorSurname}, ${bib.authorName}`
    : bib.authorSurname;

  return (
    <Card className="border-border/50">
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-body text-sm font-semibold truncate">{authorDisplay}</p>
            <p className="font-body text-xs text-muted-foreground truncate italic">
              {bib.title}
              {bib.year && ` (${bib.year})`}
            </p>
          </div>
          <Badge
            variant={mapping.priority === "primary" ? "default" : "secondary"}
            className="text-[10px] shrink-0"
          >
            {mapping.priority === "primary" ? "primary" : "supporting"}
          </Badge>
        </div>
        {mapping.relevance && (
          <div>
            <span className="text-[10px] uppercase text-muted-foreground font-medium">
              Relevance:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.relevance}</span>
          </div>
        )}
        {mapping.howToUse && (
          <div>
            <span className="text-[10px] uppercase text-muted-foreground font-medium">
              How to Use:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.howToUse}</span>
          </div>
        )}
        {mapping.whereToFind && (
          <div>
            <span className="text-[10px] uppercase text-muted-foreground font-medium">
              Where to Find:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.whereToFind}</span>
          </div>
        )}
        {mapping.extractionGuide && (
          <div>
            <span className="text-[10px] uppercase text-muted-foreground font-medium">
              What to Extract:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.extractionGuide}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
