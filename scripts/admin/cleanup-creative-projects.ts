/**
 * One-shot cleanup: deletes every CREATIVE project (and everything
 * cascade-attached to it) so the launch focuses on academic-only.
 *
 * Cascading happens via the Prisma onDelete: Cascade rules on every
 * model whose `project` relation is set up. BackgroundJob has only a
 * nullable projectId without a FK, so we wipe its dangling rows
 * separately at the end (cosmetic — they'd just deep-link to nothing).
 *
 *   DATABASE_URL=... npx tsx scripts/admin/cleanup-creative-projects.ts        # dry-run, prints counts
 *   DATABASE_URL=... npx tsx scripts/admin/cleanup-creative-projects.ts --go   # actually delete
 */
import { Pool } from 'pg'

const dryRun = !process.argv.includes('--go')

async function main() {
  // Railway's TCP proxy presents a self-signed cert; we accept it
  // explicitly because we know we're talking to the real DB by URL.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  // ---- counts before --------------------------------------------------
  const counts = await pool.query<{ table: string; n: string }>(
    `
    SELECT 'Project' AS table, COUNT(*)::text AS n FROM "Project" WHERE "projectType" = 'CREATIVE'
    UNION ALL SELECT 'Chapter',     COUNT(*)::text FROM "Chapter"     c JOIN "Project" p ON c."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'Section',     COUNT(*)::text FROM "Section"     s JOIN "Chapter" c ON s."chapterId" = c.id JOIN "Project" p ON c."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'Subsection',  COUNT(*)::text FROM "Subsection"  ss JOIN "Section" s ON ss."sectionId" = s.id JOIN "Chapter" c ON s."chapterId" = c.id JOIN "Project" p ON c."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'Source',      COUNT(*)::text FROM "Source"      x JOIN "Project" p ON x."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'Bibliography',COUNT(*)::text FROM "Bibliography" b JOIN "Project" p ON b."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'Output',      COUNT(*)::text FROM "Output"      o JOIN "Project" p ON o."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'Character',   COUNT(*)::text FROM "Character"   ch JOIN "Project" p ON ch."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'ProjectImage',COUNT(*)::text FROM "ProjectImage" pi JOIN "Project" p ON pi."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'RoadmapChatMessage',     COUNT(*)::text FROM "RoadmapChatMessage" rcm JOIN "Project" p ON rcm."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'IllustrationChatMessage',COUNT(*)::text FROM "IllustrationChatMessage" icm JOIN "Project" p ON icm."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    UNION ALL SELECT 'BackgroundJob (dangling)', COUNT(*)::text FROM "BackgroundJob" bj JOIN "Project" p ON bj."projectId" = p.id WHERE p."projectType" = 'CREATIVE'
    `,
  )
  console.log(`\nCREATIVE-attached rows ${dryRun ? '(dry-run)' : '(about to delete)'}:`)
  for (const row of counts.rows) {
    console.log(`  ${row.table.padEnd(30)} ${row.n.padStart(8)}`)
  }

  if (dryRun) {
    console.log('\nDry-run only. Re-run with --go to actually delete.')
    await pool.end()
    return
  }

  // ---- the actual cascade --------------------------------------------
  const start = Date.now()
  // BackgroundJob has no FK so kill its rows first (the projectId
  // would otherwise persist and dead-link to a missing Project).
  const jobsRes = await pool.query(
    `DELETE FROM "BackgroundJob" WHERE "projectId" IN (SELECT id FROM "Project" WHERE "projectType" = 'CREATIVE')`,
  )
  // Now delete the projects — cascade does the rest.
  const projRes = await pool.query(`DELETE FROM "Project" WHERE "projectType" = 'CREATIVE'`)
  const elapsed = Date.now() - start

  console.log(`\nDeleted in ${elapsed}ms:`)
  console.log(`  BackgroundJob rows: ${jobsRes.rowCount}`)
  console.log(`  Project rows:       ${projRes.rowCount} (cascade wiped chapters/sections/subsections/sources/bibliography/etc.)`)

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  process.exit(1)
})
