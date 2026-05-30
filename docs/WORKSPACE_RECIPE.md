# Workspace Pattern Recipe

Bu reçete proje-içi sayfaların (Dashboard, Roadmap, Sources, Write,
Citations, Settings, Preview, Design, Export) **tutarlı kitap-içi
estetiği** sağlamak için izlenecek katmanları tarif eder.

Hub sayfaları (Kitaplarım, Library, Account, Library Chat, Literature
Search) bu reçeteyi kullanmaz — onlar "üretken hub" pattern'inde
(büyük yeşil banner + kitap kapağı kart) kalır.

---

## 1. Genel Felsefe

> **Hub = sayfa seçimi** · **Workspace = sayfayı çevirme**

Workspace pattern'i için zihinsel model: **kullanıcı kitabın içinde
yazıyor**. Ekran krem zeminli bir kâğıt sayfasıdır; üst başlık ortada;
dipte sayfa numarası vardır. Aksanlar gold, yapı ornament,
yardımcı renk forest yeşili.

---

## 2. Page Skeleton (her sayfada bu sıra)

```tsx
<div className="h-full overflow-y-auto px-6 lg:px-10 py-6 lg:py-8">
  {/* 1) HEADER — title + opsiyonel action butonlar */}
  <FadeUp className="flex items-start justify-between gap-4 flex-wrap mb-6">
    <PageTitle title="Sayfa Adı" subtitle="Kısa açıklama." />
    <div className="flex gap-2">
      {/* primary + secondary action buttons */}
    </div>
  </FadeUp>

  {/* 2) STATS / FILTER STRIP — opsiyonel */}
  <FadeIn delay={0.2} className="flex items-center gap-3 mb-4 flex-wrap">
    {/* küçük chip filtreler, sayım rozetleri */}
  </FadeIn>

  {/* 3) ORNAMENT DIVIDER — header ile içerik arasında */}
  <Ornament className="w-48 mx-auto text-sandy mb-6" />

  {/* 4) CONTENT — kart, liste, panel, editor — sayfa özel */}
  <div className="space-y-4">
    {/* … */}
  </div>

  {/* 5) PAGE NUMBER — opsiyonel klasik kitap dokunuşu */}
  <PageNumber number="iv" />
</div>
```

---

## 3. Renk Tokenleri (Tailwind/CSS değişkenleri)

| Token | Kullanım | Ne için |
|---|---|---|
| `bg-page` | Ana zemin | Sayfa kâğıdı tonu (krem) |
| `bg-elevated` | Kart, input, hover bg | Sayfanın üstündeki yüzeyler |
| `bg-sandy-soft` | Yumuşak hover, filter active arka plan | Sayfa içi soft vurgu |
| `border-sandy` | Default border | Sade ayrım çizgileri |
| `border-sandy/40` | Daha yumuşak border | Liste ayraçları, soft kartlar |
| `text-ink` | Ana metin / başlık | Siyah-kahve karışımı, kalın |
| `text-ink-light` | Yardımcı metin | Body, açıklayıcı |
| `text-muted-foreground` | Caption, meta | En soluk |
| `text-forest` | Active state, primary aksent | Nav active, primary buton |
| `text-gold-dark` | İkincil aksent, warning | "Eksik" uyarısı, ornament |
| `bg-forest` / `text-page` | Primary button | "Continue", "Save" |
| `bg-forest/90` | Primary button hover | — |
| `bg-deep` | Yeşil rail bg | Sadece rail/header — sayfa içi YASAK |

**Yasak:**
- Hard-code hex (`#F5F0E6`, `style={{ backgroundColor: "…"}}`)
- `min-h-screen` (shell zaten yüksekliği yönetiyor)
- Hub pattern'ından "büyük yeşil banner" projeye taşımak

---

## 4. Tipografi

| Sınıf | Kullanım |
|---|---|
| `font-display` | Başlıklar (`PageTitle`, `SectionTitle`), kart başlık, stat sayıları |
| `font-ui` | Nav, button, label, chip, badge, breadcrumb |
| `font-body` | Paragraf, açıklama, kart içeriği, form description |

| Boy / Ağırlık | Yer |
|---|---|
| `text-2xl md:text-3xl font-bold` | PageTitle |
| `text-lg font-semibold` | SectionTitle |
| `text-base font-medium` | Kart başlık |
| `text-sm` | Body default |
| `text-xs` | Meta, secondary label |
| `text-[11px]` veya `text-[10px]` | Chip, badge, micro-label |

---

## 5. Spacing (vertical rhythm)

- Sayfa padding: `px-6 lg:px-10 py-6 lg:py-8`
- Header → strip arası: `mb-4` veya `mb-6`
- Strip → ornament: `mb-4`
- Ornament → content: `mb-6`
- Kart aralık: `space-y-3` veya `space-y-4`
- Kart iç padding: `p-4` veya `p-5`
- Inline gap: `gap-2` (tight) / `gap-3` (default) / `gap-4` (loose)

---

## 6. Shared Components (mevcut, tekrar üretme)

- `<PageTitle title subtitle? />` → her sayfa header'ı
- `<SectionTitle>` → bölüm başlığı (içeriğin §-prefix'li alt-başlık)
- `<Ornament className="w-48 mx-auto text-sandy" />` → divider
- `<PageNumber number="iv" />` → klasik sayfa altı
- `<SpineShadow />` → split-view book header için
- `<FadeUp delay? children />` → header animasyonu
- `<FadeIn delay? children />` → secondary block animasyonu
- `<StaggerItem index baseDelay stagger children />` → liste item

---

## 7. Patterns (tekrarlayan kalıplar)

### Filter chip strip
Sources sayfasında kullanılan:
```tsx
<button
  onClick={() => toggle(value)}
  className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
    active ? "bg-sandy-soft text-forest font-medium" : "text-muted-foreground hover:bg-sandy-soft/40"
  }`}
>
  <span className="h-2 w-2 rounded-full bg-forest" />
  {count} Label
</button>
```

### Action button (primary)
```tsx
<button className="flex items-center gap-2 px-3 py-1.5 bg-forest text-page rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors">
  <Icon className="h-3.5 w-3.5" />
  Label
</button>
```

### Action button (secondary)
```tsx
<button className="flex items-center gap-2 px-3 py-1.5 border border-sandy rounded-sm font-ui text-xs text-ink hover:bg-sandy-soft/30 transition-colors">
  <Icon className="h-3.5 w-3.5" />
  Label
</button>
```

### Liste satırı
```tsx
<StaggerItem
  index={i}
  baseDelay={0.3}
  stagger={0.08}
  className="group flex items-center gap-4 py-4 border-b border-sandy/40 hover:bg-sandy-soft/15 px-4 -mx-4 transition-colors last:border-b-0"
>
  {/* status icon · text · meta · actions */}
</StaggerItem>
```

### Status badge (chip)
```tsx
<span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-sm text-[10px] font-ui">
  <Icon className="h-3 w-3" />
  Label
</span>
```

### Card
```tsx
<div className="bg-elevated border border-sandy/60 rounded-sm p-5 space-y-3">
  {/* … */}
</div>
```

### Empty state
```tsx
<div className="text-center py-12">
  <BookMarked className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
  <p className="font-body text-sm text-muted-foreground">
    No items yet.
  </p>
</div>
```

---

## 8. Anti-patterns (yapılmaması gerekenler)

- ❌ `min-h-screen` veya hard-code yükseklik
- ❌ `style={{ backgroundColor: "#...." }}` — token kullan
- ❌ Sayfa içinde büyük yeşil hero banner (hub pattern'i)
- ❌ Texture background image
- ❌ İki sidebar yan yana (ProjectIconRail tek başına)
- ❌ Page title'ı kart içine gömme — `PageTitle` her zaman top-level
- ❌ Çoklu ornament — sadece header altında 1 divider, gerekirse footer altına 1 PageNumber

---

## 9. Sayfa-Özel Hatırlatmalar

| Sayfa | Özel not |
|---|---|
| Dashboard (`/projects/[id]`) | İstatistik kart grid + Contents listesi + Quick Actions sağ panel. Workspace pattern uygulanır, sağ panel opsiyonel. |
| Roadmap | Solda chat (40%), sağda StructureTree (60%). PageTitle yok — sayfanın tamamı 2-pane workspace. |
| Sources | PageTitle + filter strip + ornament + bibliography listesi. Bu reçeteyi en tam izleyen sayfa. |
| Write | Editör + sağ context (chapter outline). PageTitle yok, doğrudan editor. |
| Citations | Sol bibliography listesi (aside), sağ subsection eşleme. Workspace ama 2-pane. |
| Preview / Design | Karakter/scene grid + tab-bazlı. Workspace pattern uygulanır. |
| Export | Form-ağırlıklı. `border border-sandy/60 rounded-sm bg-page/80` kart wrap kullanılır. |
| Settings (academic / citations) | Form sayfaları, single column max-w-3xl mx-auto, kart-içinde-kart yapısı. |

---

## 10. Migration Checklist (her sayfa için)

- [ ] `min-h-screen` ve hard-code bg silindi
- [ ] Sayfa wrapper `h-full overflow-y-auto px-6 lg:px-10 py-6 lg:py-8`
- [ ] `<PageTitle>` kullanılıyor (title + subtitle)
- [ ] Action butonlar header'ın sağ tarafında, `font-ui text-xs`
- [ ] Stats/filter strip varsa chip-style + `bg-sandy-soft` active
- [ ] `<Ornament>` divider header ile content arasında
- [ ] Content kartları `bg-elevated border border-sandy/60`
- [ ] Status badges `bg-*-100 text-*-700 rounded-sm text-[10px]`
- [ ] Font sınıfları tutarlı (`font-display` / `font-ui` / `font-body`)
- [ ] Empty state varsa standart `BookMarked` ikon + caption
