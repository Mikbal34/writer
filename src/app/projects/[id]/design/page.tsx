"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useParams } from "next/navigation";
import {
  Send,
  Loader2,
  User,
  Plus,
  History,
  MessageSquare,
  Type,
  Layout,
  Palette,
  Image as ImageIcon,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StaggerItem } from "@/components/shared/Animations";
import type { CitationFormat } from "@prisma/client";
import {
  FORMAT_LAYOUT_DEFAULTS,
  type FormatDefaults,
} from "@/lib/citations/format-defaults";
import { CITATION_FORMAT_META } from "@/lib/citations/metadata";
import BookStylePanel from "@/components/preview/BookStylePanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BookDesign {
  bodyFont: string;
  bodyFontSize: number;
  headingFont: string;
  headingFontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  firstLineIndent: number;
  textAlign: string;
  pageSize: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  chapterTitleSize: number;
  chapterTitleAlign: string;
  chapterTitleStyle: string;
  sectionTitleSize: number;
  subsectionTitleSize: number;
  imageLayout: string;
  imageWidthPercent: number;
  imagePosition: string;
  textColor: string;
  headingColor: string;
  accentColor: string;
  showPageNumbers: boolean;
  pageNumberPosition: string;
  showChapterDivider: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatSession {
  id: string;
  preview: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Default design
// ---------------------------------------------------------------------------
const DEFAULT_DESIGN: BookDesign = {
  bodyFont: "main",
  bodyFontSize: 12,
  headingFont: "main-bold",
  headingFontSize: 18,
  lineHeight: 1.5,
  paragraphSpacing: 6,
  firstLineIndent: 0,
  textAlign: "left",
  pageSize: "A4",
  marginTop: 72,
  marginBottom: 72,
  marginLeft: 72,
  marginRight: 72,
  chapterTitleSize: 24,
  chapterTitleAlign: "left",
  chapterTitleStyle: "bold",
  sectionTitleSize: 16,
  subsectionTitleSize: 13,
  imageLayout: "float_right",
  imageWidthPercent: 50,
  imagePosition: "after",
  textColor: "#1a1a1a",
  headingColor: "#1a1a1a",
  accentColor: "#C9A84C",
  showPageNumbers: true,
  pageNumberPosition: "bottom-center",
  showChapterDivider: false,
};

// ---------------------------------------------------------------------------
// Helper: save design to API
// ---------------------------------------------------------------------------
async function saveDesign(projectId: string, design: BookDesign): Promise<void> {
  await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookDesign: design }),
  });
}

/**
 * Merge citation-format layout defaults into an existing BookDesign. Fields
 * the format spec doesn't govern (fonts, colors, image layout, etc.) are
 * preserved from the user's current design. `description` is a UI-only
 * field — not stored on the project.
 */
function mergeFormatDefaults(current: BookDesign, defaults: FormatDefaults): BookDesign {
  const { description: _description, ...layout } = defaults;
  void _description;
  return { ...current, ...layout };
}

// ---------------------------------------------------------------------------
// Sub-components: form sections
// ---------------------------------------------------------------------------

function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block font-ui text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
      {children}
    </label>
  );
}

function FormRow({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div className={`grid gap-3 ${cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-3" : "grid-cols-1"}`}>
      {children}
    </div>
  );
}

function FormSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 pb-1 border-b border-[#d4c9b5]/40">
        <Icon className="h-3.5 w-3.5 text-[#C9A84C]" />
        <span className="font-ui text-xs font-medium text-foreground/80">{title}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min = 1,
  max = 200,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-8 px-2 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 px-2 rounded-md border border-input bg-background font-body text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 rounded cursor-pointer border border-input p-0.5 bg-background"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={7}
        className="flex-1 h-7 px-2 rounded-md border border-input bg-background font-body text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Design Controls Panel
// ---------------------------------------------------------------------------
function DesignControls({
  design,
  onChange,
}: {
  design: BookDesign;
  onChange: (patch: Partial<BookDesign>) => void;
}) {
  const fontOptions = [
    { value: "main", label: "Serif (default)" },
    { value: "main-bold", label: "Serif Bold" },
    { value: "main-italic", label: "Serif Italic" },
    { value: "Helvetica", label: "Helvetica" },
    { value: "Helvetica-Bold", label: "Helvetica Bold" },
    { value: "Courier", label: "Courier" },
  ];

  const alignOptions = [
    { value: "left", label: "Left" },
    { value: "justify", label: "Justify" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
  ];

  const pageSizeOptions = [
    { value: "A4", label: "A4 (210×297mm)" },
    { value: "A5", label: "A5 (148×210mm)" },
    { value: "16x24cm", label: "16×24cm (YÖK tez)" },
    { value: "17x24cm", label: "17×24cm (YÖK tez)" },
    { value: "5x8", label: "5×8 inch (novel)" },
    { value: "5.5x8.5", label: "5.5×8.5 inch (trade)" },
    { value: "6x9", label: "6×9 inch (trade)" },
    { value: "letter", label: "US Letter (8.5×11)" },
  ];

  const imageLayoutOptions = [
    { value: "float_right", label: "Float right" },
    { value: "float_left", label: "Float left" },
    { value: "inline_right", label: "Inline right" },
    { value: "inline_left", label: "Inline left" },
    { value: "center", label: "Centered" },
    { value: "half_page", label: "Half page" },
    { value: "full_page", label: "Full page" },
  ];

  const titleStyleOptions = [
    { value: "bold", label: "Bold" },
    { value: "italic", label: "Italic" },
    { value: "normal", label: "Normal" },
    { value: "bold-italic", label: "Bold Italic" },
  ];

  const pageNumOptions = [
    { value: "bottom-center", label: "Bottom center" },
    { value: "bottom-outside", label: "Bottom outside" },
    { value: "bottom-inside", label: "Bottom inside" },
    { value: "top-center", label: "Top center" },
  ];

  return (
    <div className="space-y-5">
      {/* Typography */}
      <FormSection title="Typography" icon={Type}>
        <FormRow cols={2}>
          <div>
            <FormLabel>Body Font</FormLabel>
            <SelectInput
              value={design.bodyFont}
              onChange={(v) => onChange({ bodyFont: v })}
              options={fontOptions}
            />
          </div>
          <div>
            <FormLabel>Body Size (pt)</FormLabel>
            <NumberInput
              value={design.bodyFontSize}
              onChange={(v) => onChange({ bodyFontSize: v })}
              min={8}
              max={24}
            />
          </div>
        </FormRow>
        <FormRow cols={2}>
          <div>
            <FormLabel>Heading Font</FormLabel>
            <SelectInput
              value={design.headingFont}
              onChange={(v) => onChange({ headingFont: v })}
              options={fontOptions}
            />
          </div>
          <div>
            <FormLabel>Heading Size (pt)</FormLabel>
            <NumberInput
              value={design.headingFontSize}
              onChange={(v) => onChange({ headingFontSize: v })}
              min={10}
              max={48}
            />
          </div>
        </FormRow>
        <FormRow cols={3}>
          <div>
            <FormLabel>Line Height</FormLabel>
            <NumberInput
              value={design.lineHeight}
              onChange={(v) => onChange({ lineHeight: v })}
              min={1}
              max={3}
              step={0.1}
            />
          </div>
          <div>
            <FormLabel>Para Spacing</FormLabel>
            <NumberInput
              value={design.paragraphSpacing}
              onChange={(v) => onChange({ paragraphSpacing: v })}
              min={0}
              max={30}
            />
          </div>
          <div>
            <FormLabel>Indent (pt)</FormLabel>
            <NumberInput
              value={design.firstLineIndent}
              onChange={(v) => onChange({ firstLineIndent: v })}
              min={0}
              max={72}
            />
          </div>
        </FormRow>
        <div>
          <FormLabel>Text Alignment</FormLabel>
          <SelectInput
            value={design.textAlign}
            onChange={(v) => onChange({ textAlign: v })}
            options={alignOptions}
          />
        </div>
      </FormSection>

      {/* Page */}
      <FormSection title="Page Layout" icon={Layout}>
        <FormRow cols={2}>
          <div>
            <FormLabel>Page Size</FormLabel>
            <SelectInput
              value={design.pageSize}
              onChange={(v) => onChange({ pageSize: v })}
              options={pageSizeOptions}
            />
          </div>
        </FormRow>
        <FormRow cols={2}>
          <div>
            <FormLabel>Top Margin (pt)</FormLabel>
            <NumberInput value={design.marginTop} onChange={(v) => onChange({ marginTop: v })} min={18} max={144} />
          </div>
          <div>
            <FormLabel>Bottom Margin (pt)</FormLabel>
            <NumberInput value={design.marginBottom} onChange={(v) => onChange({ marginBottom: v })} min={18} max={144} />
          </div>
        </FormRow>
        <FormRow cols={2}>
          <div>
            <FormLabel>Left Margin (pt)</FormLabel>
            <NumberInput value={design.marginLeft} onChange={(v) => onChange({ marginLeft: v })} min={18} max={144} />
          </div>
          <div>
            <FormLabel>Right Margin (pt)</FormLabel>
            <NumberInput value={design.marginRight} onChange={(v) => onChange({ marginRight: v })} min={18} max={144} />
          </div>
        </FormRow>
      </FormSection>

      {/* Headings */}
      <FormSection title="Chapter & Section Titles" icon={Settings2}>
        <FormRow cols={3}>
          <div>
            <FormLabel>Chapter Title (pt)</FormLabel>
            <NumberInput value={design.chapterTitleSize} onChange={(v) => onChange({ chapterTitleSize: v })} min={14} max={60} />
          </div>
          <div>
            <FormLabel>Section Title (pt)</FormLabel>
            <NumberInput value={design.sectionTitleSize} onChange={(v) => onChange({ sectionTitleSize: v })} min={10} max={36} />
          </div>
          <div>
            <FormLabel>Subsection (pt)</FormLabel>
            <NumberInput value={design.subsectionTitleSize} onChange={(v) => onChange({ subsectionTitleSize: v })} min={10} max={30} />
          </div>
        </FormRow>
        <FormRow cols={2}>
          <div>
            <FormLabel>Chapter Alignment</FormLabel>
            <SelectInput
              value={design.chapterTitleAlign}
              onChange={(v) => onChange({ chapterTitleAlign: v })}
              options={alignOptions}
            />
          </div>
          <div>
            <FormLabel>Chapter Style</FormLabel>
            <SelectInput
              value={design.chapterTitleStyle}
              onChange={(v) => onChange({ chapterTitleStyle: v })}
              options={titleStyleOptions}
            />
          </div>
        </FormRow>
      </FormSection>

      {/* Images */}
      <FormSection title="Images" icon={ImageIcon}>
        <FormRow cols={2}>
          <div>
            <FormLabel>Default Layout</FormLabel>
            <SelectInput
              value={design.imageLayout}
              onChange={(v) => onChange({ imageLayout: v })}
              options={imageLayoutOptions}
            />
          </div>
          <div>
            <FormLabel>Width %</FormLabel>
            <NumberInput
              value={design.imageWidthPercent}
              onChange={(v) => onChange({ imageWidthPercent: v })}
              min={10}
              max={100}
            />
          </div>
        </FormRow>
        <div>
          <FormLabel>Default Position</FormLabel>
          <SelectInput
            value={design.imagePosition}
            onChange={(v) => onChange({ imagePosition: v })}
            options={[
              { value: "before", label: "Before text" },
              { value: "after", label: "After text" },
            ]}
          />
        </div>
      </FormSection>

      {/* Colors */}
      <FormSection title="Colors" icon={Palette}>
        <FormRow cols={1}>
          <div>
            <FormLabel>Text Color</FormLabel>
            <ColorInput value={design.textColor} onChange={(v) => onChange({ textColor: v })} />
          </div>
        </FormRow>
        <FormRow cols={1}>
          <div>
            <FormLabel>Heading Color</FormLabel>
            <ColorInput value={design.headingColor} onChange={(v) => onChange({ headingColor: v })} />
          </div>
        </FormRow>
        <FormRow cols={1}>
          <div>
            <FormLabel>Accent Color</FormLabel>
            <ColorInput value={design.accentColor} onChange={(v) => onChange({ accentColor: v })} />
          </div>
        </FormRow>
      </FormSection>

      {/* Extras */}
      <FormSection title="Extras" icon={Settings2}>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={design.showPageNumbers}
              onChange={(e) => onChange({ showPageNumbers: e.target.checked })}
              className="rounded"
            />
            <span className="font-body text-sm">Show page numbers</span>
          </label>
        </div>
        {design.showPageNumbers && (
          <div>
            <FormLabel>Page Number Position</FormLabel>
            <SelectInput
              value={design.pageNumberPosition}
              onChange={(v) => onChange({ pageNumberPosition: v })}
              options={pageNumOptions}
            />
          </div>
        )}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={design.showChapterDivider}
              onChange={(e) => onChange({ showChapterDivider: e.target.checked })}
              className="rounded"
            />
            <span className="font-body text-sm">Show chapter divider line</span>
          </label>
        </div>
      </FormSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Preview — two-page spread (verso + recto) with a gutter between
// them. Readers spend 95% of their time on spreads, so the preview
// matches what a finished book actually looks like when open.
// ---------------------------------------------------------------------------
const PAGE_ASPECTS: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  "16x24cm": { w: 160, h: 240 },
  "17x24cm": { w: 170, h: 240 },
  "5x8": { w: 127, h: 203 },
  "5.5x8.5": { w: 140, h: 216 },
  "6x9": { w: 152, h: 229 },
  letter: { w: 216, h: 279 },
};

const PAGE_SIZE_PT_WIDTH: Record<string, number> = {
  A4: 595,
  A5: 420,
  B5: 499,
  "16x24cm": 454,
  "17x24cm": 482,
  "6x9": 432,
  "5x8": 360,
  "5.5x8.5": 396,
  letter: 612,
};

function LivePreview({ design }: { design: BookDesign }) {
  const dims = PAGE_ASPECTS[design.pageSize] ?? PAGE_ASPECTS.A4;
  // Each page in the spread is 110px wide so the whole spread fits the
  // same ~220px slot as the old single-page preview.
  const pageW = 110;
  const previewScale = pageW / dims.w;
  const previewH = dims.h * previewScale;
  const pageWidthPt = PAGE_SIZE_PT_WIDTH[design.pageSize] ?? 595;
  const ptToPx = (pt: number) => (pt / pageWidthPt) * pageW;

  const chapterTitleWeight =
    design.chapterTitleStyle === "bold" || design.chapterTitleStyle === "bold-italic" ? "bold" : "normal";
  const chapterTitleFontStyle =
    design.chapterTitleStyle === "italic" || design.chapterTitleStyle === "bold-italic" ? "italic" : "normal";

  // One page rendered with the current design. `side` controls asymmetric
  // details: verso shows body-only (page 2), recto shows a chapter opener
  // (page 3). Page number placement flips for "bottom-outside".
  function SpreadPage({ side }: { side: "verso" | "recto" }) {
    const isVerso = side === "verso";
    const isRecto = side === "recto";
    const pageNumber = isVerso ? 2 : 3;

    // Page-number horizontal placement — outside = spine-opposite edge.
    const pageNumLeftSide =
      design.pageNumberPosition === "bottom-outside"
        ? (isVerso ? "left" : "right")
        : "center";

    return (
      <div
        className="relative bg-white shadow-md overflow-hidden"
        style={{
          width: pageW,
          height: Math.round(previewH),
          borderRadius: isVerso ? "2px 0 0 2px" : "0 2px 2px 0",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: ptToPx(design.marginTop),
            bottom: ptToPx(design.marginBottom),
            left: ptToPx(design.marginLeft),
            right: ptToPx(design.marginRight),
            overflow: "hidden",
          }}
        >
          {/* Recto (right-hand page) gets the chapter opener. */}
          {isRecto && (
            <>
              <div
                style={{
                  fontSize: ptToPx(design.chapterTitleSize) * 0.75,
                  fontWeight: chapterTitleWeight,
                  fontStyle: chapterTitleFontStyle,
                  color: design.headingColor,
                  textAlign: design.chapterTitleAlign as React.CSSProperties["textAlign"],
                  marginBottom: ptToPx(6),
                  lineHeight: 1.2,
                }}
              >
                Chapter 1
              </div>
              <div
                style={{
                  fontSize: ptToPx(design.sectionTitleSize) * 0.85,
                  fontWeight: 600,
                  color: design.headingColor,
                  textAlign: design.chapterTitleAlign as React.CSSProperties["textAlign"],
                  marginBottom: ptToPx(8),
                }}
              >
                The Beginning
              </div>
              {design.showChapterDivider && (
                <div
                  style={{
                    borderTop: `1px solid ${design.accentColor}`,
                    marginBottom: ptToPx(8),
                  }}
                />
              )}
            </>
          )}

          {/* Image placeholder — recto only, so verso stays "body-only" */}
          {isRecto &&
            (design.imageLayout === "float_right" ||
              design.imageLayout === "inline_right" ||
              design.imageLayout === "float_left" ||
              design.imageLayout === "inline_left" ||
              design.imageLayout === "half_page") && (
              <div
                style={{
                  float:
                    design.imageLayout === "float_right" ||
                    design.imageLayout === "inline_right"
                      ? "right"
                      : "left",
                  width:
                    design.imageLayout === "half_page"
                      ? "50%"
                      : `${design.imageWidthPercent}%`,
                  height: ptToPx(60),
                  backgroundColor: design.accentColor + "33",
                  border: `1px solid ${design.accentColor}55`,
                  borderRadius: 2,
                  marginLeft:
                    design.imageLayout === "float_right" ||
                    design.imageLayout === "inline_right"
                      ? ptToPx(4)
                      : 0,
                  marginRight:
                    design.imageLayout === "float_left" ||
                    design.imageLayout === "inline_left"
                      ? ptToPx(4)
                      : 0,
                  marginBottom: ptToPx(4),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: ptToPx(7), color: design.accentColor, opacity: 0.8 }}>
                  img
                </span>
              </div>
            )}
          {isRecto && design.imageLayout === "full_page" && (
            <div
              style={{
                width: "100%",
                height: ptToPx(55),
                backgroundColor: design.accentColor + "33",
                border: `1px solid ${design.accentColor}55`,
                borderRadius: 2,
                marginBottom: ptToPx(4),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: ptToPx(7), color: design.accentColor, opacity: 0.8 }}>
                img
              </span>
            </div>
          )}

          {/* Body text */}
          <div
            style={{
              fontSize: ptToPx(design.bodyFontSize),
              lineHeight: design.lineHeight,
              color: design.textColor,
              textAlign: design.textAlign as React.CSSProperties["textAlign"],
              fontFamily: "serif",
            }}
          >
            <p
              style={{
                marginBottom: ptToPx(design.paragraphSpacing),
                textIndent: design.firstLineIndent
                  ? ptToPx(design.firstLineIndent)
                  : undefined,
              }}
            >
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
              incididunt ut labore et dolore magna aliqua.
            </p>
            <p
              style={{
                marginBottom: ptToPx(design.paragraphSpacing),
                textIndent: design.firstLineIndent
                  ? ptToPx(design.firstLineIndent)
                  : undefined,
              }}
            >
              Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.
            </p>
            {isVerso && (
              <p
                style={{
                  marginBottom: ptToPx(design.paragraphSpacing),
                  textIndent: design.firstLineIndent
                    ? ptToPx(design.firstLineIndent)
                    : undefined,
                }}
              >
                Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.
              </p>
            )}
          </div>
        </div>

        {/* Page number */}
        {design.showPageNumbers && (
          <div
            style={{
              position: "absolute",
              bottom: ptToPx(design.marginBottom) * 0.4,
              left: pageNumLeftSide === "left" ? ptToPx(design.marginLeft) : pageNumLeftSide === "center" ? "50%" : "auto",
              right: pageNumLeftSide === "right" ? ptToPx(design.marginRight) : "auto",
              transform: pageNumLeftSide === "center" ? "translateX(-50%)" : undefined,
              fontSize: ptToPx(8),
              color: design.textColor,
              opacity: 0.6,
            }}
          >
            {pageNumber}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-ui text-[10px] uppercase tracking-wide text-muted-foreground">
        Spread Preview
      </p>
      <div
        className="flex shadow-md rounded-sm overflow-hidden"
        style={{ background: "#d4c9b5" }}
      >
        <SpreadPage side="verso" />
        {/* Gutter / binding line */}
        <div style={{ width: 1, background: "#a89e8b" }} aria-hidden />
        <SpreadPage side="recto" />
      </div>
      <p className="font-ui text-[10px] text-muted-foreground">
        {design.pageSize} · {design.bodyFont} {design.bodyFontSize}pt
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Design Chat (left panel)
// ---------------------------------------------------------------------------
function DesignChat({
  projectId,
  onDesignUpdated,
}: {
  projectId: string;
  onDesignUpdated: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [streamingStep, setStreamingStep] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const sessionIdRef = useRef<string>(`design-${crypto.randomUUID()}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSession = useCallback(
    async (targetSessionId?: string) => {
      try {
        const url = targetSessionId
          ? `/api/projects/${projectId}/design/chat/history?sessionId=${targetSessionId}`
          : `/api/projects/${projectId}/design/chat/history`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) setMessages(data.messages);
        if (data.sessionId) sessionIdRef.current = data.sessionId;
        if (Array.isArray(data.sessions)) setSessions(data.sessions);
      } catch {
        // ignore
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await loadSession();
      if (!cancelled) setIsLoadingHistory(false);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleNewChat = useCallback(() => {
    if (isStreaming) return;
    sessionIdRef.current = `design-${crypto.randomUUID()}`;
    setMessages([]);
    setShowSessions(false);
    textareaRef.current?.focus();
  }, [isStreaming]);

  const handleSelectSession = useCallback(
    async (sid: string) => {
      if (isStreaming) return;
      setShowSessions(false);
      setIsLoadingHistory(true);
      await loadSession(sid);
      setIsLoadingHistory(false);
    },
    [isStreaming, loadSession]
  );

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/projects/${projectId}/design/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        toast.error(`Insufficient credits (${errData.balance ?? 0} remaining).`);
        setMessages(newMessages);
        setIsStreaming(false);
        return;
      }
      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullContent = "";
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        lineBuffer += text;
        const parts = lineBuffer.split("\n");
        lineBuffer = parts.pop() ?? "";

        for (const line of parts) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.step === "thinking" && parsed.tool) {
              const toolLabels: Record<string, string> = {
                update_design: "Updating design...",
                apply_preset: "Applying preset...",
                update_all_images_layout: "Updating all images...",
                update_image_layout: "Updating image...",
              };
              setStreamingStep(toolLabels[parsed.tool] ?? `Using ${parsed.tool}...`);
            }

            if (parsed.chunk) {
              fullContent += parsed.chunk;
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { role: "assistant", content: fullContent };
                return updated;
              });
            }

            if (parsed.done) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { ...updated[assistantIndex], content: fullContent };
                return updated;
              });
              if (parsed.creditsUsed != null) {
                toast.info(`${parsed.creditsUsed} credits used. Balance: ${parsed.balance}`);
              }
              // Refresh design settings after AI changes
              onDesignUpdated();
            }

            if (parsed.error) {
              const detail = parsed.detail ? `: ${parsed.detail}` : "";
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = {
                  role: "assistant",
                  content: `An error occurred${detail}. Please try again.`,
                };
                return updated;
              });
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      // Refresh sessions list
      try {
        const histRes = await fetch(
          `/api/projects/${projectId}/design/chat/history?sessionId=${sessionIdRef.current}`
        );
        if (histRes.ok) {
          const histData = await histRes.json();
          if (Array.isArray(histData.sessions)) setSessions(histData.sessions);
        }
      } catch {
        // ignore
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIndex]) {
          updated[assistantIndex] = {
            role: "assistant",
            content: "Connection error. Please try again.",
          };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setStreamingStep(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b shrink-0 flex items-center justify-between">
        <h2 className="font-display text-base font-bold">Design Chat</h2>
        <div className="flex items-center gap-1">
          {!isStreaming && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSessions(!showSessions)}
              className={`h-7 font-ui text-xs gap-1 ${showSessions ? "text-foreground bg-muted" : "text-muted-foreground"}`}
            >
              <History className="h-3.5 w-3.5" /> History
            </Button>
          )}
          {!isStreaming && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewChat}
              className="h-7 font-ui text-xs gap-1 text-muted-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          )}
        </div>
      </div>

      {/* Sessions list */}
      {showSessions && (
        <div className="border-b shrink-0">
          <ScrollArea className="max-h-[200px]">
            <div className="py-1">
              {sessions.length === 0 && (
                <p className="font-body text-xs text-muted-foreground text-center py-4">
                  No chat history yet
                </p>
              )}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleSelectSession(s.id)}
                  className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2.5 ${
                    s.id === sessionIdRef.current ? "bg-muted/70" : ""
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs truncate">{s.preview || "Empty chat"}</p>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-4 py-3 space-y-4">
          {isLoadingHistory && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="font-body text-sm">Loading...</span>
            </div>
          )}
          {!isLoadingHistory && messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <img
                src="/images/quilpen-icon.png"
                alt="Quilpen"
                className="h-12 w-12 mx-auto mb-3 opacity-60 rounded-lg"
              />
              <p className="font-body text-sm">Describe the design you want for your book.</p>
              <p className="font-body text-xs mt-1 opacity-70">
                Try: "Make it look like a novel" or "Use a children's book style"
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <StaggerItem key={i} index={i} baseDelay={0.05} stagger={0.03}>
              <div className="flex gap-2.5 items-start">
                {msg.role === "user" ? (
                  <User className="h-7 w-7 shrink-0 text-[#8a7a65]" />
                ) : (
                  <img
                    src="/images/quilpen-icon.png"
                    alt="Q"
                    className="h-7 w-7 shrink-0 rounded-lg"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-body text-sm prose-chat break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    {isStreaming &&
                      i === messages.length - 1 &&
                      msg.role === "assistant" && (
                        <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
                      )}
                  </div>
                  {isStreaming &&
                    i === messages.length - 1 &&
                    msg.role === "assistant" &&
                    streamingStep && (
                      <div className="flex items-center gap-1.5 font-ui text-xs text-muted-foreground mt-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{streamingStep}</span>
                      </div>
                    )}
                </div>
              </div>
            </StaggerItem>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t px-4 py-3 shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your book's design style..."
            className="min-h-[40px] max-h-[120px] resize-none font-body text-sm"
            rows={1}
            disabled={isStreaming}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="shrink-0 h-10 w-10"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset definitions (must match backend PRESETS in design/chat/route.ts)
// ---------------------------------------------------------------------------
const PRESETS: Record<string, BookDesign> = {
  novel: {
    bodyFont: "Serif (default)", bodyFontSize: 11, headingFont: "Serif Bold", headingFontSize: 18,
    lineHeight: 1.6, paragraphSpacing: 4, firstLineIndent: 24, textAlign: "justify",
    pageSize: "5x8", marginTop: 54, marginBottom: 54, marginLeft: 54, marginRight: 54,
    chapterTitleSize: 22, chapterTitleAlign: "center", chapterTitleStyle: "bold",
    sectionTitleSize: 14, subsectionTitleSize: 12,
    imageLayout: "inline_right", imageWidthPercent: 40, imagePosition: "after",
    textColor: "#1a1a1a", headingColor: "#1a1a1a", accentColor: "#666666",
    showPageNumbers: true, pageNumberPosition: "bottom-center", showChapterDivider: true,
  },
  academic: {
    bodyFont: "Serif (default)", bodyFontSize: 12, headingFont: "Serif Bold", headingFontSize: 18,
    lineHeight: 1.5, paragraphSpacing: 6, firstLineIndent: 36, textAlign: "justify",
    pageSize: "A4", marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    chapterTitleSize: 24, chapterTitleAlign: "left", chapterTitleStyle: "bold",
    sectionTitleSize: 16, subsectionTitleSize: 13,
    imageLayout: "center", imageWidthPercent: 70, imagePosition: "after",
    textColor: "#000000", headingColor: "#000000", accentColor: "#333333",
    showPageNumbers: true, pageNumberPosition: "bottom-center", showChapterDivider: false,
  },
  children_book: {
    bodyFont: "Sans-serif", bodyFontSize: 16, headingFont: "Sans-serif Bold", headingFontSize: 28,
    lineHeight: 1.8, paragraphSpacing: 12, firstLineIndent: 0, textAlign: "left",
    pageSize: "A4", marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    chapterTitleSize: 32, chapterTitleAlign: "center", chapterTitleStyle: "bold",
    sectionTitleSize: 22, subsectionTitleSize: 18,
    imageLayout: "full_page", imageWidthPercent: 90, imagePosition: "before",
    textColor: "#2D1F0E", headingColor: "#C9A84C", accentColor: "#E8A838",
    showPageNumbers: true, pageNumberPosition: "bottom-center", showChapterDivider: true,
  },
  magazine: {
    bodyFont: "Sans-serif", bodyFontSize: 10, headingFont: "Sans-serif Bold", headingFontSize: 20,
    lineHeight: 1.4, paragraphSpacing: 6, firstLineIndent: 0, textAlign: "left",
    pageSize: "A4", marginTop: 54, marginBottom: 54, marginLeft: 54, marginRight: 54,
    chapterTitleSize: 26, chapterTitleAlign: "left", chapterTitleStyle: "bold",
    sectionTitleSize: 16, subsectionTitleSize: 12,
    imageLayout: "half_page", imageWidthPercent: 60, imagePosition: "before",
    textColor: "#222222", headingColor: "#0066cc", accentColor: "#0066cc",
    showPageNumbers: true, pageNumberPosition: "bottom-outside", showChapterDivider: false,
  },
  poetry: {
    bodyFont: "Serif Italic", bodyFontSize: 13, headingFont: "Serif Bold", headingFontSize: 20,
    lineHeight: 2.0, paragraphSpacing: 12, firstLineIndent: 0, textAlign: "center",
    pageSize: "A5", marginTop: 72, marginBottom: 72, marginLeft: 54, marginRight: 54,
    chapterTitleSize: 22, chapterTitleAlign: "center", chapterTitleStyle: "italic",
    sectionTitleSize: 16, subsectionTitleSize: 13,
    imageLayout: "center", imageWidthPercent: 60, imagePosition: "before",
    textColor: "#2D1F0E", headingColor: "#5C4A32", accentColor: "#C9A84C",
    showPageNumbers: true, pageNumberPosition: "bottom-center", showChapterDivider: true,
  },
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function DesignPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [design, setDesign] = useState<BookDesign>(DEFAULT_DESIGN);
  const [artStyle, setArtStyle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [citationFormat, setCitationFormat] = useState<CitationFormat | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch current design + citation format from project
  const fetchDesign = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.bookDesign && typeof data.bookDesign === "object") {
        setDesign({ ...DEFAULT_DESIGN, ...data.bookDesign });
      }
      if (data.citationFormat) {
        setCitationFormat(data.citationFormat as CitationFormat);
      }
      const guidelines = data.writingGuidelines as Record<string, unknown> | null;
      setArtStyle(guidelines?.artStyle ? (guidelines.artStyle as string) : null);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDesign();
  }, [fetchDesign]);

  // Debounced save on manual form changes
  function handleDesignChange(patch: Partial<BookDesign>) {
    const updated = { ...design, ...patch };
    setDesign(updated);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveDesign(projectId, updated);
      } catch {
        toast.error("Failed to save design settings.");
      }
    }, 600);
  }

  // Called by chat when AI updates the design — re-fetch from server
  function handleDesignUpdated() {
    fetchDesign();
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="font-body text-sm">Loading design settings...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Left: Design Chat (45%) */}
      <div className="lg:w-[45%] lg:min-w-[320px] lg:max-w-[560px] border-r border-[#d4c9b5]/40 flex flex-col h-full">
        <DesignChat projectId={projectId} onDesignUpdated={handleDesignUpdated} />
      </div>

      {/* Right: Controls + Preview (55%) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[#d4c9b5]/40 shrink-0">
          <h2 className="font-display text-base font-bold">Book Design Settings</h2>
          <p className="font-body text-xs text-muted-foreground mt-0.5">
            Changes save automatically. Use the chat to apply presets.
          </p>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Design Controls (scrollable) */}
          <div className="flex-1 overflow-y-auto">
            {/* Unified Book Style bundles — full-width banner at the top so
                picking a vibe is the first visible decision, then users can
                scroll down to fine-tune. */}
            <div className="border-b border-[#d4c9b5]/40 bg-[#faf7f0]">
              <div className="px-5 pt-4 pb-1">
                <h3 className="font-display text-sm font-semibold text-ink">
                  Kitap Stili
                </h3>
                <p className="font-body text-[11px] text-muted-foreground">
                  Bir kart seç — sanat stili, tipografi, renk ve sayfa düzeni birlikte uygulanır.
                </p>
              </div>
              <BookStylePanel
                projectId={projectId}
                currentArtStyle={artStyle}
                currentDesign={design}
                onApplied={fetchDesign}
              />
            </div>

            <div className="p-5">
              <DesignControls design={design} onChange={handleDesignChange} />
            </div>
          </div>

          {/* Live Preview (sticky right column on large screens) */}
          <div className="lg:w-[260px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#d4c9b5]/40 bg-[#f5f0e8] p-5 flex flex-col items-center gap-4">
            <LivePreview design={design} />

            {/* Layout-only presets — for academic and pure-layout fine tuning
                that doesn't touch art style. */}
            <div className="w-full space-y-2">
              <p className="font-ui text-[10px] uppercase tracking-wide text-muted-foreground text-center">
                Sadece Layout
              </p>
              {(
                [
                  { key: "novel", label: "Novel" },
                  { key: "academic", label: "Academic" },
                  { key: "children_book", label: "Children" },
                  { key: "magazine", label: "Magazine" },
                  { key: "poetry", label: "Poetry" },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.key}
                  onClick={async () => {
                    const presetDesign = PRESETS[preset.key];
                    if (!presetDesign) return;
                    // Immediately update local state
                    setDesign(presetDesign);
                    // Save to DB
                    try {
                      const res = await fetch(`/api/projects/${projectId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookDesign: presetDesign }),
                      });
                      if (res.ok) {
                        toast.success(`${preset.label} preset applied`);
                      } else {
                        toast.error("Failed to save preset");
                      }
                    } catch {
                      toast.error("Failed to save preset");
                    }
                  }}
                  className="w-full px-3 py-1.5 rounded-md border border-[#d4c9b5] bg-white hover:bg-[#FAF7F0] font-ui text-xs text-foreground/80 transition-colors text-left"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Citation format spec-based layout */}
            {citationFormat && (
              <div className="w-full space-y-2">
                <p className="font-ui text-[10px] uppercase tracking-wide text-muted-foreground text-center">
                  Citation Format Layout
                </p>
                <button
                  onClick={async () => {
                    const defaults = FORMAT_LAYOUT_DEFAULTS[citationFormat];
                    const merged = mergeFormatDefaults(design, defaults);
                    setDesign(merged);
                    try {
                      const res = await fetch(`/api/projects/${projectId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ bookDesign: merged }),
                      });
                      if (res.ok) {
                        toast.success(
                          `${CITATION_FORMAT_META[citationFormat].displayName} layout uygulandı`
                        );
                      } else {
                        toast.error("Layout kaydedilemedi");
                      }
                    } catch {
                      toast.error("Layout kaydedilemedi");
                    }
                  }}
                  className="w-full px-3 py-2 rounded-md border border-[#C9A84C] bg-[#FAF3E3] hover:bg-[#F5EDD8] transition-colors text-left"
                  title={FORMAT_LAYOUT_DEFAULTS[citationFormat].description}
                >
                  <div className="font-ui text-xs font-semibold text-[#8a5a1a]">
                    Apply {CITATION_FORMAT_META[citationFormat].displayName} defaults
                  </div>
                  <div className="font-body text-[10px] text-[#6b5a45] mt-0.5 leading-snug">
                    {FORMAT_LAYOUT_DEFAULTS[citationFormat].description}
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
