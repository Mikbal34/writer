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
