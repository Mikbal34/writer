// Local stand-in for the Python /embed endpoint, used ONLY for Faz 2
// worker testing (the real embedder becomes BGE-M3 in Faz 3). Returns a
// deterministic 768-dim vector per input text so the pipeline's embed
// step completes and we can validate the queue→worker→status wiring
// without reaching Railway's internal-only python service.
import http from 'node:http'

const DIM = 768
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/embed') {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      let texts = []
      try { texts = JSON.parse(body).texts || [] } catch { /* ignore */ }
      const embeddings = texts.map((t) => {
        const seed = (t.length % 100) / 100 || 0.01
        return Array.from({ length: DIM }, (_, i) => +(((i % 7) + seed) / 10).toFixed(4))
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ embeddings }))
    })
  } else {
    res.writeHead(404); res.end('shim: only POST /embed')
  }
}).listen(8001, () => console.log('embed-shim on :8001 (768-dim)'))
