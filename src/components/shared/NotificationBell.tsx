"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";

type JobStatus = "running" | "done" | "failed";

interface Job {
  id: string;
  type: string;
  status: JobStatus;
  title: string;
  projectId: string | null;
  subsectionId: string | null;
  resultUrl: string | null;
  progress: number | null;
  message: string | null;
  error: string | null;
  acknowledged: boolean;
  startedAt: string;
  finishedAt: string | null;
}

const POLL_INTERVAL_MS = 5000;
const MAX_JOBS = 20;

function jobTypeLabel(type: string): string {
  switch (type) {
    case "roadmap":
      return "Roadmap";
    case "subsection":
      return "Alt bölüm";
    case "batch_writing":
      return "Toplu yazma";
    case "literature_search":
      return "Literatür taraması";
    case "zotero_sync":
      return "Zotero senkronu";
    case "pdf_pipeline":
      return "PDF işleme";
    default:
      return type;
  }
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}dk`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}sa`;
  return `${Math.floor(h / 24)}g`;
}

export default function NotificationBell({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/recent");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: Job[] };
      const incoming = data.jobs.slice(0, MAX_JOBS);

      // Toast newly-completed jobs (skip on first load so we don't replay
      // old completions every page navigation).
      if (!initialLoadRef.current) {
        for (const j of incoming) {
          if (j.status === "running" || j.acknowledged) continue;
          if (seenRef.current.has(j.id)) continue;
          seenRef.current.add(j.id);
          if (j.status === "done") {
            toast.success(`${jobTypeLabel(j.type)} tamamlandı: ${j.title}`, {
              action: j.resultUrl ? { label: "Aç", onClick: () => (window.location.href = j.resultUrl!) } : undefined,
            });
          } else if (j.status === "failed") {
            toast.error(`${jobTypeLabel(j.type)} başarısız: ${j.title}`, {
              description: j.error?.slice(0, 160),
            });
          }
        }
      } else {
        for (const j of incoming) seenRef.current.add(j.id);
        initialLoadRef.current = false;
      }

      setJobs(incoming);
    } catch {
      // Silent: don't spam toasts on transient network errors.
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchJobs]);

  const running = jobs.filter((j) => j.status === "running");
  const finished = jobs.filter((j) => j.status !== "running");
  const unreadFinished = finished.filter((j) => !j.acknowledged);
  const badge = running.length + unreadFinished.length;

  async function ackJob(id: string) {
    await fetch(`/api/jobs/${id}/ack`, { method: "POST" });
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, acknowledged: true } : j)));
  }

  async function ackAll() {
    const unread = jobs.filter((j) => !j.acknowledged && j.status !== "running");
    await Promise.all(unread.map((j) => fetch(`/api/jobs/${j.id}/ack`, { method: "POST" })));
    setJobs((prev) => prev.map((j) => ({ ...j, acknowledged: true })));
  }

  const iconColor = tone === "light" ? "#2D1F0E" : "#F5EDE0";
  const mutedColor = tone === "light" ? "#8a7a65" : "#c9bfad";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-sm transition-colors relative"
        style={{ color: mutedColor }}
        aria-label="Bildirimler"
      >
        <Bell className="h-4 w-4" style={{ color: iconColor }} />
        {badge > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-ui font-bold flex items-center justify-center"
            style={{ backgroundColor: "#C9A84C", color: "#1A0F05" }}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 top-full mt-2 z-[9999] w-[360px] max-w-[calc(100vw-32px)]"
            style={{
              backgroundColor: "#FAF7F0",
              border: "1px solid #d4c9b5",
              borderRadius: 6,
              boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                height: 3,
                background: "linear-gradient(90deg, #C9A84C 0%, #d4b76a 50%, #C9A84C 100%)",
                borderRadius: "6px 6px 0 0",
              }}
            />
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#d4c9b5]/60">
              <div>
                <div className="font-ui text-xs uppercase tracking-widest text-[#8a7a65]" style={{ letterSpacing: "0.14em" }}>
                  Bildirimler
                </div>
                <div className="font-ui text-[10px] text-[#a89a82] mt-0.5">
                  {running.length > 0 ? `${running.length} çalışıyor` : "Arka planda iş yok"}
                  {unreadFinished.length > 0 && ` · ${unreadFinished.length} yeni`}
                </div>
              </div>
              {unreadFinished.length > 0 && (
                <button
                  type="button"
                  onClick={ackAll}
                  className="font-ui text-[10px] text-[#8a5a1a] hover:underline"
                >
                  Hepsini işaretle
                </button>
              )}
            </div>

            <div className="max-h-[400px] overflow-y-auto">
              {jobs.length === 0 && (
                <div className="px-4 py-8 text-center font-ui text-xs text-[#8a7a65]">
                  Henüz arka plan görevi yok.
                </div>
              )}
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} onAck={() => ackJob(j.id)} onNavigate={() => setOpen(false)} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function JobRow({ job, onAck, onNavigate }: { job: Job; onAck: () => void; onNavigate: () => void }) {
  const isRunning = job.status === "running";
  const isDone = job.status === "done";
  const isFailed = job.status === "failed";
  const dimmed = job.acknowledged && !isRunning;

  const body = (
    <div
      className="flex items-start gap-3 px-4 py-3 border-b border-[#d4c9b5]/40 hover:bg-[#e8dfd0]/30 transition-colors"
      style={{ opacity: dimmed ? 0.55 : 1 }}
    >
      <div className="mt-0.5 shrink-0">
        {isRunning && <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#C9A84C" }} />}
        {isDone && <CheckCircle2 className="h-4 w-4" style={{ color: "#2D8B4E" }} />}
        {isFailed && <AlertCircle className="h-4 w-4" style={{ color: "#c96748" }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-ui text-xs font-medium text-[#2D1F0E] truncate">
          {jobTypeLabel(job.type)} · {job.title}
        </div>
        {job.message && (
          <div className="font-ui text-[10px] text-[#8a7a65] mt-0.5 truncate">{job.message}</div>
        )}
        {isFailed && job.error && (
          <div className="font-ui text-[10px] text-[#c96748] mt-0.5 line-clamp-2">{job.error}</div>
        )}
        {isRunning && typeof job.progress === "number" && (
          <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(212,201,181,0.5)" }}>
            <div
              className="h-full transition-all"
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%`, backgroundColor: "#C9A84C" }}
            />
          </div>
        )}
        <div className="font-ui text-[10px] text-[#a89a82] mt-1">{formatRelative(job.startedAt)} önce</div>
      </div>
      {!isRunning && !job.acknowledged && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAck();
          }}
          className="shrink-0 p-1 rounded hover:bg-[#d4c9b5]/50"
          aria-label="Okundu işaretle"
        >
          <X className="h-3 w-3 text-[#8a7a65]" />
        </button>
      )}
    </div>
  );

  if (job.resultUrl) {
    return (
      <Link href={job.resultUrl} onClick={onNavigate}>
        {body}
      </Link>
    );
  }
  return body;
}
