import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

/**
 * GET /api/library/chat/suggestions?entryId=<id>
 *
 * Returns 4 short Turkish prompts to seed the LibraryChat empty-welcome
 * state. Two modes:
 *
 *  - entryId given → "single-book" mode: pull 6 sample chunks from
 *    that entry and ask Haiku for 4 questions that are answerable
 *    *directly* from those passages. This is what the per-book chat
 *    surface (`/library/chat?entryId=…`) uses, so the suggestions
 *    aren't generic "ana iddialarını özetle"s — they reference
 *    concepts the book actually discusses.
 *
 *  - no entryId → "library-wide" mode: sample up to 8 recent entries
 *    plus 1 chunk per entry, ask for 4 questions spanning the corpus.
 *
 * No credit charge; Haiku is cheap and the input is capped.
 */

const ICONS = ["quote", "note", "sparkles", "highlighter"] as const;
type Icon = (typeof ICONS)[number];

interface Suggestion {
  icon: Icon;
  text: string;
}

const FALLBACK: Suggestion[] = [
  {
    icon: "quote",
    text: "Kütüphanene bir kitap eklediğinde, ana iddialarını birkaç cümleyle özetleyebilirim.",
  },
  {
    icon: "note",
    text: "Önce birkaç PDF yükle — sonra hangi kaynakların birbiriyle çeliştiğini gösterebilirim.",
  },
  {
    icon: "sparkles",
    text: "Bir konu seç — sana o konuda kütüphanende eksik kalan perspektifleri söyleyeyim.",
  },
  {
    icon: "highlighter",
    text: "Bir bölümün önemli pasajlarını bulup alıntılayabilirim.",
  },
];

const SYSTEM_LIBRARY = `Sen bir akademik araştırma asistanısın. Kullanıcının dijital kütüphanesindeki kitap/makale listesinden ve her birinden alınmış birer örnek pasajdan hareketle, kütüphane sohbetinde sorabileceği 4 kısa, somut, Türkçe soru üreteceksin.

Kurallar:
- Her soru en fazla 110 karakter.
- Sorular kullanıcının kütüphanesindeki gerçek yazar isimlerine veya pasajlarda geçen somut kavramlara/argümanlara atıfta bulunsun. Var olmayan kaynak uydurma.
- 4 farklı tür kullan: (1) iki kaynak arası karşılaştırma, (2) belirli bir yazarın pasajdaki tezi, (3) pasajda geçen bir kavramın açıklaması, (4) tematik bağlantı.
- Türkçe akademik üslup — diakritikleri koru (İ, ı, ğ, ş, ç, ü, ö).
- Soru işareti veya emir kipi ile bit.

Çıktıyı şu JSON şemasında ver:
{
  "suggestions": [
    { "icon": "quote", "text": "..." },
    { "icon": "note", "text": "..." },
    { "icon": "sparkles", "text": "..." },
    { "icon": "highlighter", "text": "..." }
  ]
}

Icon değerleri kesinlikle "quote" | "note" | "sparkles" | "highlighter" olmalı.`;

const SYSTEM_SINGLE = `Sen bir akademik araştırma asistanısın. Sana TEK BİR kitap/makaleden alınmış birkaç pasaj verilecek. Bu pasajlardan hareketle, okurun bu kaynak hakkında sorabileceği 4 kısa, somut, Türkçe soru üreteceksin.

Kurallar:
- Her soru en fazla 120 karakter.
- HER SORU, verilen pasajlardaki somut kavramlara, isimlere veya argümanlara DOĞRUDAN bağlı olmalı. Genel "ana iddiası nedir" tipi sorular YAZMA — pasajda geçen spesifik bir terimi, ismi veya iddiayı sorgula.
- Sorular kitabın FARKLI yönlerini kapsasın (tek konuda kümelenmesin): 4 ayrı pasajdan ilham al.
- Türkçe akademik üslup — diakritikleri koru.
- Soru işareti ile bit.

Çıktıyı şu JSON şemasında ver:
{
  "suggestions": [
    { "icon": "quote", "text": "..." },
    { "icon": "note", "text": "..." },
    { "icon": "sparkles", "text": "..." },
    { "icon": "highlighter", "text": "..." }
  ]
}`;

function normalize(raw: unknown): Suggestion[] {
  if (!raw || typeof raw !== "object") return FALLBACK;
  const list = (raw as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(list)) return FALLBACK;
  const cleaned = list
    .map((s, i): Suggestion | null => {
      if (!s || typeof s !== "object") return null;
      const obj = s as { icon?: unknown; text?: unknown };
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text) return null;
      const icon = (ICONS as readonly string[]).includes(obj.icon as string)
        ? (obj.icon as Icon)
        : ICONS[i % ICONS.length];
      return { icon, text: text.slice(0, 140) };
    })
    .filter((x): x is Suggestion => x !== null);
  return cleaned.length === 4 ? cleaned : FALLBACK;
}

// Trim a chunk's content to ~`max` chars on a word boundary, so the
// Haiku prompt stays small without cutting mid-word.
function snippet(content: string, max = 240): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const entryId = new URL(req.url).searchParams.get("entryId");

    // ── Single-book mode ────────────────────────────────────────
    if (entryId) {
      const entry = await prisma.libraryEntry.findFirst({
        where: { id: entryId, userId },
        select: {
          title: true,
          authorSurname: true,
          authorName: true,
          year: true,
        },
      });
      if (!entry) {
        return NextResponse.json({ suggestions: FALLBACK, source: "fallback" });
      }
      // Pull a few chunks spread across the book. ORDER BY random()
      // would do but pgvector tables can be big; use ORDER BY
      // chunkIndex with a modulo trick to sample evenly.
      const chunks = await prisma.libraryChunk.findMany({
        where: { libraryEntryId: entryId },
        orderBy: { chunkIndex: "asc" },
        select: { content: true, pageNumber: true, chunkIndex: true },
      });
      if (chunks.length === 0) {
        return NextResponse.json({ suggestions: FALLBACK, source: "fallback" });
      }
      // Even-spaced sample of 6 chunks across the book.
      const sampleCount = Math.min(6, chunks.length);
      const step = Math.max(1, Math.floor(chunks.length / sampleCount));
      const samples = Array.from({ length: sampleCount }, (_, i) =>
        chunks[Math.min(i * step, chunks.length - 1)],
      );
      const author = entry.authorName
        ? `${entry.authorName} ${entry.authorSurname}`
        : entry.authorSurname;
      const passageBlock = samples
        .map(
          (c, i) =>
            `Pasaj ${i + 1}${c.pageNumber ? ` (s. ${c.pageNumber})` : ""}:\n"${snippet(c.content)}"`,
        )
        .join("\n\n");
      const prompt = `Kitap: ${author} — ${entry.title}${entry.year ? ` (${entry.year})` : ""}

Bu kitaptan örnek pasajlar:

${passageBlock}

Şimdi okurun bu kitap hakkında sorabileceği, yukarıdaki pasajlardaki SOMUT kavramlara/argümanlara doğrudan atıfta bulunan 4 farklı soru üret.`;

      try {
        const result = await generateJSONWithUsage<{ suggestions: unknown }>(
          prompt,
          SYSTEM_SINGLE,
          { model: HAIKU },
        );
        return NextResponse.json({
          suggestions: normalize(result.data),
          source: "ai-single",
        });
      } catch (err) {
        console.warn(
          "[suggestions] single-book Haiku failed, returning fallback",
          err,
        );
        return NextResponse.json({
          suggestions: FALLBACK,
          source: "fallback",
        });
      }
    }

    // ── Library-wide mode ───────────────────────────────────────
    const entries = await prisma.libraryEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        authorSurname: true,
        authorName: true,
        title: true,
        year: true,
        entryType: true,
      },
    });

    if (entries.length === 0) {
      return NextResponse.json({ suggestions: FALLBACK, source: "fallback" });
    }

    // Pull one mid-book chunk per entry so Haiku sees what each
    // source actually says, not just its title.
    const sampleChunks = await Promise.all(
      entries.map(async (e) => {
        const total = await prisma.libraryChunk.count({
          where: { libraryEntryId: e.id },
        });
        if (total === 0) return null;
        const skip = Math.floor(total / 2);
        const c = await prisma.libraryChunk.findFirst({
          where: { libraryEntryId: e.id },
          orderBy: { chunkIndex: "asc" },
          skip,
          select: { content: true, pageNumber: true },
        });
        return c ? { entryId: e.id, ...c } : null;
      }),
    );
    const sampleByEntry = new Map(
      sampleChunks.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => [
        c.entryId,
        c,
      ]),
    );

    const inventoryBlock = entries
      .map((e, i) => {
        const author = e.authorName
          ? `${e.authorName} ${e.authorSurname}`
          : e.authorSurname;
        const year = e.year ? ` (${e.year})` : "";
        const sample = sampleByEntry.get(e.id);
        const passage = sample
          ? `\n   Pasaj: "${snippet(sample.content, 180)}"`
          : "";
        return `${i + 1}. ${author} — ${e.title}${year} [${e.entryType}]${passage}`;
      })
      .join("\n");

    const prompt = `Kullanıcının kütüphanesindeki ${entries.length} kaynak (her birinden örnek bir pasajla):

${inventoryBlock}

Şimdi bu kaynaklara — özellikle pasajlarda geçen somut kavramlara — atıfta bulunan 4 farklı soru üret.`;

    try {
      const result = await generateJSONWithUsage<{ suggestions: unknown }>(
        prompt,
        SYSTEM_LIBRARY,
        { model: HAIKU },
      );
      return NextResponse.json({
        suggestions: normalize(result.data),
        source: "ai-library",
      });
    } catch (err) {
      console.warn("[suggestions] Haiku failed, returning fallback", err);
      return NextResponse.json({
        suggestions: FALLBACK,
        source: "fallback",
      });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/library/chat/suggestions]", err);
    return NextResponse.json(
      { suggestions: FALLBACK, source: "fallback" },
      { status: 200 },
    );
  }
}
