"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// ── Small components ─────────────────────────────────────────────────────────

function Particle({ style }: { style: React.CSSProperties }) {
  return <span className="particle" style={style} />;
}

function NavBar({ onAnalyze }: { onAnalyze: () => void }) {
  const { data: session } = useSession();
  const router = useRouter();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-foreground/10"
      style={{ background: "hsl(var(--background) / 0.9)", backdropFilter: "blur(16px)" }}>
      {/* Logo */}
      <a href="#" className="flex items-center gap-2.5 group">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
            <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
          </svg>
        </div>
        <span className="font-semibold text-sm text-foreground/90 group-hover:text-foreground transition-colors">SchemaScribe</span>
      </a>

      {/* Nav links */}
      <div className="hidden md:flex items-center gap-6">
        {["Features", "Showcase", "Workflow"].map((link) => (
          <a key={link} href={`#${link.toLowerCase()}`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground/90 transition-colors uppercase tracking-widest">
            {link}
          </a>
        ))}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {session ? (
          <>
            {session.user?.image && (
              <Image src={session.user.image} alt={session.user?.name ?? "User"} width={28} height={28}
                className="rounded-full" />
            )}
            <button onClick={onAnalyze}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: "hsl(142 71% 45%)", color: "hsl(var(--primary-foreground))" }}>
              Open Dashboard →
            </button>
          </>
        ) : (
          <button onClick={() => signIn("google")}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border border-white/10 text-foreground/80 hover:border-white/20 hover:text-foreground transition-all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in
          </button>
        )}
      </div>
    </nav>
  );
}

// ── Feature cards ─────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: "🔍", title: "Auto Profiling", desc: "15+ semantic types — Email, Aadhaar, GSTIN, IFSC, PAN detected automatically." },
  { icon: "🔌", title: "Live DB Connect", desc: "Paste a PostgreSQL or MySQL URI. Get full schema scan, ERD, and AI docs instantly." },
  { icon: "🤖", title: "AI Descriptions", desc: "Groq Llama-3.1 writes business context for every column. Stats only — zero raw data sent." },
  { icon: "📊", title: "Health Score", desc: "Structural + value validity with letter grade. Garbage values and invalid ranges penalized." },
  { icon: "💬", title: "Chat with Data", desc: "Plain English → JS code → real execution. Mathematically accurate answers." },
  { icon: "🛡️", title: "Secure Sandbox", desc: "3-layer execution protection. No eval, no external calls, no data exposure." },
  { icon: "🗄️", title: "SQL DDL Generator", desc: "CREATE TABLE for PostgreSQL, MySQL, SQLite, Snowflake, SQL Server, and Oracle." },
  { icon: "🗺️", title: "ERD Diagrams", desc: "Multi-file FK detection. Mermaid.js renders interactive relationship maps." },
  { icon: "🧹", title: "Cleaning Studio", desc: "Mean/median/mode imputation + IQR noise removal. Download cleaned CSV." },
  { icon: "📖", title: "Reference Manual", desc: "Fullscreen doc portal with sidebar search. Export as dark-theme PDF." },
  { icon: "📈", title: "Executive Report", desc: "AI-generated business overview, key findings, and governance scope." },
  { icon: "🔧", title: "MCP Server", desc: "Use SchemaScribe tools directly from VS Code, Cursor, or Antigravity." },
];

// ── Main Landing Page ─────────────────────────────────────────────────────────

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = () => {
    if (!session) {
      signIn("google", { callbackUrl: "/" });
      return;
    }
    router.push("/dashboard");
  };

  const particles = Array.from({ length: 20 }, (_, i) => ({
    width: `${4 + (i % 5) * 3}px`,
    height: `${4 + (i % 5) * 3}px`,
    left: `${(i * 5.1) % 100}%`,
    top: `${(i * 7.3 + 10) % 90}%`,
    animationDuration: `${4 + (i % 6)}s`,
    animationDelay: `${(i * 0.3) % 3}s`,
    opacity: 0.15 + (i % 5) * 0.07,
  }));

  return (
    <div className="min-h-screen" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(34,197,94,0.06) 0%, hsl(var(--background)) 60%)" }}>
      <NavBar onAnalyze={handleAnalyze} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
        {/* Particles */}
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
          {particles.map((p, i) => (
            <Particle key={i} style={{ ...p } as React.CSSProperties} />
          ))}
        </div>

        {/* Grid bg */}
        <div aria-hidden className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(hsl(var(--foreground) / 0.02) 1px, transparent 1px),
              linear-gradient(90deg, hsl(var(--foreground) / 0.02) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }}
        />

        <div className="relative z-10 text-center max-w-5xl mx-auto px-6">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-8 px-4 py-2 rounded-full text-xs font-semibold"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "hsl(142 71% 55%)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Powered by Groq Llama-3.1 · Built for Data Analysts
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-6 leading-none tracking-tight">
            <span className="text-foreground">UNDERSTAND YOUR</span>
            <br />
            <span className="gradient-text">DATABASE</span>
            <span className="text-foreground"> INSTANTLY.</span>
          </h1>

          {/* Subtitle */}
          <p className="text-muted-foreground text-lg md:text-xl max-w-3xl mx-auto mb-10 leading-relaxed">
            Connect any database or upload any file. Get AI-powered schema docs, interactive ERDs,
            data quality reports, SQL generators, and natural language chat all in seconds.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={handleAnalyze}
              disabled={status === "loading"}
              className="group relative px-8 py-4 rounded-xl font-bold text-sm text-primary-foreground transition-all overflow-hidden"
              style={{ background: "hsl(142 71% 45%)" }}>
              <span className="relative z-10">
                {status === "loading" ? "Loading..." : session ? "Open Dashboard →" : "Get Started Free →"}
              </span>
              <div className="absolute inset-0 translate-y-full group-hover:translate-y-0 transition-transform"
                style={{ background: "hsl(142 71% 38%)" }} />
            </button>
            <a href="#features" className="px-8 py-4 rounded-xl font-semibold text-sm text-foreground/80 border border-white/10 hover:border-white/20 hover:text-foreground transition-all">
              Explore Features
            </a>
          </div>

          {/* Trust bar */}
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-widest">Powered by</span>
            {["Groq", "Sarvam AI", "Google OAuth", "Vercel", "Next.js 16"].map((item) => (
              <span key={item} className="px-3 py-1 rounded-full border border-foreground/10 text-muted-foreground">
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-widest"
              style={{ color: "hsl(142 71% 45%)" }}>Capabilities</span>
            <h2 className="text-4xl font-bold text-foreground mt-3 mb-4">Everything you need.</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              From live database connections to file uploads one unified intelligence platform.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div key={f.title}
                className="glass-card p-5 group hover:border-white/15 transition-all duration-300 hover:-translate-y-0.5">
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Data Sources Showcase ─────────────────────────────────────────── */}
      <section id="showcase" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-widest"
              style={{ color: "hsl(142 71% 45%)" }}>Data Sources</span>
            <h2 className="text-4xl font-bold text-foreground mt-3 mb-4">Upload or connect.</h2>
            <p className="text-muted-foreground">Two modes, one intelligence platform.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* File Upload Card */}
            <div className="glass-card p-8 border-green-500/20 hover:border-green-500/40 transition-all group cursor-pointer"
              onClick={handleAnalyze}
              style={{ background: "rgba(34,197,94,0.03)" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
                style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Upload Files</h3>
              <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                Drop CSV, Excel (.xlsx/.xls), or JSON files. Multi-file ERD detection. Up to 100MB per file.
              </p>
              <div className="flex flex-wrap gap-2">
                {[".CSV", ".XLSX", ".XLS", ".JSON"].map((ext) => (
                  <span key={ext} className="text-xs px-2 py-1 rounded font-mono"
                    style={{ background: "rgba(34,197,94,0.1)", color: "hsl(142 71% 55%)", border: "1px solid rgba(34,197,94,0.15)" }}>
                    {ext}
                  </span>
                ))}
              </div>
            </div>

            {/* Live DB Card */}
            <div className="glass-card p-8 border-blue-500/20 hover:border-blue-500/40 transition-all group cursor-pointer"
              onClick={handleAnalyze}
              style={{ background: "rgba(59,130,246,0.03)" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-6"
                style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(217 91% 60%)" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3"/>
                  <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
                  <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
                </svg>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Live Database</h3>
              <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                Paste a connection URI. Instantly scan schema, relationships, table sizes, and FK constraints.
              </p>
              <div className="flex flex-wrap gap-2">
                {["PostgreSQL", "MySQL", "Neon", "Supabase"].map((db) => (
                  <span key={db} className="text-xs px-2 py-1 rounded font-mono"
                    style={{ background: "rgba(59,130,246,0.1)", color: "hsl(217 91% 70%)", border: "1px solid rgba(59,130,246,0.15)" }}>
                    {db}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Workflow ──────────────────────────────────────────────────────── */}
      <section id="workflow" className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <span className="text-xs font-bold uppercase tracking-widest"
            style={{ color: "hsl(142 71% 45%)" }}>Workflow</span>
          <h2 className="text-4xl font-bold text-foreground mt-3 mb-16">Four steps. Full intelligence.</h2>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              { step: "01", title: "Connect", desc: "Upload file or paste DB URI." },
              { step: "02", title: "Profile", desc: "Stats, types, outliers, FK map." },
              { step: "03", title: "Enrich", desc: "Groq AI writes column docs." },
              { step: "04", title: "Act", desc: "Chat, clean, export, or share." },
            ].map((s, i) => (
              <div key={s.step} className="relative">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 text-sm font-bold"
                  style={{ background: "rgba(34,197,94,0.1)", border: "2px solid rgba(34,197,94,0.3)", color: "hsl(142 71% 55%)" }}>
                  {s.step}
                </div>
                <h3 className="text-foreground font-semibold mb-2">{s.title}</h3>
                <p className="text-muted-foreground text-sm">{s.desc}</p>
                {i < 3 && (
                  <div className="hidden md:block absolute top-6 left-[60%] w-[40%] border-t border-dashed border-white/[0.08]" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-foreground/10 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
                <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
              </svg>
            </div>
            <span className="text-sm font-semibold text-muted-foreground">SchemaScribe AI</span>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 SchemaScribe AI · Powered by Groq + Sarvam AI </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>v2.0.0</span>
            <span>Next.js 16</span>
            <span>Open Source</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
