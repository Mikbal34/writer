/**
 * Minimal design-token showcase. Zero primitive imports, zero shell —
 * just plain divs styled with the new Tailwind tokens so it compiles
 * in a couple of seconds even on a cold cache. Once the dev environment
 * is healthy we can grow this back into a full showcase.
 */

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-page text-ink p-8">
      <div className="max-w-4xl mx-auto space-y-10">
        <header className="space-y-1">
          <div className="font-ui text-[10px] uppercase tracking-widest text-ink-light">
            Design System
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Quilpen UI · V3 Editorial
          </h1>
          <p className="font-body text-sm text-ink-light">
            Tokens — page / rail / panel / gold / forest / ink / sandy
          </p>
        </header>

        {/* Surfaces */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Yüzeyler</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Swatch label="page" cls="bg-page" />
            <Swatch label="rail" cls="bg-rail" />
            <Swatch label="panel" cls="bg-panel" />
            <Swatch label="elevated" cls="bg-elevated border border-sandy" />
            <Swatch label="deep" cls="bg-deep" dark />
            <Swatch label="backdrop" cls="bg-backdrop" />
          </div>
        </section>

        {/* Brand */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Brand</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Swatch label="gold" cls="bg-gold" dark />
            <Swatch label="gold-hover" cls="bg-gold-hover" dark />
            <Swatch label="gold-dark" cls="bg-gold-dark" dark />
            <Swatch label="forest" cls="bg-forest" dark />
            <Swatch label="forest-deep" cls="bg-forest-deep" dark />
            <Swatch label="spine" cls="bg-spine" dark />
          </div>
        </section>

        {/* Text & border */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Text & Border</h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <Swatch label="ink" cls="bg-ink" dark />
            <Swatch label="ink-light" cls="bg-ink-light" dark />
            <Swatch label="ink-muted" cls="bg-ink-muted" dark />
            <Swatch label="sandy" cls="bg-sandy" />
            <Swatch label="sandy-soft" cls="bg-sandy-soft" />
            <Swatch label="destructive" cls="bg-destructive" dark />
          </div>
        </section>

        {/* Radius */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Radius</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <RadiusBox name="sm · 4" cls="rounded-sm" />
            <RadiusBox name="md · 6 (default)" cls="rounded-md" />
            <RadiusBox name="lg · 8" cls="rounded-lg" />
            <RadiusBox name="xl · 12" cls="rounded-xl" />
            <RadiusBox name="2xl · 16" cls="rounded-2xl" />
          </div>
        </section>

        {/* Typography */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Tipografi</h2>
          <div className="rounded-lg bg-elevated border border-sandy p-6 space-y-3">
            <div>
              <Eyebrow>Display · Playfair</Eyebrow>
              <h1 className="font-display text-4xl font-bold">Felsefenin Geri Dönüşü</h1>
              <h2 className="font-display text-2xl font-semibold">İkinci Bölüm Başlığı</h2>
            </div>
            <div>
              <Eyebrow>Body · Crimson</Eyebrow>
              <p className="font-body text-base leading-relaxed">
                Kelâm, akıl yürütülmüş söz demektir; mütekellim için bu yalnız bir tarif değil, aynı zamanda bir yöntemdir.
              </p>
            </div>
            <div>
              <Eyebrow>UI · Source Sans 3</Eyebrow>
              <p className="font-ui text-sm">Buton etiketleri, form metni, nav.</p>
            </div>
          </div>
        </section>

        {/* Raw button samples — no Button primitive import */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Butonlar (raw class)</h2>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              Default · Forest
            </button>
            <button className="inline-flex items-center px-3 py-1.5 rounded-md bg-gold text-ink text-sm font-semibold hover:bg-gold-hover transition-colors shadow-sm">
              Bu kitaba sor
            </button>
            <button className="inline-flex items-center px-3 py-1.5 rounded-md bg-elevated border border-sandy text-ink text-sm hover:bg-page transition-colors">
              Outline
            </button>
            <button className="inline-flex items-center px-3 py-1.5 rounded-md text-ink-light hover:bg-page hover:text-ink text-sm transition-colors">
              Ghost
            </button>
            <button className="inline-flex items-center px-3 py-1.5 rounded-md bg-destructive/10 text-destructive text-sm hover:bg-destructive/20 transition-colors">
              Destructive
            </button>
          </div>
        </section>

        {/* Card sample */}
        <section className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Kart örnekleri</h2>
          <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
            <div className="rounded-lg bg-elevated border border-sandy p-5 space-y-2">
              <Eyebrow>İstatistik</Eyebrow>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-3xl font-bold tabular-nums">14</span>
                <span className="font-ui text-xs text-ink-light">not</span>
                <span className="font-display text-3xl font-bold tabular-nums">42</span>
                <span className="font-ui text-xs text-ink-light">alıntı</span>
              </div>
            </div>
            <div className="rounded-lg bg-elevated border border-sandy p-5 space-y-2">
              <Eyebrow>Folder chip örnekleri</Eyebrow>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-ink text-page px-2.5 py-1 font-ui text-xs font-medium">
                  Tüm · 96
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-elevated border border-sandy px-2.5 py-1 font-ui text-xs hover:bg-page transition-colors cursor-pointer">
                  📁 Kelâm · 18
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-elevated border border-sandy px-2.5 py-1 font-ui text-xs hover:bg-page transition-colors cursor-pointer">
                  📁 Tez · 9
                </span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Swatch({
  label,
  cls,
  dark,
}: {
  label: string;
  cls: string;
  dark?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className={`h-16 w-full rounded-md border border-sandy-soft ${cls}`} />
      <div className={`font-ui text-xs font-medium ${dark ? "text-ink" : "text-ink"}`}>{label}</div>
    </div>
  );
}

function RadiusBox({ name, cls }: { name: string; cls: string }) {
  return (
    <div className="space-y-1.5">
      <div className={`h-16 w-full bg-gold/60 border border-gold ${cls}`} />
      <div className="font-ui text-xs text-ink-light">{name}</div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-ui text-[10px] uppercase tracking-widest text-ink-light">
      {children}
    </div>
  );
}
