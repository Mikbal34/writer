/**
 * Rough ETA for an in-flight library entry/volume. Used by both the
 * library row inline badge and the global nav processing chip — same
 * numbers everywhere so the UI is consistent.
 *
 * Expected duration is phase + size driven. Scanned books are 10-25
 * MB/page heavier than text-layer, so when the upload size is known
 * we lean into bigger ETAs for big files (Tesseract on a 30-lang
 * scanned 200-page book legitimately takes 15-20 minutes).
 */

export type ProcessingStatus =
  | 'queued' | 'extracting' | 'embedding' | 'pending' | 'downloading' | 'failed' | 'ready' | 'none'

export interface EtaInfo {
  /** Turkish phase label suitable for inline display. */
  label: string
  /** Minutes since the work was enqueued. */
  elapsedMin: number
  /** Estimated minutes remaining (rough; minimum 1). */
  remainingMin: number
  /** Total estimated duration for the phase, used for progress %. */
  expectedMin: number
}

export function processingEta(
  status: ProcessingStatus,
  sizeBytes: number | null | undefined,
  createdAt: Date | string,
): EtaInfo {
  const t0 = typeof createdAt === 'string' ? new Date(createdAt) : createdAt
  const elapsedMin = Math.max(0, Math.round((Date.now() - t0.getTime()) / 60_000))
  const mb = sizeBytes ? sizeBytes / 1048576 : null

  // Phase-based expected duration. The extracting band tracks the
  // dropzone heuristic so the post-upload number lines up with the
  // pre-upload promise.
  const expectedMin =
    status === 'queued' ? 5 :
    status === 'embedding' ? 1 :
    status === 'downloading' ? 1 :
    status === 'extracting'
      ? (mb == null ? 5 : mb < 2 ? 1 : mb < 10 ? 2 : mb < 25 ? 10 : 20)
      : 3

  const label =
    status === 'queued' ? 'sıraya alındı' :
    status === 'extracting' ? 'metin çıkarılıyor' :
    status === 'embedding' ? 'vektörleniyor' :
    status === 'downloading' ? 'indiriliyor' :
    status === 'pending' ? 'bekliyor' :
    status === 'failed' ? 'başarısız' :
    status === 'ready' ? 'hazır' : '—'

  return {
    label,
    elapsedMin,
    expectedMin,
    remainingMin: Math.max(1, expectedMin - elapsedMin),
  }
}

/** Compact UI string: "metin çıkarılıyor · 3 dk geçti · ~7 dk". */
export function formatEta(info: EtaInfo): string {
  return `${info.label} · ${info.elapsedMin} dk geçti · ~${info.remainingMin} dk`
}
