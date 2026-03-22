"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, Unplug, Plug, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
}

interface ZoteroSettingsCardProps {
  onSynced?: () => void;
}

export default function ZoteroSettingsCard({ onSynced }: ZoteroSettingsCardProps) {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [syncCollections, setSyncCollections] = useState<string[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Manual fallback
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
    fetchCollections();
  }, [fetchCollections]);

  // Handle OAuth callback result from URL params
  useEffect(() => {
    const zoteroStatus = searchParams.get("zotero");
    if (zoteroStatus === "connected") {
      const username = searchParams.get("username");
      toast.success(
        username
          ? `Zotero connected (${username})`
          : "Zotero connected"
      );
      setConnected(true);
      fetchCollections();
      // Clean URL
      window.history.replaceState({}, "", "/library");
    } else if (zoteroStatus === "error") {
      const reason = searchParams.get("reason");
      toast.error(`Zotero connection failed: ${reason ?? "unknown error"}`);
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
        toast.info("OAuth not configured. You can connect with a manual API key.");
        return;
      }

      if (!res.ok) {
        throw new Error(data.error ?? "Connection failed");
      }

      if (data.authorizeUrl) {
        // Redirect to Zotero for authorization
        window.location.href = data.authorizeUrl;
      } else if (data.connected) {
        setConnected(true);
        fetchCollections();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleManualConnect() {
    if (!apiKey.trim() || !zoteroUserId.trim()) {
      toast.error("API key and Zotero User ID are required");
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
        const err = await res.json().catch(() => ({ error: "Connection failed" }));
        throw new Error(err.error ?? "Connection failed");
      }
      toast.success("Zotero connected");
      setConnected(true);
      setApiKey("");
      setZoteroUserId("");
      setShowManual(false);
      fetchCollections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
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
      toast.success("Zotero disconnected");
    } catch {
      toast.error("Failed to disconnect");
    }
  }

  function toggleCollection(key: string) {
    setSyncCollections((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function handleSync() {
    if (syncCollections.length === 0) {
      toast.error("Select at least one collection");
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
        const err = await res.json().catch(() => ({ error: "Sync failed" }));
        throw new Error(err.error ?? "Sync failed");
      }
      const data = await res.json();
      const parts = [`${data.created} new`, `${data.updated} updated`];
      if (data.filesDownloaded > 0) parts.push(`${data.filesDownloaded} files downloaded`);
      toast.success(`Sync complete: ${parts.join(", ")}`);
      setLastSyncAt(new Date().toLocaleString("en-US"));
      onSynced?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

  // Not connected state
  if (!connected) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plug className="h-4 w-4 text-red-500" />
            Zotero Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Connect your Zotero account to sync your library and PDFs.
          </p>

          {/* OAuth button */}
          <Button
            onClick={handleOAuthConnect}
            disabled={isConnecting}
            className="w-full bg-[#cc2936] hover:bg-[#b02530] text-white gap-2 h-9 text-sm"
          >
            {isConnecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            Connect with Zotero
          </Button>

          {/* Manual fallback toggle */}
          <button
            type="button"
            onClick={() => setShowManual(!showManual)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full justify-center"
          >
            Connect with manual API key
            {showManual ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {showManual && (
            <div className="space-y-2 pt-1 border-t border-border">
              <p className="text-[10px] text-muted-foreground">
                Get your API key from{" "}
                <span className="font-medium">zotero.org/settings/keys</span>.
              </p>
              <div>
                <Label htmlFor="zoteroUserId" className="text-xs">Zotero User ID</Label>
                <Input
                  id="zoteroUserId"
                  placeholder="e.g. 12345678"
                  value={zoteroUserId}
                  onChange={(e) => setZoteroUserId(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="zoteroApiKey" className="text-xs">API Key</Label>
                <Input
                  id="zoteroApiKey"
                  type="password"
                  placeholder="Zotero API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <Button
                onClick={handleManualConnect}
                disabled={isConnecting}
                variant="outline"
                className="w-full gap-2 h-8 text-sm"
              >
                {isConnecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Connect
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Connected state
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plug className="h-4 w-4 text-emerald-500" />
            Zotero Connected
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="text-xs text-red-500 hover:text-red-600 h-7 gap-1"
          >
            <Unplug className="h-3 w-3" />
            Disconnect
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Collections */}
        {isLoadingCollections ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : collections.length > 0 ? (
          <div>
            <p className="text-xs font-medium mb-2">Collections</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {collections.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 px-2 py-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={syncCollections.includes(col.key)}
                    onChange={() => toggleCollection(col.key)}
                    className="rounded border-gray-300 text-primary focus:ring-ring"
                  />
                  {col.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No collections found</p>
        )}

        {lastSyncAt && (
          <p className="text-[10px] text-muted-foreground">Last sync: {lastSyncAt}</p>
        )}

        <Button
          onClick={handleSync}
          disabled={isSyncing || syncCollections.length === 0}
          className="w-full gap-2 h-8 text-sm"
          variant="outline"
        >
          {isSyncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {isSyncing ? "Syncing..." : "Sync"}
        </Button>

        <p className="text-[10px] text-muted-foreground text-center">
          PDF files are also downloaded automatically
        </p>
      </CardContent>
    </Card>
  );
}
