/**
 * Retry the ciltler that landed in 'failed' state during the initial
 * bulk import (typically `pdfError = "fetch failed"` from Python being
 * overwhelmed by parallel uploads).
 *
 * Strictly sequential: one cilt at a time, wait until status leaves
 * the pending/extracting/embedding bucket before kicking the next.
 * That's the whole point of the retry — give Python room to breathe.
 *
 * Usage:
 *   ADMIN_TOKEN="..." TARGET_USER_ID="..." \
 *     npx tsx scripts/admin/retry-failed-imports.ts
 *
 * Stops as soon as nothing remains failed. Per-cilt poll budget is 5
 * minutes, after which we mark it skipped and move on so a single
 * truly-stuck cilt doesn't block the whole run.
 */

const BASE_URL = process.env.BASE_URL ?? 'https://quilpen.com'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''
const TARGET_USER_ID = process.env.TARGET_USER_ID ?? ''
const POLL_INTERVAL_MS = 5000
// 20 min cap per cilt — İhya / Tarih are 60 MB and chunk + embed
// pretty slowly on the shared Python service.
const POLL_TIMEOUT_MS = 20 * 60 * 1000
// Wait for the user to have NO in-flight ciltler before kicking the
// next reprocess. Same budget as POLL_TIMEOUT_MS — if a single cilt
// truly hangs we'll bail and skip rather than block the run.
const IDLE_WAIT_TIMEOUT_MS = 20 * 60 * 1000

if (!ADMIN_TOKEN || !TARGET_USER_ID) {
  console.error('ADMIN_TOKEN ve TARGET_USER_ID env-vars gerekli')
  process.exit(1)
}

interface FailedVolume {
  id: string
  entryId: string
  volumeNumber: number
  pdfError: string | null
  title: string
  authorSurname: string
}

async function api(p: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${p}`, {
    ...init,
    headers: {
      'x-admin-token': ADMIN_TOKEN,
      ...(init.headers ?? {}),
    },
  })
}

async function listFailed(): Promise<FailedVolume[]> {
  const res = await api(
    `/api/bulk-import/reprocess?action=list-failed&userId=${encodeURIComponent(TARGET_USER_ID)}`,
  )
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`list-failed ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = (await res.json()) as { volumes: FailedVolume[] }
  return data.volumes
}

async function kickReprocess(volumeId: string): Promise<void> {
  const res = await api('/api/bulk-import/reprocess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volumeId }),
  })
  if (!res.ok && res.status !== 202) {
    const t = await res.text().catch(() => '')
    throw new Error(`reprocess ${res.status}: ${t.slice(0, 200)}`)
  }
}

async function waitForIdle(): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < IDLE_WAIT_TIMEOUT_MS) {
    const res = await api(
      `/api/bulk-import/reprocess?action=inflight&userId=${encodeURIComponent(TARGET_USER_ID)}`,
    )
    if (res.ok) {
      const data = (await res.json()) as { inflight: number }
      if (data.inflight === 0) return true
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return false
}

async function pollStatus(volumeId: string): Promise<{ status: string; error: string | null }> {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await api(
      `/api/bulk-import/reprocess?action=status&volumeId=${encodeURIComponent(volumeId)}`,
    )
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      continue
    }
    const data = (await res.json()) as { pdfStatus: string; pdfError: string | null }
    if (data.pdfStatus === 'ready' || data.pdfStatus === 'failed') {
      return { status: data.pdfStatus, error: data.pdfError }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return { status: 'timeout', error: 'Poll budget aşıldı' }
}

async function main() {
  console.log(`Base: ${BASE_URL}`)
  console.log(`Target user: ${TARGET_USER_ID}\n`)

  const failed = await listFailed()
  console.log(`${failed.length} failed cilt bulundu, sırayla yeniden işleniyor…\n`)

  const recovered: string[] = []
  const stillFailed: string[] = []
  const timedOut: string[] = []

  for (let i = 0; i < failed.length; i++) {
    const v = failed[i]
    const tag = `[${i + 1}/${failed.length}] ${v.authorSurname} — ${v.title} · cilt ${v.volumeNumber}`
    console.log(tag)
    try {
      // Block until Python has nothing else of ours in flight. Earlier
      // 'specific cilt' polling let timeouts pile up ciltler in the
      // pipeline — global-idle is the safer serialization point.
      const idle = await waitForIdle()
      if (!idle) {
        console.log(`    ⏱ idle-wait timeout, atlandı`)
        timedOut.push(v.id)
        continue
      }
      await kickReprocess(v.id)
      const result = await pollStatus(v.id)
      if (result.status === 'ready') {
        console.log(`    ✓ ready`)
        recovered.push(v.id)
      } else if (result.status === 'timeout') {
        console.log(`    ⏱ timeout`)
        timedOut.push(v.id)
      } else {
        console.log(`    ✗ ${result.status}: ${result.error ?? ''}`)
        stillFailed.push(`${v.id}: ${result.error ?? result.status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ✗ ${msg}`)
      stillFailed.push(`${v.id}: ${msg}`)
    }
  }

  console.log('\n=== Retry Özet ===')
  console.log(`✓ Düzelen: ${recovered.length}`)
  console.log(`✗ Hala failed: ${stillFailed.length}`)
  console.log(`⏱ Timeout: ${timedOut.length}`)
  if (stillFailed.length) {
    console.log('\nDevam eden hatalar:')
    for (const f of stillFailed) console.log(`  - ${f}`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
