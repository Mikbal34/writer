import { prisma } from '../src/lib/db'

;(async () => {
  const entries = await prisma.libraryEntry.findMany({
    where: { fileType: { in: ['epub', 'docx'] } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, title: true, authorSurname: true, authorName: true,
      year: true, fileType: true, pdfStatus: true, pdfError: true,
      createdAt: true,
      _count: { select: { chunks: true } },
    },
  })
  console.dir(entries, { depth: null })

  // Check how many of these chunks have embeddings
  for (const e of entries) {
    const stats = await prisma.$queryRawUnsafe<{ total: bigint; with_emb: bigint; without_emb: bigint }[]>(`
      SELECT
        COUNT(*)::bigint as total,
        COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint as with_emb,
        COUNT(*) FILTER (WHERE embedding IS NULL)::bigint as without_emb
      FROM "LibraryChunk"
      WHERE "libraryEntryId" = $1
    `, e.id)
    console.log(`  → ${e.title.slice(0,40)}: total=${stats[0].total}, with_emb=${stats[0].with_emb}, without_emb=${stats[0].without_emb}`)
  }
  await prisma.$disconnect()
})()
