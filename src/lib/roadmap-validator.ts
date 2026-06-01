/**
 * Roadmap quality gate — LLM'in V4 metadata field'larını (synthesisMode,
 * sectionGoal, analysisDepth) doğru atayıp atamadığını kontrol eder.
 *
 * Motivasyon: stress test'te (`gen-roadmap-sample`) Sonnet roadmap'i
 * tek seferde üretirken field'ları semantik olarak dağıtıyordu:
 *   - DEFINE %18, COMPARE %21, SYNTHESIZE %20, vb.
 *   - THESIS_CONCLUSION proje başına 0-2
 * Ama UI chat akışında (turn-by-turn) Sonnet kolay default'a kaçtı —
 * 20/20 subsection için goal=DEFINE, depth=3. Yapı doğruydu ama
 * metadata boş kaldı.
 *
 * Bu modül applyCommands başında batch'i denetler. Reject kural
 * tetiklendiyse transaction iptal edilir; LLM'e regenerate feedback'i
 * gider. Warn kuralları console + UI banner.
 */

export type SynthesisMode = 'SPECIFIC' | 'THEMATIC' | 'COMPARATIVE' | 'SYNTHESIS'
export type SectionGoal =
  | 'DEFINE'
  | 'CONTEXT'
  | 'COMPARE'
  | 'SYNTHESIZE'
  | 'LITERATURE_GAP'
  | 'THESIS_CONCLUSION'

export interface ValidatedSubsection {
  subsectionId: string
  title: string
  synthesisMode: SynthesisMode
  sectionGoal: SectionGoal
  analysisDepth: number
  whatToWrite?: string | null
  keyPoints?: string[] | null
  writingStrategy?: string | null
}

export interface ValidationResult {
  rejects: string[]
  warnings: string[]
  ok: boolean
}

/**
 * Belirli bir kuralı atlatmak için minimum batch büyüklüğü. Tek
 * subsection eklemede goal=DEFINE doğal olduğu için validator
 * şuurlu davranmalı — büyük batch'lerde sertleşir.
 */
const MIN_BATCH_FOR_REJECT = 4

export function validateRoadmapBatch(subs: ValidatedSubsection[]): ValidationResult {
  const rejects: string[] = []
  const warnings: string[] = []

  if (subs.length === 0) return { rejects, warnings, ok: true }

  const goalCount: Record<SectionGoal, number> = {
    DEFINE: 0,
    CONTEXT: 0,
    COMPARE: 0,
    SYNTHESIZE: 0,
    LITERATURE_GAP: 0,
    THESIS_CONCLUSION: 0,
  }
  const modeCount: Record<SynthesisMode, number> = {
    SPECIFIC: 0,
    THEMATIC: 0,
    COMPARATIVE: 0,
    SYNTHESIS: 0,
  }
  const depths: number[] = []

  for (const s of subs) {
    if (s.sectionGoal in goalCount) goalCount[s.sectionGoal]++
    if (s.synthesisMode in modeCount) modeCount[s.synthesisMode]++
    depths.push(s.analysisDepth)
  }

  const total = subs.length
  const allSameGoal = (g: SectionGoal) => goalCount[g] === total
  const allSameDepth = (d: number) => depths.every((x) => x === d)

  // Kural 1 — REJECT: tüm subsection DEFINE
  if (total >= MIN_BATCH_FOR_REJECT && allSameGoal('DEFINE')) {
    rejects.push(
      `All ${total} subsections have sectionGoal=DEFINE. This is the schema default — Sonnet is skipping semantic goal assignment. ` +
        `Re-emit the roadmap with goals that match each subsection's purpose: COMPARE for X-vs-Y, SYNTHESIZE for multi-source synthesis, ` +
        `LITERATURE_GAP for literature reviews, CONTEXT for historical background, THESIS_CONCLUSION for the chapter/thesis closing.`,
    )
  }

  // Kural 2 — REJECT: tüm subsection depth=3
  if (total >= MIN_BATCH_FOR_REJECT && allSameDepth(3)) {
    rejects.push(
      `All ${total} subsections have analysisDepth=3. This is the schema default — depth must vary: 1-3 (descriptive), 4-6 (analytical), 7-10 (interpretive). ` +
        `Sentez/sonuç subsection'ları 7-9; karşılaştırma 5-6; giriş/tanım 2-3.`,
    )
  }

  // Kural 4 — REJECT: 5+ COMPARATIVE mode VE 0 COMPARE goal
  if (modeCount.COMPARATIVE >= 5 && goalCount.COMPARE === 0) {
    rejects.push(
      `${modeCount.COMPARATIVE} subsections use synthesisMode=COMPARATIVE but NONE has sectionGoal=COMPARE. ` +
        `If a subsection's form is X-vs-Y comparison, its goal SHOULD be COMPARE (unless it's a synthesis of the comparison, which would be SYNTHESIZE).`,
    )
  }

  // Kural 3 — WARN: 20+ subsection ve 0 THESIS_CONCLUSION
  if (total >= 20 && goalCount.THESIS_CONCLUSION === 0) {
    warnings.push(
      `${total} subsections but NONE marked THESIS_CONCLUSION. A multi-chapter thesis normally closes with at least one THESIS_CONCLUSION subsection (the final payoff). ` +
        `Check whether the last subsection of the last chapter is actually the analytical payoff and re-mark it.`,
    )
  }

  // Kural 5 — WARN: 3+ THEMATIC ve 0 SYNTHESIZE & 0 LITERATURE_GAP
  if (
    modeCount.THEMATIC >= 3 &&
    goalCount.SYNTHESIZE === 0 &&
    goalCount.LITERATURE_GAP === 0
  ) {
    warnings.push(
      `${modeCount.THEMATIC} subsections use synthesisMode=THEMATIC but none have sectionGoal SYNTHESIZE or LITERATURE_GAP. ` +
        `Thematic subsections almost always synthesize a field or assess a literature gap. Reconsider their goals.`,
    )
  }

  // --- Content quality rules (per-subsection, not batch-level) -------
  //
  // Historical failure mode: LLM produces structurally valid subsections
  // but whatToWrite is one line ("Discusses X."), keyPoints is two
  // generic bullets, writingStrategy is empty or "Academic tone". The
  // writer turn downstream then has nothing concrete to grip on and
  // generates filler. These rules force enough specificity at planning
  // time so the writing turn has actual instructions.
  const wordCount = (s: string | null | undefined): number =>
    typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0

  const shallowSubs: Array<{ id: string; reason: string }> = []
  // SYNTHESIS subsections need heavier briefs because they're the
  // synthesis turns (chapter-closers, payoff sections). Default
  // expectations are bumped for them.
  for (const s of subs) {
    const isHeavy = s.synthesisMode === 'SYNTHESIS' || s.sectionGoal === 'THESIS_CONCLUSION'
    const minWhatToWrite = isHeavy ? 25 : 12
    const minKeyPoints = isHeavy ? 5 : 3
    const minStrategy = isHeavy ? 15 : 8

    const reasons: string[] = []
    const wtw = wordCount(s.whatToWrite)
    if (wtw < minWhatToWrite) {
      reasons.push(
        `whatToWrite has ${wtw} word${wtw === 1 ? '' : 's'} (min ${minWhatToWrite})`,
      )
    }
    const kpCount = Array.isArray(s.keyPoints) ? s.keyPoints.filter((k) => k && k.trim()).length : 0
    if (kpCount < minKeyPoints) {
      reasons.push(`only ${kpCount} keyPoint${kpCount === 1 ? '' : 's'} (min ${minKeyPoints})`)
    }
    const ws = wordCount(s.writingStrategy)
    if (ws < minStrategy) {
      reasons.push(
        `writingStrategy has ${ws} word${ws === 1 ? '' : 's'} (min ${minStrategy})`,
      )
    }
    if (reasons.length > 0) {
      shallowSubs.push({
        id: `${s.subsectionId} ("${s.title.slice(0, 40)}")`,
        reason: reasons.join('; '),
      })
    }
  }

  // Single shallow subsection in a small batch is a WARN; >25% of a
  // batch being shallow is a REJECT — the LLM defaulted across the
  // board and the writing turns will be useless.
  if (shallowSubs.length > 0) {
    const shallowRatio = shallowSubs.length / total
    if (total >= MIN_BATCH_FOR_REJECT && shallowRatio >= 0.25) {
      rejects.push(
        `${shallowSubs.length}/${total} subsections have shallow content fields. ` +
          `whatToWrite must be a concrete brief (≥12 words for SPECIFIC/THEMATIC/COMPARATIVE, ≥25 for SYNTHESIS/THESIS_CONCLUSION). ` +
          `keyPoints must list ≥3 concrete ideas (≥5 for SYNTHESIS). ` +
          `writingStrategy must say something subsection-specific about tone/structure (≥8 words, ≥15 for SYNTHESIS). ` +
          `Offenders:\n` +
          shallowSubs.map((s) => `  - ${s.id}: ${s.reason}`).join('\n'),
      )
    } else {
      warnings.push(
        `${shallowSubs.length}/${total} subsection${shallowSubs.length === 1 ? ' has' : 's have'} shallow content fields:\n` +
          shallowSubs.map((s) => `  - ${s.id}: ${s.reason}`).join('\n'),
      )
    }
  }

  return { rejects, warnings, ok: rejects.length === 0 }
}

/**
 * Karar metni — LLM'e geri verilecek feedback için. Hem reject hem warn
 * birleşik, sıkı format.
 */
export function formatValidationFeedback(result: ValidationResult): string {
  const lines: string[] = []
  if (result.rejects.length > 0) {
    lines.push('ROADMAP VALIDATION FAILED. The following issues must be fixed before the commands are applied:')
    result.rejects.forEach((r, i) => lines.push(`${i + 1}. ${r}`))
  }
  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('Warnings (these do NOT block but should be addressed):')
    result.warnings.forEach((w, i) => lines.push(`- ${w}`))
  }
  lines.push('')
  lines.push(
    'Re-emit the commands array with corrected synthesisMode + sectionGoal + analysisDepth on every subsection. Do not say "I will fix"; emit the corrected <roadmap_commands> block.',
  )
  return lines.join('\n')
}
