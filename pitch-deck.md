# Quilpen — Pitch Deck

---

## Slide 1: Cover

**Quilpen**
*Forge Your Words*

The AI-powered platform that takes your book from idea to publication.

> **Speaker Notes:** Open with the core promise — Quilpen isn't just another AI writing tool. It's the first platform that covers the entire book creation journey: planning, research, writing, design, and publishing — all in one place, all powered by AI that learns *your* voice.

---

## Slide 2: The Problem

### Writing a book is broken.

- **Fragmented workflow** — Authors juggle 5+ disconnected tools: Scrivener for outlining, Zotero for references, Word for writing, InDesign for layout, and separate AI tools for assistance.

- **AI that sounds like AI** — Current AI writing tools produce generic, homogeneous text. They don't understand or preserve the author's unique voice, tone, and style.

- **Citation chaos** — Academic writers spend 15-20% of their time on manual citation formatting, source tracking, and bibliography management across different standards.

- **No end-to-end solution** — No single platform covers the full journey: **plan → research → write → design → publish**. Authors lose context, time, and momentum switching between tools.

> **Speaker Notes:** Emphasize the pain with a concrete example: "Imagine writing a 300-page academic book. You have 50+ PDF sources, need ISNAD citations, want AI help but in your own academic voice, and need a professionally formatted output. Today, that requires 5 different tools and months of manual work."

---

## Slide 3: The Solution — Quilpen

### One platform. Your voice. Your book.

**1. Plan** — AI-powered roadmap generation through natural conversation. Describe your book idea, and Quilpen creates a complete chapter-section-subsection structure.

**2. Research** — Upload PDFs, sync your Zotero library, manage bibliography. Sources are chunked, embedded, and semantically searchable.

**3. Write** — AI writes with full awareness of your sources, book structure, and position in the narrative. Your writing style is learned and preserved through "Writing Twin" profiles.

**4. Design** — Chat-based book design: choose typography, layout, colors, and formatting through an interactive AI assistant. Presets for novels, academic papers, children's books.

**5. Illustrate** — AI-generated character portraits, scene illustrations, and book covers using Google Imagen 4 — integrated directly into your manuscript.

**6. Publish** — Export to professional DOCX or PDF with proper formatting, citations, bibliography, and illustrations. Direct Google Drive integration.

> **Speaker Notes:** This is the "aha" slide. Walk through the flow quickly — the key insight is that all six steps happen in ONE platform with shared context. The AI writing in step 3 knows about your sources from step 2 and follows the structure from step 1.

---

## Slide 4: Product Overview

### [Screenshots Section]

Include screenshots of these key screens:

1. **Project Dashboard** — Book-aesthetic two-page spread with chapter overview, word count stats, progress tracking, and recent activity
2. **Writing Workspace** — Three-panel layout: navigation tree (left), content editor (center), source context panel (right)
3. **Roadmap Chat** — Conversational UI where users build book structure through natural dialogue
4. **Design Chat** — Interactive design assistant with real-time typography and layout configuration
5. **AI Illustrations** — Character management + scene generation with Imagen 4
6. **Export Preview** — Professional PDF/DOCX output with formatted citations and embedded images

> **Speaker Notes:** Let the visuals speak. Point out the book-aesthetic UI design — it's intentionally crafted to feel like working with a real book, not a generic document editor. The three-panel writing workspace is where authors spend most of their time.

---

## Slide 5: Key Features

### Six pillars of intelligent book creation

#### 1. AI Roadmap Generator
Chat with AI to build your book's complete structure. Generates chapters, sections, and subsections with descriptions, key concepts, writing strategies, and page estimates. Drag-and-drop reordering. Inline editing.

#### 2. Context-Aware Writing (RAG)
Every paragraph is written with full awareness of:
- Relevant source material (retrieved via semantic search)
- Position in the book hierarchy (what comes before and after)
- Section-specific writing guidelines and key points
- Mapped bibliography entries with usage instructions

#### 3. Writing Twin — Style Profiling
Quilpen learns your writing voice through:
- Sample text analysis (upload your previous writing)
- Guided style interview (tone, formality, vocabulary, sentence structure)
- Persistent style profiles reusable across projects
- Result: AI writes *as you*, not as a generic bot

#### 4. Smart Citations
9 citation formats built-in:
- **ISNAD** (Turkish/Islamic academic standard)
- **APA** 7th Edition
- **Chicago** Style
- **MLA** 9th Edition
- **Harvard**, **Vancouver**, **IEEE**, **AMA**, **Turabian**

Automatic in-text citations, footnotes, and bibliography generation. Zotero sync. BibTeX import. Personal reference library across projects.

#### 5. AI Book Design
Interactive design chat with presets (novel, academic, children's book) and 25+ customizable parameters:
- Typography (fonts, sizes, line height)
- Layout (page size, margins, alignment)
- Visual elements (colors, chapter dividers, page numbers)
- Image placement and sizing

#### 6. AI Illustrations (Imagen 4)
- Character creation with visual trait descriptions
- Scene illustration generation from text descriptions
- Book cover generation
- Consistent art style across all images
- Automatic integration into exports with positioning control

> **Speaker Notes:** Spend the most time on Writing Twin and Context-Aware Writing — these are the strongest differentiators. Writing Twin is what makes Quilpen fundamentally different from "just another AI writer."

---

## Slide 6: How It Works

### From idea to published book in 7 steps

```
Step 1: Create Project
Choose type (Academic / Book / Story), language (50+), citation format
                    ↓
Step 2: Plan with AI
Chat with AI to generate your book's roadmap — chapters, sections, subsections
                    ↓
Step 3: Add Sources
Upload PDFs, import from Zotero, add bibliography manually or via BibTeX
                    ↓
Step 4: Set Your Style
Upload writing samples or take the style interview → Writing Twin profile created
                    ↓
Step 5: Write with AI
AI writes section by section — aware of your sources, style, and structure
                    ↓
Step 6: Design & Illustrate
Chat with AI to design your book's look. Generate illustrations for creative projects.
                    ↓
Step 7: Export & Publish
Download as DOCX or PDF with citations, bibliography, and images. Upload to Google Drive.
```

> **Speaker Notes:** This flow takes what used to be a months-long process and compresses it into a guided, AI-assisted workflow. Each step feeds context into the next — the AI in step 5 knows everything from steps 1-4.

---

## Slide 7: Technology Stack

### Built for scale, speed, and intelligence

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS |
| **UI/UX** | shadcn/ui, Framer Motion, book-aesthetic design system |
| **AI — Language** | Claude Sonnet 4.6 (complex tasks) + Haiku 4.5 (lightweight ops) |
| **AI — Vision** | Google Imagen 4 (illustrations, covers, portraits) |
| **Backend Service** | Python FastAPI (PDF processing, embeddings, DOCX generation) |
| **Database** | PostgreSQL + pgvector (semantic vector search) |
| **ORM** | Prisma 7.5 with 25+ data models |
| **Authentication** | NextAuth v4 (Google OAuth, Zotero OAuth 1.0a) |
| **Integrations** | Zotero API, Google Drive API, Google AI API |
| **Infrastructure** | Railway (production), Docker-ready |

> **Speaker Notes:** Two key technical decisions to highlight: (1) Dual-model AI strategy — Sonnet for heavy lifting, Haiku for lightweight tasks = 90% cost reduction on suitable operations. (2) pgvector for RAG — no separate vector database needed, everything in PostgreSQL.

---

## Slide 8: AI Architecture

### Intelligent by design

**Retrieval-Augmented Generation (RAG)**
- Source PDFs are chunked, embedded, and stored with pgvector
- During writing, semantic search retrieves the most relevant source excerpts
- AI generates text grounded in actual source material — not hallucinations

**Streaming & Real-Time**
- Server-Sent Events (SSE) for token-by-token text generation
- Users see AI writing in real-time — no waiting for complete responses

**Agentic Tool Use**
- Design and roadmap chats use Claude's tool-use capability
- AI can apply design changes, modify book structure, and manage images through structured tool calls
- Multi-turn loops (up to 5 iterations) for complex operations

**Smart Cost Optimization**
- Prompt caching on static system prompts (reduces repeat costs)
- Conversation history compression for long chat sessions
- Automatic model routing: Sonnet ($3/$15 per M tokens) for writing, Haiku ($0.25/$1.25 per M tokens) for chat
- Result: **90% cost reduction** on lightweight operations

**Style Injection**
- Writing Twin profiles are injected into every generation prompt
- AI receives: tone, vocabulary level, sentence structure, formality score, rhetorical approach
- Output matches the author's voice, not generic AI text

> **Speaker Notes:** The RAG pipeline is key for academic credibility — every claim can be traced back to a source. The dual-model strategy is key for unit economics — most chat interactions use Haiku at 1/12th the cost of Sonnet.

---

## Slide 9: Target Market

### Who writes books?

**Primary: Academic Writers & Researchers**
- 8M+ active researchers worldwide
- Pain: citation management, source organization, formatting standards
- Hook: ISNAD citation support (unique for Turkish/Islamic scholarship), Zotero integration
- Entry market: Turkish academic institutions

**Secondary: Non-Fiction Authors**
- 2M+ self-published books/year on Amazon alone
- Pain: structure planning, research organization, professional formatting
- Hook: end-to-end workflow from outline to export

**Tertiary: Fiction & Story Writers**
- Growing AI-assisted creative writing market
- Pain: maintaining consistency, character development, illustration
- Hook: AI illustrations, character management, style preservation

**Expansion: Publishers & Institutions**
- B2B offering for publishing houses and universities
- Standardized workflows, team features, template libraries

**Language Coverage:** 50+ languages supported — from English and Turkish to Arabic, Persian, Chinese, Japanese, German, French, and more.

> **Speaker Notes:** Start with Turkish academic market — it's underserved (no tools support ISNAD citations), and we have a unique advantage. Expand from there to global academic and then consumer markets.

---

## Slide 10: Business Model

### Credit-based, usage-proportional pricing

**How credits work:**
1 credit = 1,000 weighted tokens. Operations are pre-priced based on typical usage:

| Operation | Credits | What it does |
|-----------|---------|-------------|
| Write a subsection | 300 | AI generates one section of your book |
| Generate book roadmap | 400-1,400 | Creates complete book structure (varies by source density) |
| Roadmap chat message | 200 | Refine structure through conversation |
| AI illustration | 150 | Generate character, scene, or cover image |
| Design chat | 10 | Interactive book design conversation |
| Style analysis | 5 | Learn from your writing sample |
| Bibliography enrichment | 3 | AI-powered metadata completion |

**Pricing tiers:**

| Tier | Credits | Target |
|------|---------|--------|
| **Free** | 1,500 | Try the platform, write a few sections |
| **Writer** | TBD | Individual authors, monthly subscription |
| **Academic** | TBD | Researchers with Zotero + citation needs |
| **Institution** | TBD | Universities and publishers, team features |

**Unit economics advantage:**
Smart model routing automatically uses Haiku ($0.25/M input) instead of Sonnet ($3/M input) for lightweight operations — **reducing AI costs by up to 90%** on chat, design, and style operations.

> **Speaker Notes:** The credit model is transparent and fair — users pay for what they use. The dual-model strategy means our margins improve as we route more operations to Haiku without quality loss. Key metric: average book (~50 subsections) costs roughly 15,000-20,000 credits.

---

## Slide 11: Competitive Landscape

### Quilpen vs. the alternatives

| Capability | Quilpen | Jasper | Notion AI | Scrivener | Google Docs + Gemini |
|-----------|---------|--------|-----------|-----------|---------------------|
| AI Content Generation | Source-aware RAG | Generic | Generic | None | Generic |
| Writing Style Learning | Writing Twin profiles | Brand voice (basic) | None | None | None |
| Citation Management | 9 formats + Zotero | None | None | None | None |
| Book Structure Planning | AI roadmap chat | None | Basic | Manual | None |
| AI Illustrations | Imagen 4 integrated | None | None | None | Separate tool |
| Book Design | Interactive AI chat | None | None | Basic compile | None |
| PDF/DOCX Export | Professional with images | None | Basic | Yes | Basic |
| Source/PDF Management | Upload + RAG search | None | None | Research folder | None |
| Academic Focus | Full (ISNAD, BibTeX) | None | None | None | None |
| Multi-language | 50+ languages | Limited | Limited | Limited | Good |

**Key differentiators:**
1. **Only platform** with source-aware RAG writing (AI cites your actual sources)
2. **Only platform** with Writing Twin style preservation
3. **Only platform** combining AI writing + illustrations + design + export
4. **Only platform** with ISNAD and 8 other citation formats built-in

> **Speaker Notes:** The competitive moat is the integration depth. Competitors do one thing well — Scrivener for organizing, Jasper for generating, Zotero for citations. Quilpen does all of it in one context-aware platform. No one else has source-grounded AI writing with style preservation.

---

## Slide 12: Product Roadmap

### Where we're going

**Q2 2026 — Public Beta**
- Beta launch with early adopter program
- User feedback collection and iteration
- Performance optimization and stress testing
- Marketing site and onboarding flow

**Q3 2026 — Collaboration & Growth**
- Real-time collaboration (multiple authors on one project)
- Publisher integration APIs
- Advanced analytics (writing stats, productivity insights)
- Mobile-responsive writing experience

**Q4 2026 — Marketplace & Scale**
- Template marketplace (book structures, style profiles, design presets)
- Team/organization accounts
- Advanced export options (ePub, Kindle-ready formats)
- Expanded AI model options

**2027 — Platform & Enterprise**
- Public API/SDK for third-party integrations
- B2B publishing house solution
- White-label offering for institutions
- Advanced multi-author workflows
- Expanded language-specific features

> **Speaker Notes:** We're shipping fast — major new feature every 2-3 days. The roadmap is aggressive but grounded in our current velocity. Collaboration is the #1 requested feature for academic use cases (advisor-student workflows).

---

## Slide 13: Traction & Development Velocity

### Built fast. Shipping faster.

**Development Metrics:**
- **Commit frequency:** 2-4 commits per day, consistent over 50+ days
- **Feature velocity:** Major feature shipped every 2-3 days
- **Codebase:** 156+ TypeScript files, 25+ database models, 30+ API endpoints

**Recent Feature Launches (Last 8 Weeks):**
- Complete AI illustration system (character + scene + cover generation)
- Credit-based usage system with transparent pricing
- Interactive book design chat with AI tool-use
- Multi-format PDF export with Turkish character support
- Persistent operation tracking (resume interrupted writes)
- Writing style profiling with sample analysis
- Zotero OAuth integration for bibliography sync
- Performance optimization: 90% cost reduction via model routing

**Production Infrastructure:**
- PostgreSQL on Railway (production-grade)
- Google OAuth + Zotero OAuth (live integrations)
- Python microservice for heavy processing (PDF, embeddings, DOCX)
- Docker-ready deployment

> **Speaker Notes:** The velocity tells the story — one developer building a production-grade platform with this feature set in under 2 months. This demonstrates both technical capability and product vision clarity. With funding, imagine what a small team could do.

---

## Slide 14: The Ask

### Let's forge the future of writing together.

**We're raising to:**
- Scale infrastructure for beta launch
- Build the founding team (frontend, AI/ML, growth)
- Launch marketing and early adopter acquisition
- Develop collaboration and marketplace features

**Use of funds:**
- **40%** — Engineering team expansion
- **25%** — AI infrastructure and compute costs
- **20%** — Marketing and user acquisition
- **15%** — Operations and runway

**What we've proven:**
- Full product built and functional (not a prototype)
- Production infrastructure live
- Complex AI architecture working (RAG, style learning, tool-use agents)
- Clear market gap (no integrated book-writing AI platform exists)

---

**Quilpen**
*Forge Your Words*

Contact: [email / website / social]

> **Speaker Notes:** End with confidence — this isn't a slide deck for an idea. The product exists, works, and is shipping features daily. The ask is to pour fuel on a fire that's already burning.

---

## Appendix: Key Data Points Reference

These numbers are verified from the codebase:

- **Citation formats:** 9 (ISNAD, APA, Chicago, MLA, Harvard, Vancouver, IEEE, AMA, Turabian)
- **AI models:** Claude Sonnet 4.6 (writing), Claude Haiku 4.5 (chat), Google Imagen 4 (images)
- **Credit costs:** Write=300, Roadmap=400-1400, Image=150, Design chat=10, Style=5
- **Database models:** 25+ (User, Project, Chapter, Section, Subsection, Source, SourceChunk, Bibliography, etc.)
- **API endpoints:** 30+ covering all features
- **Languages:** 50+ supported
- **Project types:** Academic, Book, Story
- **Export formats:** DOCX, PDF (with Google Drive upload)
- **Tech stack:** Next.js 15, React 19, TypeScript, PostgreSQL + pgvector, Prisma 7.5, FastAPI
