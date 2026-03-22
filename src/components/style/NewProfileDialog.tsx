"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface NewProfileDialogProps {
  onCreated: (profile: { id: string; method: string }) => void;
}

export default function NewProfileDialog({ onCreated }: NewProfileDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<"chat" | "analyze">("chat");
  const [isCreating, setIsCreating] = useState(false);

  function resetForm() {
    setName("");
    setMethod("chat");
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Profile name is required.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/style-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), method }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create profile" }));
        throw new Error(err.error ?? "Failed to create profile");
      }

      const profile = await res.json();
      toast.success("Profile created!");
      setOpen(false);
      resetForm();
      onCreated({ id: profile.id, method: profile.method });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 font-ui text-xs px-3 py-2 rounded-sm border border-[#C9A84C]/30 bg-[#2D1F0E] text-[#C9A84C] hover:bg-[#3a2910] transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        New Profile
      </button>

      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md bg-[#FAF7F0] border-[#d4c9b5]">
          <DialogHeader>
            <DialogTitle className="font-display text-[#2D1F0E]">
              New Style Profile
            </DialogTitle>
            <DialogDescription className="font-body text-[#8a7a65]">
              Create a Writing Twin profile through conversation or writing
              sample analysis.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name" className="font-ui text-sm text-[#2D1F0E]">
                Profile Name
              </Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Academic Turkish", "Formal English"'
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) handleCreate();
                }}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label className="font-ui text-sm text-[#2D1F0E]">Method</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMethod("chat")}
                  className={`p-3 rounded-sm border text-left transition-all ${
                    method === "chat"
                      ? "border-[#C9A84C] bg-[#C9A84C]/5"
                      : "border-[#d4c9b5]/60 hover:border-[#d4c9b5]"
                  }`}
                >
                  <p className="font-display text-sm font-semibold text-[#2D1F0E]">
                    Chat Interview
                  </p>
                  <p className="font-body text-[11px] text-[#8a7a65] mt-1">
                    Build your profile through a guided conversation.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod("analyze")}
                  className={`p-3 rounded-sm border text-left transition-all ${
                    method === "analyze"
                      ? "border-[#C9A84C] bg-[#C9A84C]/5"
                      : "border-[#d4c9b5]/60 hover:border-[#d4c9b5]"
                  }`}
                >
                  <p className="font-display text-sm font-semibold text-[#2D1F0E]">
                    Writing Sample
                  </p>
                  <p className="font-body text-[11px] text-[#8a7a65] mt-1">
                    Analyze a sample of your writing to extract style.
                  </p>
                </button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || isCreating}
              className="gap-2"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {isCreating ? "Creating..." : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
