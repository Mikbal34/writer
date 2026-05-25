"use client";

/**
 * Zotero bağlantı + senkronizasyon diyaloğu. AddSourceDialog tasarımıyla
 * tutarlı: dark olive hero header, parchment body, gold/forest accent.
 *
 * Bağlı değilse: OAuth butonu + manuel API anahtarı fallback.
 * Bağlıysa: koleksiyon listesi + seçim + sync butonu.
 */
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Loader2, RefreshCw, Unplug, Plug, ExternalLink, ChevronDown, ChevronUp,
  X, Sparkles, Link2,
} from "lucide-react";
import { toast } from "sonner";

interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
}

interface ZoteroSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSynced?: () => void;
}

export default function ZoteroSettingsDialog({
  open, onOpenChange, onSynced,
}: ZoteroSettingsDialogProps) {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [syncCollections, setSyncCollections] = useState<string[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [zoteroUserId, setZoteroUserId] = useState("");

  const fetchCollections = useCallback(async () => {
    setIsLoadingCollections(true);
    try {
      const res = await fetch("/api/library/zotero/collections");
      if (res.status === 404) {
        setConnected(false);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setCollections(data.collections ?? []);
      setSyncCollections(data.syncCollections ?? []);
      setConnected(true);
    } catch {
      // ignore
    } finally {
      setIsLoadingCollections(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchCollections();
  }, [open, fetchCollections]);

  // OAuth callback URL params (?zotero=connected|error)
  useEffect(() => {
    const zoteroStatus = searchParams.get("zotero");
    if (zoteroStatus === "connected") {
      const username = searchParams.get("username");
      toast.success(username ? `Zotero bağlandı (${username})` : "Zotero bağlandı");
      setConnected(true);
      fetchCollections();
      window.history.replaceState({}, "", "/library");
    } else if (zoteroStatus === "error") {
      const reason = searchParams.get("reason");
      toast.error(`Zotero bağlantı hatası: ${reason ?? "bilinmeyen sebep"}`);
      window.history.replaceState({}, "", "/library");
    }
  }, [searchParams, fetchCollections]);

  async function handleOAuthConnect() {
    setIsConnecting(true);
    try {
      const res = await fetch("/api/library/zotero/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (data.needsManual) {
        setShowManual(true);
        toast.info("OAuth ayarlı değil. Manuel API anahtarı ile bağlanabilirsin.");
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Bağlantı başarısız");
      if (data.authorizeUrl) {
        window.location.href = data.authorizeUrl;
      } else if (data.connected) {
        setConnected(true);
        fetchCollections();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bağlantı başarısız");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleManualConnect() {
    if (!apiKey.trim() || !zoteroUserId.trim()) {
      toast.error("API anahtarı ve Zotero User ID gerekli");
      return;
    }
    setIsConnecting(true);
    try {
      const res = await fetch("/api/library/zotero/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, zoteroUserId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Bağlantı başarısız" }));
        throw new Error(err.error ?? "Bağlantı başarısız");
      }
      toast.success("Zotero bağlandı");
      setConnected(true);
      setApiKey("");
      setZoteroUserId("");
      setShowManual(false);
      fetchCollections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bağlantı başarısız");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await fetch("/api/library/zotero/disconnect", { method: "DELETE" });
      setConnected(false);
      setCollections([]);
      setSyncCollections([]);
      toast.success("Zotero bağlantısı kesildi");
    } catch {
      toast.error("Bağlantı kesilemedi");
    }
  }

  function toggleCollection(key: string) {
    setSyncCollections((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function handleSync() {
    if (syncCollections.length === 0) {
      toast.error("En az bir koleksiyon seç");
      return;
    }
    setIsSyncing(true);
    try {
      const res = await fetch("/api/library/zotero/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionKeys: syncCollections }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Senkronizasyon başarısız" }));
        throw new Error(err.error ?? "Senkronizasyon başarısız");
      }
      const data = await res.json();
      const parts = [`${data.created} yeni`, `${data.updated} güncellendi`];
      if (data.filesQueued > 0) parts.push(`${data.filesQueued} PDF kuyruğa alındı`);
      toast.success(`Sync tamam: ${parts.join(", ")}`);
      setLastSyncAt(new Date().toLocaleString("tr-TR"));
      onSynced?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Senkronizasyon başarısız");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[640px] sm:max-w-[640px] w-[88vw] max-h-[86vh] p-0 gap-0 overflow-hidden border-0 bg-parchment flex flex-col"
      >
        {/* Hero header */}
        <div
          className="px-6 pt-5 pb-5 text-gold-soft relative overflow-hidden flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #2a3d28 0%, #1a2818 100%)" }}
        >
          <div
            className="absolute -top-2 right-5 opacity-[0.14] font-serif italic leading-none pointer-events-none select-none"
            style={{ fontSize: 110, color: "var(--color-gold-soft)" }}
          >
            Z
          </div>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-gold-soft/65 mb-1">
                <Link2 size={11} /> Zotero entegrasyonu
              </div>
              <h2 className="font-serif italic text-2xl font-medium text-white leading-tight m-0">
                {connected ? "Bağlı — koleksiyon seç ve senkronize et" : "Zotero hesabını bağla"}
              </h2>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="w-[30px] h-[30px] rounded-full bg-white/12 border-0 text-gold-soft flex items-center justify-center hover:bg-white/20 transition"
              aria-label="Kapat"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-[22px] pb-1">
          {!connected ? (
            <div className="space-y-4">
              <p className="text-[13px] text-ink-muted">
                Zotero hesabını bağla — koleksiyonlarındaki künyeleri ve PDF'leri
                seçtiğin gibi senkronize et.
              </p>

              <Button
                onClick={handleOAuthConnect}
                disabled={isConnecting}
                className="w-full bg-[#cc2936] hover:bg-[#b02530] text-white gap-2 h-10"
              >
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Zotero ile bağlan (OAuth)
              </Button>

              <button
                type="button"
                onClick={() => setShowManual(!showManual)}
                className="flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink transition-colors w-full justify-center"
              >
                Manuel API anahtarı ile bağlan
                {showManual ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              {showManual && (
                <div className="space-y-3 pt-3 border-t border-ink-muted/15">
                  <p className="text-[11px] text-ink-muted">
                    API anahtarını{" "}
                    <span className="font-mono font-medium">zotero.org/settings/keys</span>{" "}
                    sayfasından alabilirsin.
                  </p>
                  <div>
                    <label className="text-[11.5px] text-ink-light font-medium block mb-1">
                      Zotero User ID
                    </label>
                    <Input
                      placeholder="örn. 12345678"
                      value={zoteroUserId}
                      onChange={(e) => setZoteroUserId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[11.5px] text-ink-light font-medium block mb-1">
                      API Anahtarı
                    </label>
                    <Input
                      type="password"
                      placeholder="Zotero API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={handleManualConnect}
                    disabled={isConnecting}
                    variant="outline"
                    className="w-full gap-2"
                  >
                    {isConnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Bağlan
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 text-forest font-semibold">
                  <Plug className="h-3.5 w-3.5" /> Zotero bağlı
                </span>
                <button
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted hover:text-red-600 transition-colors"
                >
                  <Unplug className="h-3 w-3" /> Bağlantıyı kes
                </button>
              </div>

              <div>
                <div className="text-[10.5px] tracking-[0.14em] uppercase font-semibold text-forest mb-2 flex items-center gap-2">
                  Koleksiyonlar
                  <span className="flex-1 h-px bg-forest/20" />
                </div>
                {isLoadingCollections ? (
                  <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
                ) : collections.length > 0 ? (
                  <div className="space-y-0.5 max-h-[260px] overflow-y-auto border border-ink-muted/15 rounded-md p-2 bg-parchment-dark/30">
                    {collections.map((col) => (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 text-[13px] cursor-pointer hover:bg-forest/8 px-2 py-1.5 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={syncCollections.includes(col.key)}
                          onChange={() => toggleCollection(col.key)}
                          className="w-3.5 h-3.5 accent-forest"
                        />
                        {col.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-ink-muted italic">Koleksiyon bulunamadı</p>
                )}
              </div>

              {lastSyncAt && (
                <p className="text-[11px] text-ink-muted italic">Son sync: {lastSyncAt}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {connected && (
          <div className="flex items-center gap-2.5 px-6 py-3.5 border-t border-ink-muted/15 bg-parchment-dark/30 flex-shrink-0">
            <span className="text-[11.5px] text-ink-muted inline-flex items-center gap-1.5">
              <Sparkles size={11} className="text-gold" />
              PDF'ler de otomatik indirilir
            </span>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Kapat
            </Button>
            <Button
              size="sm"
              onClick={handleSync}
              disabled={isSyncing || syncCollections.length === 0}
              className="bg-forest hover:bg-forest/90 text-white gap-1"
            >
              {isSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isSyncing ? "Senkronize ediliyor..." : "Senkronize et"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
