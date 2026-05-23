import { ingestQueue } from '@/lib/queue'
const q = ingestQueue()
await q.obliterate({ force: true })
console.log('queue obliterated')
await q.close()
process.exit(0)
