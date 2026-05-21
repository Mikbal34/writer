# OCR Mimarisi — Çok Kullanıcılı, Ölçeklenebilir, Maliyet-Bilinçli

> Durum: tasarım onaylandı, inşa edilecek. Tüm sayısal değerler bu repoda
> 4 örnek sayfa üzerinde gerçekten ölçüldü (bkz. "Ölçüm kanıtları").

## 1. Problem ve bağlam

Quilpen çok kullanıcılı bir akademik araştırma/yazım aracı. **Her kullanıcının
kendi kütüphanesi var** ve kullanıcılar rastgele PDF yükler. Bir PDF:

- **text-layer'lı** olabilir (dijital, metin gömülü), ya da
- **taranmış görüntü** olabilir (text yok → OCR şart).

Kullanıcı bunu bilmek zorunda değil — **sistem otomatik anlamalı ve doğru
yola yönlendirmeli.** Mevcut sistem bunu kısmen yapıyor (`needsOcr` flag'i)
ama OCR motoru **Tesseract** ve Arapça gibi zor scriptlerde çöp üretiyor;
ayrıca ingest **web sürecinin içinde** çalıştığı için çok kullanıcıda
ölçeklenmiyor.

Bu doküman iki şeyi çözer: **(a) OCR kalitesi** (script'e göre doğru motor),
**(b) ölçeklenebilirlik** (web'den ayrılmış kuyruk + worker mimarisi).

## 2. Ölçüm kanıtları (gerçek veri)

Aynı 4 taranmış sayfa üzerinde ölçüldü.

### Arapça (klasik külliyat — en zor senaryo)

| Motor | Kalite | Hız (bu Mac, CPU) | 45k sayfa | Maliyet |
|---|---|---|---|---|
| Tesseract (mevcut) | **Çöp** (`go Sey ABM`...) | hızlı | — | $0 |
| Gemini 2.5-flash | Kusursuz | API ~1-2sn | birkaç saat | **$127** |
| Gemini flash-lite | Anlam bozucu hatalı | API | birkaç saat | $18 |
| **Surya** | **Mükemmel (gold'a eş)** | 10.8 sn/yarım sf | ~6-8 sa (GPU) | **$0 lisans** |
| PaddleOCR | Orta (harf düşürüyor) | 313 sn/sf | imkansız | $0 |

Kanıt (meşhur "dağ doğurdu fare" deyimi, p-12):
- Gemini gold & **Surya**: `بالفأر الذي تمخض فولد جبلاً` ✅
- Paddle: `مخض` (harf düşmüş) — flash-lite: tamamen çöp ❌

### Latin (taranmış İngilizce — Izutsu)

Tesseract çıktısı **neredeyse kusursuz** (~%98+ kelime doğruluğu). Hatalar
sadece noktalama/dipnot üst-simgesi/transliterasyon kırıntısı
(`Watt!5`, `Jahillyah`, `ittagi`) — RAG için tamamen yeterli.

**Çıkarım:** Latin'de VLM'e gerek yok; Tesseract bedava ve yeterli. Pahalı
yol sadece zor scriptler için.

### Kaynak külliyat
- Klasik (Arapça): 82 dosya, **45,043 PDF sayfası**, %98'i taranmış (sadece
  Razi Levami + Metalib text-layer'lı). Çoğu **çift-sayfa taraması**.
- Tez (Latin): çoğu text-layer'lı; taranmış olanlar Durkheim, Hammoudi,
  Izutsu, Rudolph, Smith (EN) + Gimaret (FR).

## 3. Çekirdek karar: katmanlı OCR yönlendirme

Pahalı GPU/API yolunu **herkese değil, sadece gereken belgeye** ödüyoruz.

```
PDF yüklendi
  │
  ├─ Text-layer var mı? (pdfjs dener)
  │     └─ EVET → pdfjs metni kullan   [$0, en iyi, viewer'la birebir]
  │
  └─ HAYIR (taranmış) → script tespiti (örnek sayfadan)
        │
        ├─ Latin (eng/tur/fra/deu...) + makul kalite
        │     └─ Tesseract           [$0, CPU, GPU yok, worker'da çalışır]
        │           └─ ortalama confidence < eşik?  → Surya'ya yükselt
        │
        └─ Arapça / Farsça / Urduca / zor script
              └─ Surya (GPU servisi)  [mükemmel kalite]
                    └─ servis down / hata → Gemini fallback (opsiyonel)
```

**Self-routing:** Tesseract'ı çalıştır, güven skoru düşükse otomatik
Surya'ya yükselt. Yani kalite garanti altına alınır, maliyet minimumda kalır.

### Çift-sayfa (spread) ön-işleme
Taranmış kitapların çoğu iki sayfa yan yana (landscape, ratio>1). Surya/
Tesseract tüm satırları dikey konuma göre sıralayınca sağ+sol sayfa
**iç içe geçiyor**. Çözüm (motordan bağımsız): görüntüyü ortadan böl,
**önce sağ sonra sol** (Arapça RTL) OCR'la. Ölçüldü — okuma sırasını
tamamen düzeltiyor. Heuristik: `width > height * 1.15` → spread.

## 4. Neden self-host (Surya), neden Gemini değil

Bu **çekirdek girdi yolu** — kiracı değil, sahip olmalıyız:

1. **Vendor riski:** test sırasında `gemini-2.0-flash` "no longer available"
   deyip 404 verdi. Google modeli deprecate etti. Çekirdek altyapıyı
   kapatılabilir modele bağlamak kırılgan. Surya açık ağırlık — kalıcı.
2. **Maliyet (ölçekte):** serverless Surya ~$0.09/kitap vs Gemini-gold
   ~$1.5/kitap → **~16×**. Kullanıcı arttıkça çarpan etkisi.
3. **Gizlilik:** kullanıcının (telifli/kişisel) belgesi Google'a gitmez.
4. **Kalite fark değil:** Surya ≈ Gemini-gold (ölçüldü).

Gemini **opsiyonel fallback** olarak kalır (dayanıklılık).

## 5. Ölçeklenebilir ingest mimarisi

### Sorun: mevcut `setImmediate` modeli çökertir
İşleme web sürecinin event-loop'unda. 2-3 eşzamanlı büyük kitap → CPU kilidi,
RAM şişmesi (60MB PDF + yüzlerce sayfa rasteri), web herkese yavaşlar → OOM.
Gerçekçi tavan: **1-3 iş**, sonra çöker.

### Çözüm: kuyruk + ayrı worker'lar

```
[Upload] → Web route (sadece enqueue, ms'ler) → 202 döner
               │
        [Job Queue]  (Redis + BullMQ)
               │
     [Worker container'lar]  (yatay ölçekli, N adet)
       1. PDF'i object storage'dan çek
       2. Sayfa başına: text-layer? → pdfjs
                        taranmış?  → script routing (§3)
                          ├─ Tesseract (worker içinde, CPU)
                          └─ Surya GPU servisine HTTP
       3. chunk
       4. embed (merkezî throttle'lı Gemini /embed)
       5. Postgres + pgvector'a yaz, status güncelle
```

**Kuyruğun değeri:** "100 kullanıcı aynı anda yükledi" artık çökme değil,
**yönetilebilir backlog**. Fazlası sırada bekler ("kitabınız işleniyor…"),
sistem ayakta kalır. Graceful degradation.

### Katman bazında eşzamanlılık tavanı

| Katman | Tavan | Ölçekleme |
|---|---|---|
| Web route (enqueue) | ~binlerce | stateless, replica ekle |
| Worker (CPU+RAM bound) | ~2-4 kitap/worker (2GB) | yatay: worker ekle |
| Surya GPU (serverless) | warm worker sayısı | otomatik scale, bütçe sınırı |
| **Gemini embedding** | **global RPM/TPM** ⚠️ | merkezî kuyruk+backoff; gerçek tavan |
| Postgres/pgvector | bağlantı havuzu ~100 | **PgBouncer** → yüzlerce |

**Gerçek tavan iki nokta:** (1) Gemini embedding global rate limit
(worker sayısından bağımsız — merkezî throttle şart, 429'ları gördük),
(2) Postgres yazma + HNSW index kilidi (PgBouncer + bounded concurrency).

## 6. Bileşen tasarımı

### 6.1 OCR servisi (yeni)
- **Surya OCR servisi**: FastAPI, GPU host. Endpoint `/ocr` — girdi: sayfa
  görüntüleri (veya PDF bytes), çıktı: sayfa başına metin. İçinde
  spread-split + RTL sıralama.
- **Tesseract**: ayrı servise gerek yok — worker container'ında CPU'da
  çalışır (hafif). Sadece zor script/düşük-güven Surya'ya gider.
- `transformers==4.56.1` pinle (surya 0.17.1 ile uyum — 5.x kırıyor).

### 6.2 Hosting modeli
| Mod | Ne zaman | Maliyet |
|---|---|---|
| On-demand pod (kirala/durdur) | **mevcut 80 kitap, tek seferlik batch** | ~$5 (4090, 6-8sa) |
| **Serverless GPU** (sıfıra iner) | **ürün — kullanıcı yüklemeleri** | $0 boşta, ~$0.09/kitap |
| Always-on GPU | sadece sürekli yüksek trafik | ~$200-500/ay (şimdilik israf) |

Modal / RunPod Serverless / Replicate — saniye bazlı, scale-to-zero,
cold-start ~10-30sn (ingest zaten async olduğu için UX'i bozmaz).

### 6.3 Storage
Local disk'ten **object storage'a** (S3 / Cloudflare R2). Worker'lar farklı
container'larda — local disk paylaşılmaz. PDF + (gerekirse) sayfa rasterleri
orada.

### 6.4 Embedding throttle
Gemini `/embed` çağrıları **merkezî kuyruktan** geçer: global RPM/TPM'e
saygı, batch (40), exponential backoff. Worker sayısı artsa bile embedding
throughput'u bu merkezden yönetilir.

## 7. Maliyet modeli ve fiyatlandırma girdisi

Kitap başı işleme maliyeti (≈550 sayfa ortalama):

| Senaryo | Maliyet/kitap |
|---|---|
| Text-layer'lı | ~$0 (sadece embedding) |
| Taranmış Latin (Tesseract) | ~$0 OCR + embedding |
| Taranmış Arapça (serverless Surya) | ~$0.09 OCR + embedding |
| Embedding (Gemini, ~hep) | hesapla: chunk sayısı × token |

Pahalı yol **azınlıkta** tetiklendiği için ortalama kullanıcı maliyeti düşük.
Fiyatlandırma: kullanıcı planına OCR/embedding maliyetini gömerek
(örn. sayfa/kitap kotası) sürdürülebilir marj kurulur. Bu doküman bunun
**girdi sayılarını** sağlar.

## 8. İnşa sırası (fazlar)

1. **Faz 1 — OCR yeteneği:** Surya + spread-split'i temiz Python modülü +
   FastAPI servisi olarak yaz. Lokalde (CPU) 4 sayfada doğrula.
2. **Faz 2 — Tek seferlik batch:** mevcut 80 Arapça kitabı on-demand GPU'da
   OCR'la (~$5), kütüphaneye al (admin-ingest text yolu). Kodu gerçek veride
   doğrula + külliyatı bitir.
3. **Faz 3 — Ölçeklenebilirlik temeli:** ingest'i kuyruk + worker'a taşı,
   storage'ı object storage'a, embedding'e merkezî throttle. (Çok kullanıcı
   için OCR'dan bile önce gelen temel.)
4. **Faz 4 — Serverless deploy + routing:** Surya'yı serverless GPU'ya sar,
   `needsOcr` yolunu katmanlı routing'e (§3) çevir: pdfjs → Tesseract-Latin
   → Surya-zor-script → Gemini-fallback. **Tesseract EMEKLİ OLMAZ** —
   Latin scriptlerde (çoğunluk) kalıcı birincil motor olarak kalır; Surya
   yalnızca zor script VEYA düşük Tesseract güven skorunda devreye girer.

## 9. Açık konular / sonra karar
- Script tespiti yöntemi (hızlı örnek-sayfa pass mı, PDF metadata mı).
- Tesseract confidence eşik değeri (kalibrasyon gerek).
- Surya reading-order: çift-sayfa dışındaki çok-sütunlu/dipnotlu layout'lar
  için layout-aware sıralama gerekir mi (RAG için şimdilik tolere edilebilir).
- Gemini embedding kota artışı (yüksek ölçekte).
- Object storage sağlayıcı seçimi (R2 vs S3) ve maliyet.
