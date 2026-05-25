// Compare Railway (live) vs Neon (new stack) for any rows added since
// migration. If Railway has new data, we re-run the data copier (which
// is idempotent via ON CONFLICT) before flipping DNS.
// Run: SRC_URL=<railway> DST_URL=<neon> node --import tsx scripts/faz6-delta-check.ts
import postgres from 'postgres'

const SRC = postgres(process.env.SRC_URL!, { ssl: 'require', max: 2 })
const DST = postgres(process.env.DST_URL!, { ssl: 'require', max: 2 })

const TABLES = ['LibraryEntry', 'LibraryChunk', 'LibraryNote', 'LibraryChatMessage',
  'LibraryHighlight', 'RoadmapChatMessage', 'WritingSession', 'Output',
  'StyleChatMessage', 'Bibliography', 'LibraryEntryVolume', 'Project', 'Chapter']

async function main() {
  console.log('table'.padEnd(24), 'railway'.padStart(10), 'neon'.padStart(10), 'delta'.padStart(10))
  for (const t of TABLES) {
    const sCount = (await SRC`SELECT COUNT(*)::int n FROM ${SRC(t)}`)[0].n
    const dCount = (await DST`SELECT COUNT(*)::int n FROM ${DST(t)}`)[0].n
    const delta = sCount - dCount
    const mark = delta !== 0 ? '  ⚠' : '  ✓'
    console.log(t.padEnd(24), String(sCount).padStart(10), String(dCount).padStart(10), String(delta).padStart(10), mark)
  }
  await SRC.end(); await DST.end()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
