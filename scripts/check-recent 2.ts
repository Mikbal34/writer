import { prisma } from '../src/lib/db'

;(async () => {
  const entries = await prisma.libraryEntry.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, title: true, authorSurname: true, authorName: true,
      fileType: true, pdfStatus: true,
      importSource: true, metadata: true,
      createdAt: true,
      _count: { select: { chunks: true, volumes: true } },
    },
  })
  for (const e of entries) {
    console.log('---')
    console.log('Title:', e.title)
    console.log('Author:', e.authorSurname, '/', e.authorName)
    console.log('fileType:', e.fileType, '| status:', e.pdfStatus, '| import:', e.importSource)
    console.log('chunks:', e._count.chunks, '| volumes:', e._count.volumes)
    if (e.metadata && Object.keys(e.metadata as object).length > 0) {
      console.log('metadata:', JSON.stringify(e.metadata))
    }
    console.log('created:', e.createdAt)
  }
  await prisma.$disconnect()
})()
