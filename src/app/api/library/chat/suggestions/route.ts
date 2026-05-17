import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

/**
 * GET /api/library/chat/suggestions
 *
 * Returns 4 short Turkish prompts to seed the LibraryChat empty-welcome
 * state. Generated from the user's actual library so authors/works the
 * AI mentions are ones the user can actually pull up — no hallucinated
 * book recommendations.
 *
 * No credit charge: this is a UX warm-up call, Haiku is cheap, capped
 * input by sampling at most 12 entries. If the user has zero entries
 * we skip the AI call entirely and return generic prompts.
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

const SYSTEM = `Sen bir akademik araştırma asistanısın. Kullanıcının dijital kütüphanesindeki kitap/makale listesinden hareketle, kütüphane sohbetinde sorabileceği 4 kısa, somut, Türkçe soru üreteceksin.

Kurallar:
- Her soru en fazla 110 karakter.
- Sorular kullanıcının kütüphanesindeki gerçek yazar isimlerine veya başlık temalarına atıfta bulunsun. Var olmayan kaynak uydurma.
- 4 farklı tür kullan: (1) iki kaynak arası karşılaştırma, (2) belirli bir yazarın tezi, (3) bir konuya tavsiye/öneri, (4) tematik özet.
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

export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const entries = await prisma.libraryEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
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

    const inventoryBlock = entries
      .map((e, i) => {
        const author = e.authorName
          ? `${e.authorName} ${e.authorSurname}`
          : e.authorSurname;
        const year = e.year ? ` (${e.year})` : "";
        return `${i + 1}. ${author} — ${e.title}${year} [${e.entryType}]`;
      })
      .join("\n");

    const prompt = `Kullanıcının kütüphanesindeki ${entries.length} kaynak:

${inventoryBlock}

Şimdi bu kaynaklara atıfta bulunan 4 farklı soru üret.`;

    try {
      const result = await generateJSONWithUsage<{ suggestions: unknown }>(
        prompt,
        SYSTEM,
        { model: HAIKU },
      );
      return NextResponse.json({
        suggestions: normalize(result.data),
        source: "ai",
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
