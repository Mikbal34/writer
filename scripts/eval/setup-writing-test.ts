/**
 * Yazı endpoint eval için test verisi yaratır.
 *
 * - "WRITING_EVAL_TEST" adında bir proje açar (varsa idempotent: aynı id kullan)
 * - 1 Chapter / 1 Section
 * - 5 subsection (Spesifik × 2, Tematik, Karşılaştırmalı, Antropoloji)
 * - Her subsection için ilgili kütüphane kitaplarını
 *   Bibliography + SourceMapping ile bağlar.
 *
 * Çalıştırma: VM üzerinden, çünkü DATABASE_URL docker network'te.
 *   scp + docker cp + node script
 * Veya: PSQL ile direkt SQL üret + apply (daha güvenilir, kullanıyoruz).
 *
 * Maliyet: $0 (sadece DB write).
 */
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const USER_ID = "cmn1ulqtk00030purt66j5ow6"; // beratok2312

const SSH = "ssh -i ~/.ssh/quilpen.pem azureuser@4.180.10.105";
const PSQL = "sudo docker exec quilpen-postgres-1 psql -U quilpen -d quilpen";

// 5 subsection — her birine bağlanacak kütüphane kitaplarının author + title hint'leri.
// resolve_expected.py mantığıyla DB'de match edip libraryEntryId çekeceğiz.
const SUBSECTIONS: Array<{
  subsectionId: string;
  title: string;
  description: string;
  keyPoints: string[];
  category: "specific" | "thematic" | "comparative";
  expectedBooks: Array<{ surname: string; titleHint: string }>;
}> = [
  {
    subsectionId: "1.1.1",
    title: "Mâtürîdî'nin Tevhid Argümanı",
    description:
      "Mâtürîdî, Kitâbü't-Tevhîd'de Allah'ın varlığı ve birliğini akıl ile temellendirir. Hudûs delili ve illet-sebep ilişkisi temel argümanlardır. Mu'tezile ve Eş'arî farkları belirtilmeli.",
    keyPoints: ["Hudûs delili", "İllet-sebep ilişkisi", "Mu'tezile/Eş'arî farkı"],
    category: "specific",
    expectedBooks: [
      { surname: "Mâtürîdî", titleHint: "Tevhîd" },
      { surname: "Ebu'l-Muîn en-Nesefî", titleHint: "Tebsıra" },
      { surname: "Rudolph", titleHint: "Maturidi" },
    ],
  },
  {
    subsectionId: "1.1.2",
    title: "Gazzâlî'nin Kuşku Metodu",
    description:
      "Gazzâlî el-Münkız mine'd-Dalâl'de bilgiyi yeniden temellendirmek için sistematik kuşku metodunu uygular. Tasavvufa varış sürecini anlatır.",
    keyPoints: ["Sistematik kuşku", "Bilgi türleri", "Tasavvufa yöneliş"],
    category: "specific",
    expectedBooks: [
      { surname: "Gazzâlî", titleHint: "Münkız" },
      { surname: "Frank", titleHint: "Ash'arite" },
      { surname: "Griffel", titleHint: "Al-Ghaz" },
    ],
  },
  {
    subsectionId: "1.1.3",
    title: "Klasik Kelâm Geleneğinde Allah'ın Sıfatları",
    description:
      "Klasik kelâm geleneğinde Allah'ın zâtî ve subûtî sıfatları nasıl ele alınır. Mâtürîdî, Eş'arî ve sonraki müfessirlerin yaklaşımları karşılaştırılmalı.",
    keyPoints: ["Zâtî sıfatlar", "Subûtî sıfatlar", "Mâtürîdî-Eş'arî yaklaşım farkı", "Müteahhirûn dönemi"],
    category: "thematic",
    expectedBooks: [
      { surname: "Mâtürîdî", titleHint: "Tevhîd" },
      { surname: "Bâkıllânî", titleHint: "Temhîd" },
      { surname: "Cüveynî", titleHint: "İrşâd" },
      { surname: "Seyyid Şerîf el-Curcânî", titleHint: "Mevâkıf" },
      { surname: "Sa'düddîn et-Teftâzânî", titleHint: "Şerhu'l-Akāid" },
    ],
  },
  {
    subsectionId: "1.1.4",
    title: "Wolfson ve Frank'ın Eş'arî Kelâm Yorumları Arasındaki Fark",
    description:
      "Wolfson ve Frank Eş'arî kelâm'ı farklı perspektiflerden incelemiştir. İki yaklaşımın temel farkları, eşrâfî düşünce yapısına bakışları karşılaştırılmalı.",
    keyPoints: ["Wolfson'un atomism yorumu", "Frank'ın okul-bazlı yorumu", "Metodolojik fark"],
    category: "comparative",
    expectedBooks: [
      { surname: "Wolfson", titleHint: "Philosophy of the Kalam" },
      { surname: "Frank", titleHint: "Ash'arite" },
    ],
  },
  {
    subsectionId: "1.1.5",
    title: "Hammoudi'nin A Season in Mecca'da Hac Antropolojisi",
    description:
      "Hammoudi, hac deneyimini fenomenolojik ve antropolojik perspektifle analiz eder. Hacı bireyinin dönüşümü, kolektif ritüel deneyim ön planda.",
    keyPoints: ["Fenomenolojik analiz", "Ritüel deneyim", "Bireysel dönüşüm"],
    category: "specific",
    expectedBooks: [
      { surname: "Hammoudi", titleHint: "Season in Mecca" },
      { surname: "Bianchi", titleHint: "Guests of God" },
      { surname: "Eickelman", titleHint: "Muslim Travellers" },
    ],
  },
];

// CUID-like ID generator
function cuid(prefix = "test"): string {
  const h = createHash("sha256")
    .update(`${prefix}-${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 22);
  return `c${h}`;
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

interface ResolvedSubsection {
  subsection: (typeof SUBSECTIONS)[number];
  libraryEntryIds: Array<{ libraryEntryId: string; titleResolved: string; authorSurname: string }>;
}

async function main() {
  console.log("▶ Setup: WRITING_EVAL_TEST proje + 5 subsection\n");

  // 1. Lokal entries dump (id|surname|title) — match lokal yapılır
  const entriesRaw = readFileSync("/tmp/_beratok-entries.txt", "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [id, surname, title] = l.split("|");
      return { id, surname, title };
    });
  console.log(`◇ Lokal entries: ${entriesRaw.length}`);

  const norm = (s: string) =>
    s
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[''‛`]/g, "")
      .replace(/[âā]/g, "a")
      .replace(/[îī]/g, "i")
      .replace(/[ûū]/g, "u");

  console.log("◇ Library entry ID'leri çözümleniyor...");
  const resolved: ResolvedSubsection[] = [];
  for (const sub of SUBSECTIONS) {
    const entries: Array<{ libraryEntryId: string; titleResolved: string; authorSurname: string }> = [];
    for (const book of sub.expectedBooks) {
      const ns = norm(book.surname);
      const nt = norm(book.titleHint);
      const m = entriesRaw.find((e) => norm(e.surname).includes(ns) && norm(e.title).includes(nt));
      if (m) {
        entries.push({ libraryEntryId: m.id, titleResolved: m.title, authorSurname: m.surname });
      } else {
        console.warn(`  ⚠ Bulunamadı: ${book.surname} / ${book.titleHint}`);
      }
    }
    console.log(`  ${sub.subsectionId} (${sub.category}): ${entries.length}/${sub.expectedBooks.length} kitap`);
    resolved.push({ subsection: sub, libraryEntryIds: entries });
  }
  console.log();

  // 2. SQL üret
  const projectId = cuid("proj");
  const chapterId = cuid("chap");
  const sectionId = cuid("sec");

  const lines: string[] = [
    "BEGIN;",
    "-- Cleanup: önceki test projesi (varsa)",
    `DELETE FROM "Project" WHERE "userId"='${USER_ID}' AND title='WRITING_EVAL_TEST';`,
    "",
    "-- Project",
    `INSERT INTO "Project" (id, "userId", title, language, "projectType", "citationFormat", "updatedAt") VALUES (`,
    `  '${projectId}', '${USER_ID}', 'WRITING_EVAL_TEST', 'tr', 'ACADEMIC', 'ISNAD', NOW()`,
    `);`,
    "",
    "-- Chapter",
    `INSERT INTO "Chapter" (id, "projectId", number, title, "sortOrder") VALUES (`,
    `  '${chapterId}', '${projectId}', 1, 'Test Chapter', 1`,
    `);`,
    "",
    "-- Section",
    `INSERT INTO "Section" (id, "chapterId", "sectionId", title, "keyConcepts", "sortOrder") VALUES (`,
    `  '${sectionId}', '${chapterId}', '1.1', 'Test Section', ARRAY[]::text[], 1`,
    `);`,
    "",
  ];

  let sortOrder = 1;
  for (const r of resolved) {
    const subId = cuid("sub");
    const keyPointsArr = r.subsection.keyPoints.map((p) => `'${escSql(p)}'`).join(",");
    lines.push(`-- Subsection ${r.subsection.subsectionId}: ${r.subsection.title}`);
    lines.push(
      `INSERT INTO "Subsection" (id, "sectionId", "subsectionId", title, description, "keyPoints", status, "sortOrder") VALUES (`,
    );
    lines.push(
      `  '${subId}', '${sectionId}', '${r.subsection.subsectionId}', '${escSql(r.subsection.title)}', '${escSql(r.subsection.description)}', ARRAY[${keyPointsArr}]::text[], 'pending', ${sortOrder++}`,
    );
    lines.push(`);`);

    // Bibliography + SourceMapping
    for (const entry of r.libraryEntryIds) {
      const bibId = cuid("bib");
      lines.push(
        `INSERT INTO "Bibliography" (id, "projectId", "libraryEntryId", "entryType", "authorSurname", title) VALUES (`,
      );
      lines.push(
        `  '${bibId}', '${projectId}', '${entry.libraryEntryId}', 'kitap', '${escSql(entry.authorSurname)}', '${escSql(entry.titleResolved)}'`,
      );
      lines.push(`);`);
      lines.push(
        `INSERT INTO "SourceMapping" (id, "subsectionId", "bibliographyId", priority) VALUES (`,
      );
      lines.push(
        `  '${cuid("map")}', '${subId}', '${bibId}', 'primary'`,
      );
      lines.push(`);`);
    }
    lines.push("");
  }

  lines.push("COMMIT;");
  lines.push("");
  lines.push(`SELECT id, title FROM "Project" WHERE id='${projectId}';`);
  lines.push(`SELECT COUNT(*) as subsections FROM "Subsection" sub JOIN "Section" s ON sub."sectionId"=s.id JOIN "Chapter" c ON s."chapterId"=c.id WHERE c."projectId"='${projectId}';`);

  const sqlPath = "/tmp/writing-test-setup.sql";
  writeFileSync(sqlPath, lines.join("\n"));
  console.log(`◇ SQL üretildi: ${sqlPath} (${lines.length} satır)`);

  // 3. Apply on VM
  console.log("◇ SQL uygulanıyor...");
  execSync(`scp -i ~/.ssh/quilpen.pem ${sqlPath} azureuser@4.180.10.105:/tmp/`, { stdio: "ignore" });
  const applyCmd = `${SSH} 'sudo docker cp /tmp/writing-test-setup.sql quilpen-postgres-1:/tmp/ && ${PSQL} -f /tmp/writing-test-setup.sql 2>&1 | tail -8'`;
  const out = execSync(applyCmd, { encoding: "utf-8" });
  console.log(out);

  // 4. Project ID'yi kaydet — eval runner kullansın
  writeFileSync("/Users/ikbalkoc/Desktop/writer_agent/scripts/eval/writing-test-project-id.txt", projectId);
  console.log(`✓ Test proje ID kaydedildi: ${projectId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
