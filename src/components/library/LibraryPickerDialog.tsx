"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Link2 } from "lucide-react";
import { toast } from "sonner";

interface LibraryEntry {
  id: string;
  authorSurname: string;
  authorName: string | null;
  title: string;
  year: string | null;
  entryType: string;
}

interface LibraryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onLinked: () => void;
}

export default function LibraryPickerDialog({
  open,
  onOpenChange,
  projectId,
  onLinked,
}: LibraryPickerDialogProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLinking, setIsLinking] = useState(false);

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/library?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [search]);

  useEffect(() => {
    if (open) {
      fetchEntries();
      setSelected(new Set());
    }
  }, [open, fetchEntries]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleLink() {
    if (selected.size === 0) return;
    setIsLinking(true);
    try {
      const res = await fetch("/api/library/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          libraryEntryIds: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Bağlama başarısız" }));
        throw new Error(err.error ?? "Bağlama başarısız");
      }
      const data = await res.json();
      toast.success(`${data.linked} kaynak projeye bağlandı.`);
      onLinked();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bağlama başarısız");
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Kütüphaneden Ekle</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Kaynak ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto border rounded-md divide-y divide-border min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Kaynak bulunamadı</p>
            </div>
          ) : (
            entries.map((entry) => (
              <label
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(entry.id)}
                  onChange={() => toggleSelect(entry.id)}
                  className="rounded border-gray-300 text-primary focus:ring-ring"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium">
                    {entry.authorSurname}
                    {entry.authorName ? `, ${entry.authorName}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground mx-1.5">—</span>
                  <span className="text-sm text-muted-foreground italic truncate">
                    {entry.title}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {entry.year ?? "—"}
                </span>
                <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
                  {entry.entryType}
                </Badge>
              </label>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} kaynak seçili
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button
              onClick={handleLink}
              disabled={selected.size === 0 || isLinking}
              className="gap-2"
            >
              {isLinking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Projeye Bağla ({selected.size})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
