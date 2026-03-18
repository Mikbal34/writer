"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Target, ClipboardList, Library } from "lucide-react";
import type { SourceMapping, Bibliography } from "@prisma/client";

interface SourceMappingWithBibliography extends SourceMapping {
  bibliography: Bibliography;
}

interface SubsectionDetailProps {
  whatToWrite: string | null;
  keyPoints: string[];
  writingStrategy: string | null;
  sourceMappings: SourceMappingWithBibliography[];
}

export default function SubsectionDetail({
  whatToWrite,
  keyPoints,
  writingStrategy,
  sourceMappings,
}: SubsectionDetailProps) {
  const classicalSources = sourceMappings.filter(
    (sm) => sm.sourceType === "classical"
  );
  const modernSources = sourceMappings.filter(
    (sm) => sm.sourceType === "modern"
  );

  const hasContent = whatToWrite || keyPoints.length > 0 || writingStrategy || sourceMappings.length > 0;

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
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BookOpen className="h-3 w-3" />
            Ne Yazilacak
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">
            {whatToWrite}
          </p>
        </div>
      )}

      {/* Key Points */}
      {keyPoints.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Target className="h-3 w-3" />
            Anahtar Noktalar
          </div>
          <ul className="space-y-0.5">
            {keyPoints.map((point, i) => (
              <li key={i} className="text-sm text-foreground/90 flex items-start gap-2">
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
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ClipboardList className="h-3 w-3" />
            Yazim Stratejisi
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">
            {writingStrategy}
          </p>
        </div>
      )}

      {/* Sources */}
      {sourceMappings.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Library className="h-3 w-3" />
            Kaynaklar
          </div>
          <Tabs defaultValue={classicalSources.length > 0 ? "classical" : "modern"} className="w-full">
            <TabsList className="h-7 p-0.5">
              {classicalSources.length > 0 && (
                <TabsTrigger value="classical" className="text-xs px-2.5 h-6">
                  Klasik ({classicalSources.length})
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
            <p className="text-sm font-medium truncate">{authorDisplay}</p>
            <p className="text-xs text-muted-foreground truncate">
              {bib.title}
              {bib.year && ` (${bib.year})`}
            </p>
          </div>
          <Badge
            variant={mapping.priority === "primary" ? "default" : "secondary"}
            className="text-[10px] shrink-0"
          >
            {mapping.priority === "primary" ? "birincil" : "destekleyici"}
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
              Nasil Kullan:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.howToUse}</span>
          </div>
        )}
        {mapping.whereToFind && (
          <div>
            <span className="text-[10px] uppercase text-muted-foreground font-medium">
              Nerede Bul:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.whereToFind}</span>
          </div>
        )}
        {mapping.extractionGuide && (
          <div>
            <span className="text-[10px] uppercase text-muted-foreground font-medium">
              Ne Cikarilacak:{" "}
            </span>
            <span className="text-xs text-foreground/80">{mapping.extractionGuide}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
