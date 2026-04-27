# Quilpen

AI-assisted academic writing — generates submission-ready manuscripts in nine
citation formats (APA 7, MLA 9, Chicago 17, Turabian 9, Harvard, IEEE,
Vancouver, AMA 11, ISNAD 2). Per-format typography, structured abstracts,
multi-author support, BibTeX/Zotero library, in-text citations, footnotes,
captions, cross-references, charts, diagrams, and equations.

## Stack

- **Frontend** — Next.js 16 App Router · React 19 · Tailwind · shadcn/ui · TipTap
- **Backend** — Next.js API routes · Prisma 7 (Postgres + pgvector adapter)
- **AI** — Anthropic Claude (writing, abstract generation) · Google Imagen 4 (creative)
- **Export** — DOCX (`docx`), PDF (`pdfkit`), EPUB · Kroki (charts/mermaid/equations)
- **Auth** — NextAuth (credentials + Google) with Prisma adapter
- **Hosting** — Railway (web + Postgres)

## Local development

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, ANTHROPIC_API_KEY, etc.
npx prisma generate
npx prisma db push     # syncs schema to DB
npm run dev            # http://localhost:3000
```

## Repo layout

```
src/
  app/                  Next.js routes (API + pages)
  components/           shadcn-style React components
  lib/
    academic-meta/      Per-format Zod schemas + builders
    citations/          9 citation formatters + author-list helper
    export/             DOCX/PDF/EPUB builders
    prompts/            Claude prompt templates
prisma/
  schema.prisma         DB schema (Project, Bibliography, LibraryEntry, …)
scripts/
  backfills/            One-shot DB migrations (already applied)
  tests/                Format regression tests (run via tsx)
  admin/                Admin tools (create-admin)
  _archived/            One-off scripts kept for forensic value
python-service/         FastAPI service for PDF extraction + embeddings
```

## Tests

```bash
npx tsx scripts/tests/test-all-formats.ts      # generates DOCX+PDF for every format
npx tsx scripts/tests/test-inline-citations.ts # in-text citation pipeline
npx tsx scripts/tests/test-et-al.ts            # author-list truncation rules
```

## Deploy

Production runs on Railway. Pushing to `main` triggers an auto-build. The
Python service needs the same `DATABASE_URL` and a separate Railway service.

For Kroki (chart/diagram/equation rendering) we hit the public
`https://kroki.io` by default; set `KROKI_BASE_URL` to a self-hosted
instance for higher throughput.
