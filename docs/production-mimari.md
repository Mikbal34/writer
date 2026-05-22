# Quilpen — Production Mimarisi & Taşıma Planı

> Hedef: **büyümeye hazır** bir foundation, **küçük başla** (~10 eşzamanlı),
> büyüme = düğme çevirmek (replica/worker/tier), yeniden yazmak değil.
> Kriter: **maliyet aşağı, kalite yukarı.** Her ağır iş kuyruk arkasında,
> her dış servis decoupled + funded.
>
> Bu doküman, prototipte yaşanan gerçek kırılmalardan türetildi
> (saturation, embed timeout, escalation kapsama-kaçağı, free-tier blok —
> bkz. [[ocr-batch-production-lessons]], [[ocr-mimari]]).

## 1. İlke: interaktif ile ağır-işleme AYRI

Şu anki çöküşlerin kökü: web + OCR + embed aynı süreçte (`setImmediate`).
Production'da ikisi ayrılır; aralarında **kuyruk** durur.

```
Kullanıcı → Cloudflare (CDN/DNS, ücretsiz)
   │
   ▼
WEB (Next.js, stateless, autoscale)
   ├─ okuma/yazma ──────────────→ Postgres + pgvector (Neon, serverless)
   ├─ dosya yükle/oku ──────────→ Object Storage (Cloudflare R2, egress=0)
   ├─ RAG chat / yazım SSE ─────→ Claude (Sonnet) + embed servisi
   └─ PDF upload → KUYRUĞA at, anında "işleniyor" dön (ms)
                       │
                       ▼
                  Redis kuyruk (Upstash, serverless)
                       │
                       ▼
WORKER havuzu (ayrı servis, autoscale) ── kuyruktan kontrollü çeker
   ├─ dosyayı R2'den al
   ├─ extract: pdfjs → Tesseract(Latin) → Surya(zor script / DÜŞÜK KAPSAMA)
   ├─ chunk → embed (merkezî throttle)
   ├─ Postgres'e yaz + her aşama checkpoint (idempotent, resumable)
   └─ retry/backoff, status güncelle
   │
   ├─ GPU OCR ───→ Modal (Surya, serverless, scale-to-zero)
   └─ embed ─────→ [KARAR: aşağıda]
```

## 2. Sağlayıcı seçimi (cost ↓ / quality ↑)

Her seçimde mantık: **kullanmadığında ödeme (scale-to-zero) + düğmeyle büyü.**

| Bileşen | Seçim | Neden (maliyet + kalite) |
|---|---|---|
| **CDN/DNS** | **Cloudflare** | Ücretsiz, önde durur, DDoS/cache |
| **Web + Worker** | **Fly.io** (alt: Render) | Machine'ler scale-to-zero/küçük başlar; SSE/uzun yazım için persistent (Vercel serverless timeout'u SSE'yi keser); worker native; düşük başlangıç maliyeti, düğmeyle büyür |
| **Postgres + pgvector** | **Neon** | Serverless Postgres, **scale-to-zero** (boşta ~$0), pgvector native, dal/branch desteği; tier'la büyür — düşük başlangıç, sınırsız büyüme |
| **Object storage** | **Cloudflare R2** | **Egress ÜCRETSİZ** (PDF servis ederken S3'e göre dev tasarruf), ucuz depolama |
| **Kuyruk (Redis)** | **Upstash** | Serverless Redis, istek-başı ödeme, scale-to-zero, cömert free tier |
| **GPU OCR** | **Modal** (mevcut) | Serverless, scale-to-zero, kullandıkça öde; Surya = Arapça'da gold |
| **Embedding** | **BGE-M3** (açık kaynak, MIT) — worker CPU'da, `vector(1024)` | per-call $0, çok-dilli gold, blok/kota YOK, GPU bile gerekmez (bkz. §3) |
| **LLM (yazım)** | **Claude Sonnet** | Kalite/maliyet dengesi (Opus reddedildi — [[feedback_writing_model]]) |

> **AWS gerekmiyor.** Bu stack production-grade ve devasa ölçeğe çıkar.
> AWS = erken karmaşıklık (VPC/IAM/ECS ops) + scale-to-zero olmadığı için
> boşta yanan maliyet. Decoupled mimari sayesinde, ileride gerçekten gerekirse
> parça parça taşınır (lock-in yok). Bugün gereksiz.

**Neden Fly.io > Render > Railway:** Fly machine'leri kullanılmadığında durur (maliyet ↓), worker'lar bağımsız ölçeklenir, persistent (SSE sorunsuz). Render daha kolay ama biraz pahalı/az esnek. Railway'de yaşadığımız flakiness + "no persistent FS" sorunları. *(Render de geçerli alternatif — DX daha basit istiyorsan.)*

## 3. Embedding: BGE-M3 (KARAR VERİLDİ ✅)

Free-tier Gemini bizi **blokladı** (93k embed/gün → 403). Çözüm: **sahip
olunan, açık kaynak embedding** = **BGE-M3** (BAAI, **MIT lisans**, HuggingFace
`BAAI/bge-m3`).

- **Maliyet:** per-call **$0** (vendor yok, kota yok, blok yok)
- **Kalite:** 100+ dil, 8192 token, Arapça/Türkçe'de gold — Gemini-001'e eşit/üstün
- **Önemli:** **GPU bile gerekmez** — query embedding kısa metin, CPU'da ~300ms.
  Bulk embedding worker'da CPU'da, async/kuyruklu.
- **Nerede:** **worker'ın içinde CPU** (ayrı GPU/servis YOK). Modal sadece OCR için.
- **Boyut:** dense **1024-dim** → pgvector kolonu `vector(768)` → **`vector(1024)`**
  yapılır + HNSW yeniden kurulur + 114k chunk re-embed (tek seferlik, Faz 3).
- **Kütüphane:** `FlagEmbedding` veya `sentence-transformers`.

Gemini tamamen bırakılır — hem ücret hem blok riski biter, kalite artar.

## 4. Ölçekleme düğmeleri (kod değil, config)

| Düğme | Gün-1 (~10 kişi) | Büyüyünce |
|---|---|---|
| Web replica | 1-2 | 4-8 (autoscale) |
| Worker | 2 | 8-16 |
| Neon compute | min (scale-to-zero) | büyük tier |
| Modal max_containers | 4 | 20+ |
| Embed throttle | düşük | yüksek |
| Worker concurrency | 2-3 | env ile artır |

**Kuyruk garantisi:** 2 worker'la bile 100 kişi aynı anda upload etse çökmez — kuyruğa girer, sırayla akar ("işleniyor"). van Ess saturation'ı bir daha olmaz.

## 5. Routing düzeltmesi (worker mantığına gömülü)

Prototipte escalation **kapsama**yı kaçırdı (Almanca: az ama emin kelime → confidence yüksek → Surya'ya çıkmadı → seyrek çöp). Production'da:
- **Kapsama-bazlı escalation:** sayfa-başı-karakter / beklenen-yoğunluk düşükse → Surya (sadece confidence değil)
- **Script→motor haritası:** Latin(eng/tur/deu) → Tesseract uygun dil; zor script/düşük-kapsama → Surya
- Tesseract dil paketleri: `eng+tur+ara+deu+fra` (Docker'a ekle)

## 6. Taşıma planı (kesintisiz, fazlı)

**Faz 0 — İskelet (kod yok, hesap/servis kur):**
- Fly.io org + Neon proje (pgvector) + R2 bucket + Upstash Redis + Cloudflare DNS

**Faz 1 — Veri:**
- Postgres'i Neon'a taşı (dump/restore, pgvector dahil)
- PDF'leri R2'ye taşı (mevcut storage → R2)

**Faz 2 — Worker + kuyruk:**
- Ingestion'ı `setImmediate`'ten **BullMQ kuyruk + worker servisi**ne çıkar
- Per-aşama checkpoint + idempotent + retry (resumable)

**Faz 3 — Embedding (BGE-M3, worker CPU):**
- BGE-M3'ü worker'a göm (FlagEmbedding/sentence-transformers, CPU)
- pgvector kolonu `vector(768)` → `vector(1024)`, HNSW yeniden kur
- 114k chunk'ı re-embed (tek seferlik)
- Query embedding endpoint'i (chat sorgusu için, CPU ~300ms)

**Faz 4 — App:**
- Next.js'i Fly'a deploy (web service), worker'ı ayrı service
- PgBouncer (bağlantı havuzu)

**Faz 5 — Routing + diller:**
- Kapsama-bazlı escalation + Tesseract dil paketleri (deu/fra)

**Faz 6 — Kesme:**
- Cloudflare DNS'i Fly'a çevir, Railway'i kapat

## 7. Maliyet şekli

- **Sabit (gün-1, ~10 kişi):** Fly küçük + Neon scale-to-zero + R2 + Upstash free ≈ **~$20-50/ay**
- **Büyüyünce:** tier'lar artar, lineer
- **Değişken:** Claude (yazım, asıl kalem) + Modal (OCR+embed, azınlık yol) → abonelik fiyatına gömülür
- **Self-host embed (BGE-M3, CPU) sayesinde:** embedding **per-call $0** (GPU bile yok, worker CPU'su) — Gemini'nin token maliyeti ve blok riski tamamen biter

## 8. Sahip olunan dayanıklılık ilkeleri (gün-1'den)
- Stateless web + kuyruk + worker → backpressure, çökme yok
- Her ağır iş checkpoint'li + idempotent + retry → kayıp yok
- Decoupled servisler (OCR/embed Modal, LLM Claude) → biri çökse fallback/swap
- Funded + sahip olunan (self-host embed) → free-tier blok yok
- Config-driven ölçek → büyüme dakikalar
