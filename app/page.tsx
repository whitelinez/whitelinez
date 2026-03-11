/**
 * app/page.tsx — Main dashboard shell (Phase 0 placeholder).
 * Will be populated with StreamWrapper + Sidebar + GovOverlay in Phase 3–5.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Live indicator */}
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-active animate-pulse-dot" />
          <span className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
            AI Traffic JA
          </span>
        </div>

        <h1 className="font-display text-4xl font-bold text-foreground tracking-tight">
          Next.js Migration
        </h1>

        <p className="text-muted-foreground max-w-sm">
          Phase 0 scaffold complete. Tailwind tokens, shadcn/ui, and project structure are ready.
        </p>

        {/* Token verification swatches */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { bg: "bg-background",  label: "bg" },
            { bg: "bg-surface",     label: "surface" },
            { bg: "bg-card",        label: "card" },
            { bg: "bg-primary",     label: "cyan" },
            { bg: "bg-accent",      label: "accent" },
            { bg: "bg-green-live",  label: "live" },
            { bg: "bg-cls-car",     label: "car" },
            { bg: "bg-cls-truck",   label: "truck" },
          ].map(({ bg, label }) => (
            <div key={label} className="flex flex-col items-center gap-1">
              <div className={`h-8 w-8 rounded ${bg} border border-border`} />
              <span className="text-[10px] text-muted-foreground font-mono">{label}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          All swatches above should show distinct brand colors. If background/surface/card
          look identical or primary shows white, check{" "}
          <code className="text-primary">tailwind.config.ts</code>.
        </p>
      </div>
    </main>
  );
}
