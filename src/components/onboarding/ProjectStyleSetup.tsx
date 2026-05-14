"use client";

/**
 * Wizard Step 4 — collect project-scoped style overrides before the
 * roadmap chat. Three coexisting ways for the user to land on a value
 * for each field:
 *
 *   1. **Bunu kullan** card — one-click accept of the smart defaults
 *      inferred from projectType + language + audience.
 *   2. **AI chat** — turn-based JSON conversation hitting
 *      /api/style/project-setup-chat. Useful when the user wants to
 *      tweak just one or two fields conversationally.
 *   3. **Manuel** — accordion with the 9 form controls; appears empty
 *      until the user clicks "Bunu kullan" or finalises a chat.
 *
 * The component is stateless from the server's perspective — it owns
 * its own conversation history and just passes the final overrides to
 * its parent (NewProjectPage) via `onChange`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { ProjectStyleOverrides } from "@/types/project";

interface ProjectStyleSetupProps {
  /** Basics from the previous wizard steps; powers smart defaults. */
  basics: {
    projectType: "ACADEMIC" | "CREATIVE";
    language: string;
    audience?: string | null;
    topic?: string | null;
    citationFormat?: string | null;
  };
  /** Current value held by the parent NewProjectPage. */
  value: Partial<ProjectStyleOverrides> | null;
  /** Called whenever the user accepts defaults, finishes the chat, or
   *  edits the manual form. Null means "no overrides — use writing-twin
   *  defaults only". */
  onChange: (v: Partial<ProjectStyleOverrides> | null) => void;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export default function ProjectStyleSetup({
  basics,
  value,
  onChange,
}: ProjectStyleSetupProps) {
  // ---- Chat state ----
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [defaults, setDefaults] = useState<Partial<ProjectStyleOverrides> | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // ---- Manual form accordion state ----
  const [manualOpen, setManualOpen] = useState(false);

  // First mount: ask the server for the smart defaults so the
  // "Bunu kullan" card is hydrated with the right values.
  useEffect(() => {
    let cancelled = false;
    async function loadDefaults() {
      try {
        const res = await fetch("/api/style/project-setup-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            basics,
            current: value ?? null,
            messages: [],
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.defaults) setDefaults(data.defaults);
        // The first response also kicks off the conversation with an
        // assistant greeting — stash it so the chat panel is populated.
        if (!cancelled && data.reply && messages.length === 0) {
          setMessages([{ role: "assistant", content: data.reply }]);
        }
      } catch {
        // Defaults are nice-to-have; if the call fails the user can
        // still use the manual form.
      }
    }
    loadDefaults();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function sendTurn() {
    const text = input.trim();
    if (!text || chatBusy) return;
    const newMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(newMessages);
    setInput("");
    setChatBusy(true);
    try {
      const res = await fetch("/api/style/project-setup-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basics,
          current: value ?? null,
          messages: newMessages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Sohbet başarısız oldu.");
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply ?? "" },
      ]);
      if (data.done && data.styleOverrides) {
        onChange(data.styleOverrides);
        setManualOpen(true);
        toast.success("Proje stili kaydedildi — son hâlini aşağıdan kontrol edebilirsin.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sohbet hatası.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setChatBusy(false);
    }
  }

  function acceptDefaults() {
    if (!defaults) return;
    onChange(defaults);
    setManualOpen(true);
    toast.success("Varsayılan proje stili kabul edildi.");
  }

  // ---- Computed: which value to render in the form ----
  const formValue = useMemo<Partial<ProjectStyleOverrides>>(
    () => value ?? defaults ?? {},
    [value, defaults],
  );

  function patch<K extends keyof ProjectStyleOverrides>(
    key: K,
    next: ProjectStyleOverrides[K] | undefined,
  ) {
    onChange({ ...(value ?? defaults ?? {}), [key]: next });
  }

  return (
    <div className="space-y-5">
      {/* Smart defaults card */}
      <Card className="border-indigo-200 bg-indigo-50/30">
        <CardContent className="pt-5 pb-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                <Sparkles className="h-4 w-4" />
                Önerilen proje stili
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {basics.projectType === "ACADEMIC"
                  ? `${basics.language?.startsWith("tr") ? "Türkçe " : ""}akademik bir proje için tipik ayarlar.`
                  : "Bu tür proje için tipik ayarlar."}
                {" "}İstemiyorsan AI ile sohbet edip değiştir, ya da aşağıdan elle düzenle.
              </p>
            </div>
            <Button
              onClick={acceptDefaults}
              disabled={!defaults}
              size="sm"
              className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
            >
              <Check className="h-3.5 w-3.5" />
              Bunu kullan
            </Button>
          </div>

          {defaults ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              {defaults.tone && <KV k="Ton" v={defaults.tone} />}
              {typeof defaults.formality === "number" && (
                <KV k="Resmiyet" v={`${defaults.formality}/10`} />
              )}
              {defaults.usesFirstPerson !== undefined && (
                <KV
                  k="1. tekil"
                  v={defaults.usesFirstPerson ? "izinli" : "kapalı"}
                />
              )}
              {defaults.voicePreference && (
                <KV k="Etken/edilgen" v={defaults.voicePreference} />
              )}
              {defaults.terminologyDensity && (
                <KV k="Terim yoğunluğu" v={defaults.terminologyDensity} />
              )}
              {defaults.citationDensity && (
                <KV k="Atıf yoğunluğu" v={defaults.citationDensity} />
              )}
              {defaults.paragraphLength && (
                <KV k="Paragraf uzunluğu" v={defaults.paragraphLength} />
              )}
              {defaults.usesBlockQuotes !== undefined && (
                <KV
                  k="Blok alıntı"
                  v={defaults.usesBlockQuotes ? "açık" : "kapalı"}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Öneriler hazırlanıyor...
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI chat panel */}
      <div className="rounded-md border bg-card">
        <div className="px-4 py-3 border-b">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            AI ile ince ayar
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            İstediğin alanları sohbetle değiştir. Boş bırakırsan varsayılanlar kullanılır.
          </p>
        </div>
        <div
          ref={transcriptRef}
          className="px-4 py-3 max-h-60 overflow-y-auto space-y-3"
        >
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              AI birazdan ilk soruyu yazacak...
            </p>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "text-sm bg-indigo-50 rounded-md px-3 py-2 ml-8"
                    : "text-sm bg-muted rounded-md px-3 py-2 mr-8 whitespace-pre-wrap"
                }
              >
                {m.content}
              </div>
            ))
          )}
          {chatBusy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI yazıyor...
            </div>
          )}
        </div>
        <div className="border-t px-4 py-3 flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendTurn();
              }
            }}
            placeholder="Örn: 'tonu biraz daha rahat olsun', 'birinci tekil olsun', 'sen karar ver'"
            rows={2}
            className="resize-none"
          />
          <Button
            size="icon"
            onClick={sendTurn}
            disabled={!input.trim() || chatBusy}
            className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Manual form accordion */}
      <button
        type="button"
        onClick={() => setManualOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {manualOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {manualOpen ? "Manuel düzenlemeyi gizle" : "Manuel düzenle"}
      </button>

      {manualOpen && (
        <div className="rounded-md border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Ton">
            <Select
              value={formValue.tone ?? "formal"}
              onValueChange={(v) =>
                patch("tone", v as ProjectStyleOverrides["tone"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">Resmi</SelectItem>
                <SelectItem value="semi-formal">Yarı resmi</SelectItem>
                <SelectItem value="conversational">Sohbet havası</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Resmiyet (1-10)">
            <Input
              type="number"
              min={1}
              max={10}
              value={formValue.formality ?? 7}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) {
                  patch("formality", Math.max(1, Math.min(10, n)));
                }
              }}
            />
          </Field>

          <Field label="Birinci tekil">
            <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-background">
              <Switch
                checked={Boolean(formValue.usesFirstPerson)}
                onCheckedChange={(v) => patch("usesFirstPerson", v)}
              />
              <span className="text-sm">
                {formValue.usesFirstPerson ? "İzinli" : "Kapalı"}
              </span>
            </div>
          </Field>

          <Field label="Etken / edilgen">
            <Select
              value={formValue.voicePreference ?? "mixed"}
              onValueChange={(v) =>
                patch("voicePreference", v as ProjectStyleOverrides["voicePreference"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Etken</SelectItem>
                <SelectItem value="passive">Edilgen</SelectItem>
                <SelectItem value="mixed">Karışık</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Terim yoğunluğu">
            <Select
              value={formValue.terminologyDensity ?? "medium"}
              onValueChange={(v) =>
                patch("terminologyDensity", v as ProjectStyleOverrides["terminologyDensity"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Az</SelectItem>
                <SelectItem value="medium">Orta</SelectItem>
                <SelectItem value="high">Yoğun</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Atıf yoğunluğu (paragraf başına)">
            <Select
              value={formValue.citationDensity ?? "normal"}
              onValueChange={(v) =>
                patch("citationDensity", v as ProjectStyleOverrides["citationDensity"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Hafif (≤1)</SelectItem>
                <SelectItem value="normal">Normal (2-3)</SelectItem>
                <SelectItem value="dense">Yoğun (4+)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Paragraf uzunluğu">
            <Select
              value={formValue.paragraphLength ?? "medium"}
              onValueChange={(v) =>
                patch("paragraphLength", v as ProjectStyleOverrides["paragraphLength"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Kısa (1-3 cümle)</SelectItem>
                <SelectItem value="medium">Orta (4-6)</SelectItem>
                <SelectItem value="long">Uzun (7+)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Blok alıntı (uzun alıntılar)">
            <div className="flex items-center gap-2 h-9 px-3 rounded-md border bg-background">
              <Switch
                checked={Boolean(formValue.usesBlockQuotes)}
                onCheckedChange={(v) => patch("usesBlockQuotes", v)}
              />
              <span className="text-sm">
                {formValue.usesBlockQuotes ? "Açık" : "Kapalı"}
              </span>
            </div>
          </Field>

          <Field label="Not (opsiyonel)" className="sm:col-span-2">
            <Input
              value={formValue.notes ?? ""}
              onChange={(e) => patch("notes", e.target.value)}
              placeholder="AI'ya iletmek istediğin proje-özel notlar"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | number | boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{k}:</span>
      <span className="font-medium text-foreground">{String(v)}</span>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
