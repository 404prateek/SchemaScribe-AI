"use client";

import { useState, useCallback, useRef } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTheme } from "next-themes";

// ── Tab types ──────────────────────────────────────────────────────────────
type TabId = "upload" | "overview" | "dictionary" | "erd" | "chat" | "clean" | "sql" | "manual" | "exec" | "mcp";

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: session } = useSession({ required: true });
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("upload");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [erdMapping, setErdMapping] = useState<Record<string, unknown> | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [connectMode, setConnectMode] = useState<"file" | "db">("file");
  const [dbUri, setDbUri] = useState("");
  const [datasetContext, setDatasetContext] = useState("");

  const handleFiles = useCallback(async (files: FileList) => {
    if (!files.length) return;
    setIsAnalyzing(true);
    setError(null);

    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));
    formData.append("dataset_context", datasetContext);

    try {
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setSessionId(data.session_id);
      setProfile(data.profile);
      setErdMapping(data.erd_mapping ?? null);
      setActiveTab("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred");
    } finally {
      setIsAnalyzing(false);
    }
  }, [datasetContext]);

  const handleDBConnect = useCallback(async () => {
    if (!dbUri.trim()) return;
    setIsAnalyzing(true);
    setError(null);

    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_string: dbUri }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Connection failed");
      setSessionId(data.session_id);
      setProfile(data.profile);
      setErdMapping(data.erd_mapping ?? null);
      setActiveTab("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setIsAnalyzing(false);
    }
  }, [dbUri]);

  const TABS: { id: TabId; label: string; icon: string; requiresSession?: boolean }[] = [
    { id: "upload", label: "Connect", icon: "🔌" },
    { id: "overview", label: "Overview", icon: "📊", requiresSession: true },
    { id: "dictionary", label: "Dictionary", icon: "📚", requiresSession: true },
    { id: "erd", label: "ERD", icon: "🗺️", requiresSession: true },
    { id: "chat", label: "Chat", icon: "💬", requiresSession: true },
    { id: "clean", label: "Clean", icon: "🧹", requiresSession: true },
    { id: "sql", label: "SQL DDL", icon: "🗄️", requiresSession: true },
    { id: "manual", label: "Manual", icon: "📖", requiresSession: true },
    { id: "exec", label: "Report", icon: "📈", requiresSession: true },
    { id: "mcp", label: "MCP", icon: "🔧", requiresSession: true },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prof = profile as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = (prof?.columns ?? []) as any[];
  const healthScore = typeof prof?.health_score === "number" ? prof.health_score : 0;
  const letterGrade =
    healthScore >= 90 ? "A" : healthScore >= 75 ? "B" : healthScore >= 60 ? "C" : healthScore >= 40 ? "D" : "F";
  const gradeColor =
    healthScore >= 90 ? "hsl(142 71% 45%)" : healthScore >= 75 ? "hsl(43 96% 56%)" : healthScore >= 60 ? "hsl(32 98% 56%)" : "hsl(0 84% 60%)";

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-foreground/10"
        style={{ background: "hsl(var(--background) / 0.95)", backdropFilter: "blur(16px)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => window.location.reload()} className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(142 71% 45%)" strokeWidth="2">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
                <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
              </svg>
            </div>
            <div>
              <span className="font-semibold text-sm text-foreground/90">SchemaScribe AI</span>
            </div>
          </button>
          {profile && (
            <span className="ml-4 text-xs px-2 py-0.5 rounded-full font-mono"
              style={{ background: "rgba(34,197,94,0.08)", color: "hsl(142 71% 55%)", border: "1px solid rgba(34,197,94,0.15)" }}>
              {String(profile.filename ?? "Dataset")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {session?.user && (
            <>
              {session.user.image && (
                <Image src={session.user.image} alt={session.user.name ?? ""} width={28} height={28} className="rounded-full" />
              )}
              <span className="text-xs text-muted-foreground hidden sm:block">{session.user.name}</span>
              <button onClick={() => signOut({ callbackUrl: "/" })}
                className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors px-2">
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Removed Tab Bar ───────────────────────────────────────────── */}

      {/* ── Tab Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 p-6 overflow-auto">
        {/* ── CONNECT PANEL ──────────────────────────────────────────────── */}
        {!profile ? (
          <div className="max-w-2xl mx-auto mt-12 space-y-6 animate-fade-in">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-foreground mb-2">Connect a Data Source</h1>
              <p className="text-muted-foreground text-sm">Upload a file or paste a database connection string.</p>
            </div>

            {/* Mode toggle */}
            <div className="flex rounded-xl p-1 gap-1" style={{ background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.06)" }}>
              {(["file", "db"] as const).map((mode) => (
                <button key={mode} onClick={() => setConnectMode(mode)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${connectMode === mode ? "text-primary-foreground font-bold" : "text-muted-foreground"}`}
                  style={connectMode === mode ? { background: "hsl(142 71% 45%)" } : undefined}>
                  {mode === "file" ? "Upload File" : "Connect Database"}
                </button>
              ))}
            </div>

            {connectMode === "file" ? (
              <>
                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
                  onClick={() => document.getElementById("fileInputDash")?.click()}
                  className="glass-card p-12 text-center cursor-pointer transition-all"
                  style={{
                    border: isDragging ? "2px dashed hsl(142 71% 45%)" : "2px dashed hsl(var(--foreground) / 0.1)",
                    background: isDragging ? "rgba(34,197,94,0.05)" : undefined,
                  }}>
                  <input id="fileInputDash" type="file" accept=".csv,.xlsx,.xls,.json" multiple
                    className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
                  <div className="mb-4 text-muted-foreground"><svg className="w-10 h-10 mx-auto opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg></div>
                  <p className="text-foreground font-semibold mb-1">
                    {isAnalyzing ? "Analyzing..." : "Drop your dataset files here"}
                  </p>
                  <p className="text-muted-foreground text-sm">CSV, Excel, or JSON · Up to 100MB · Multi-file supported</p>
                  {!isAnalyzing && (
                    <button className="mt-6 px-6 py-2.5 rounded-lg text-sm font-semibold text-primary-foreground transition-all"
                      style={{ background: "hsl(142 71% 45%)" }}>
                      Browse Files
                    </button>
                  )}
                  {isAnalyzing && (
                    <div className="mt-4 flex justify-center">
                      <div className="w-8 h-8 rounded-full border-2 border-t-green-500 border-green-500/20 animate-spin-slow" />
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* DB Connect */
              <div className="glass-card p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                    Connection String
                  </label>
                  <input type="password" value={dbUri} onChange={(e) => setDbUri(e.target.value)}
                    placeholder="postgresql://user:password@host:5432/database"
                    className="w-full px-4 py-3 rounded-lg text-sm font-mono text-foreground/90 outline-none transition-all"
                    style={{ background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.08)" }}
                    onFocus={(e) => { e.currentTarget.style.border = "1px solid rgba(34,197,94,0.4)"; }}
                    onBlur={(e) => { e.currentTarget.style.border = "1px solid hsl(var(--foreground) / 0.08)"; }}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">Connection string is never persisted — used only for schema scanning.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["postgresql://", "mysql://", "postgres://user:pass@neon.tech/db", "mysql://user:pass@host/db"].map((ex) => (
                    <button key={ex} onClick={() => setDbUri(ex)}
                      className="text-xs px-2 py-1 rounded font-mono text-muted-foreground hover:text-foreground/80 transition-colors"
                      style={{ background: "hsl(var(--foreground) / 0.03)", border: "1px solid hsl(var(--foreground) / 0.06)" }}>
                      {ex.length > 30 ? ex.slice(0, 30) + "…" : ex}
                    </button>
                  ))}
                </div>
                <button onClick={handleDBConnect} disabled={!dbUri.trim() || isAnalyzing}
                  className="w-full py-3 rounded-lg text-sm font-bold text-primary-foreground transition-all disabled:opacity-40"
                  style={{ background: "hsl(142 71% 45%)" }}>
                  {isAnalyzing ? "Connecting…" : "Scan Database Schema →"}
                </button>
              </div>
            )}

            {/* Dataset context */}
            <div className="glass-card p-4">
              <label className="block text-xs font-semibold text-muted-foreground mb-2">
                Optional Context (helps AI write better descriptions)
              </label>
              <input type="text" value={datasetContext} onChange={(e) => setDatasetContext(e.target.value)}
                placeholder="e.g. E-commerce orders data for Q3 2026, retail customers table…"
                className="w-full px-3 py-2 rounded-lg text-sm text-foreground/80 outline-none"
                style={{ background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.07)" }} />
            </div>

            {error && (
              <div className="p-4 rounded-lg text-sm text-red-400"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-8 pb-12 max-w-[1400px] mx-auto animate-fade-in">
            {/* ── OVERVIEW ─────────────────────────────────────────────── */}
            <div id="overview" className="space-y-6">
            <h2 className="text-xl font-bold text-foreground">Dataset Overview</h2>

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Rows Analyzed", value: Number(prof?.total_rows ?? 0).toLocaleString(), color: "hsl(217 91% 60%)" },
                { label: "Total Columns", value: String(prof?.total_cols ?? 0), color: "hsl(271 81% 65%)" },
                { label: "Duplicate Rows", value: String(prof?.duplicate_rows ?? 0), color: "hsl(0 84% 60%)" },
                { label: "Completeness", value: `${prof?.completeness ?? 0}%`, color: "hsl(142 71% 45%)" },
              ].map((s) => (
                <div key={s.label} className="glass-card p-5">
                  <div className="text-2xl font-bold mb-1" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Health gauge */}
            <div className="glass-card p-6 flex items-center gap-8">
              <div className="relative flex-shrink-0">
                <svg width="120" height="120" className="rotate-[-90deg]">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="hsl(var(--foreground) / 0.06)" strokeWidth="8" />
                  <circle cx="60" cy="60" r="50" fill="none" stroke={gradeColor} strokeWidth="8"
                    strokeDasharray={`${(healthScore / 100) * 314} 314`}
                    strokeLinecap="round" style={{ transition: "stroke-dasharray 1s ease" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black" style={{ color: gradeColor }}>{letterGrade}</span>
                  <span className="text-xs text-muted-foreground">{healthScore.toFixed(1)}%</span>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground mb-1">Data Health Score</h3>
                <p className="text-sm text-muted-foreground mb-3">{String(prof?.quality_label ?? "")}</p>
                <div className="flex flex-wrap gap-2">
                  {(["A", "B", "C", "D", "F"] as const).map((g) => (
                    <span key={g} className={`text-xs px-2 py-0.5 rounded font-bold ${g === letterGrade ? "text-foreground" : "text-muted-foreground"}`}
                      style={g === letterGrade ? { background: gradeColor } : { background: "hsl(var(--foreground) / 0.04)" }}>
                      {g}
                    </span>
                  ))}
                </div>
              </div>
              <div className="ml-auto hidden lg:block text-right">
                <div className="text-xs text-muted-foreground mb-3 uppercase tracking-widest">Column Types</div>
                {(["Primary Key", "DateTime", "Numeric (Float)", "Numeric (Integer)", "Category", "Text / String"] as const).map((type) => {
                  const count = columns.filter((c) => c.semantic_type === type).length;
                  if (count === 0) return null;
                  return (
                    <div key={type} className="flex items-center gap-3 mb-1">
                      <span className="text-xs text-muted-foreground w-28 text-right">{type}</span>
                      <div className="w-24 h-1.5 rounded-full" style={{ background: "hsl(var(--foreground) / 0.06)" }}>
                        <div className="h-full rounded-full" style={{ width: `${(count / columns.length) * 100}%`, background: gradeColor }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quality issues */}
            {prof?.validity_issues_detected && (
              <div className="glass-card p-5" style={{ border: "1px solid rgba(251,191,36,0.2)" }}>
                <h3 className="text-sm font-bold text-amber-400 mb-3">Quality Issues Detected</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {columns.filter((c) => c.has_validity_issues).slice(0, 6).map((c) => (
                    <div key={String(c.name)} className="flex items-center gap-2 text-xs">
                      <span className="text-amber-500">•</span>
                      <span className="text-muted-foreground font-mono">{String(c.name)}</span>
                      <span className="text-muted-foreground">— {String(c.validity_issue_pct)}% invalid values</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>

            {/* ── DICTIONARY ──────────────────────────────────────────────── */}
            <div id="dictionary">
              <ColumnDictionary
                columns={columns}
                sessionId={sessionId!}
                datasetContext={datasetContext}
              />
            </div>

            {/* ── ERD ────────────────────────────────────────────────────── */}
            <div id="erd">
              <ERDViewer columns={columns} filename={String(prof?.filename ?? "dataset")} erdMapping={erdMapping} />
            </div>


            {/* ── CHAT ───────────────────────────────────────────────────── */}
            <div id="chat">
              <ChatPanel sessionId={sessionId!} />
            </div>

            {/* ── SQL DDL ────────────────────────────────────────────────── */}
            <div id="sql">
              <SQLPanel ddl={prof?.sql_ddl as Record<string, string> ?? {}} />
            </div>

            {/* ── EXEC REPORT ────────────────────────────────────────────── */}
            <div id="exec">
              <ExecutiveReportPanel sessionId={sessionId!} datasetContext={datasetContext} />
            </div>

            {/* ── MCP ────────────────────────────────────────────────────── */}
            <div id="mcp">
              <MCPPanel sessionId={sessionId} />
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

// ── Column Dictionary component ───────────────────────────────────────────────

function ColumnDictionary({
  columns, sessionId, datasetContext,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: any[];
  sessionId: string;
  datasetContext: string;
}) {
  const [search, setSearch] = useState("");
  const [enriching, setEnriching] = useState<number | null>(null);
  const [cols, setCols] = useState(columns);

  const filtered = cols.filter((c) =>
    String(c.name).toLowerCase().includes(search.toLowerCase())
  );

  const enrichColumn = async (idx: number) => {
    setEnriching(idx);
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, column_index: idx, dataset_context: datasetContext }),
    });
    const data = await res.json();
    if (res.ok) {
      setCols((prev) => prev.map((c, i) => i === idx ? { ...c, description: data.description, recommendation: data.recommendation } : c));
    }
    setEnriching(null);
  };

  const enrichAll = async () => {
    for (let i = 0; i < cols.length; i++) {
      if (String(cols[i].description ?? "").includes("pending")) {
        await enrichColumn(i);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  };

  const TYPE_COLORS: Record<string, string> = {
    "Primary Key": "rgba(74,222,128,0.15)/hsl(142 71% 55%)",
    "Email Address": "rgba(96,165,250,0.15)/hsl(217 91% 70%)",
    "DateTime": "rgba(167,139,250,0.15)/hsl(271 81% 75%)",
    "Numeric (Float)": "rgba(251,191,36,0.15)/hsl(43 96% 65%)",
    "Numeric (Integer)": "rgba(251,191,36,0.15)/hsl(43 96% 65%)",
    "Category": "rgba(34,211,238,0.15)/hsl(186 100% 55%)",
  };

  const getTypeBadge = (type: string) => {
    const colors = TYPE_COLORS[type]?.split("/") ?? ["hsl(var(--foreground) / 0.08)", "hsl(var(--muted-foreground))"];
    return { bg: colors[0], color: colors[1] };
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold text-foreground flex-shrink-0">Data Dictionary</h2>
        <div className="flex-1 min-w-[200px]">
          <input type="search" placeholder="Search columns…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm text-foreground/80 outline-none"
            style={{ background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.08)" }} />
        </div>
        <button onClick={enrichAll}
          className="px-4 py-2 rounded-lg text-xs font-bold text-primary-foreground transition-all flex-shrink-0"
          style={{ background: "hsl(142 71% 45%)" }}>
          Enrich All with AI
        </button>
      </div>
      <div className="text-xs text-muted-foreground">{filtered.length} of {cols.length} columns</div>

      <div className="grid gap-3">
        {filtered.map((col, displayIdx) => {
          const idx = cols.indexOf(col);
          const badge = getTypeBadge(String(col.semantic_type));
          const isPending = String(col.description ?? "").includes("pending");

          return (
            <div key={String(col.name)} className="glass-card p-5 hover:border-white/15 transition-all">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <span className="font-mono text-sm font-bold text-foreground">{String(col.name)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{String(col.pandas_dtype)}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: badge.bg, color: badge.color }}>
                    {String(col.semantic_type)}
                  </span>
                  <button onClick={() => enrichColumn(idx)} disabled={enriching === idx}
                    className="text-xs px-2 py-1 rounded transition-all"
                    style={{ background: "rgba(34,197,94,0.1)", color: "hsl(142 71% 55%)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    {enriching === idx ? "..." : "Enrich"}
                  </button>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
                <span><span className="text-muted-foreground">Missing: </span>{String(col.null_percentage)}%</span>
                <span><span className="text-muted-foreground">Unique: </span>{String(col.unique_count)}</span>
                {col.mean !== null && <span><span className="text-muted-foreground">Mean: </span>{Number(col.mean).toFixed(2)}</span>}
                {Number(col.outliers_count) > 0 && (
                  <span className="text-amber-500">{String(col.outliers_count)} outliers</span>
                )}
              </div>

              {/* Sample values */}
              <div className="text-xs text-muted-foreground mb-3 font-mono">
                Samples: {String(col.sample_data)}
              </div>

              {/* AI description */}
              {isPending ? (
                <div className="text-xs text-muted-foreground italic">Click Enrich to generate AI description</div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs text-foreground/80">{String(col.description)}</p>
                  {col.recommendation && (
                    <p className="text-xs text-muted-foreground italic">{String(col.recommendation)}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect } from "react";
import mermaid from "mermaid";

// ── ERD Viewer ────────────────────────────────────────────────────────────────

interface ERDViewerProps {
  columns: Record<string, unknown>[];
  filename: string;
  erdMapping?: {
    nodes: { id: string; label: string; columns: string[] }[];
    links: { source: string; target: string; label: string }[];
  } | null;
}

function ERDViewer({ columns, filename, erdMapping }: ERDViewerProps) {
  const { resolvedTheme } = useTheme();
  const currentTheme = resolvedTheme === "light" ? "default" : "dark";

  const cleanAttr = (name: string) => {
    let clean = name.replace(/[^a-zA-Z0-9_]/g, "_");
    if (/^[0-9]/.test(clean)) clean = "_" + clean;
    return clean || "Col";
  };

  let mermaidCode = "";
  if (erdMapping && erdMapping.nodes && erdMapping.nodes.length > 0) {
    mermaidCode = "graph TD\n";
    erdMapping.nodes.forEach((node) => {
      const cleanNodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
      mermaidCode += `  ${cleanNodeId}[("${cleanNodeId}")]\n`;
      mermaidCode += `  style ${cleanNodeId} fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff\n`;
      const cols = node.columns || [];
      cols.slice(0, 7).forEach((col) => {
        const cleanCol = cleanAttr(col) + "_" + cleanNodeId;
        mermaidCode += `  ${cleanNodeId} --- ${cleanCol}[${cleanAttr(col)}]\n`;
      });
    });
    erdMapping.links.forEach((link) => {
      const cleanSrc = link.source.replace(/[^a-zA-Z0-9_]/g, "_");
      const cleanTgt = link.target.replace(/[^a-zA-Z0-9_]/g, "_");
      const cleanLabel = link.label.replace(/[^a-zA-Z0-9_\s]/g, "_");
      mermaidCode += `  ${cleanSrc} -->|"${cleanLabel}"| ${cleanTgt}\n`;
    });
  } else {
    const tableName = filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
    const pkCols = columns.filter((c) => String(c.semantic_type) === "Primary Key").map((c) => String(c.name));
    const numCols = columns.filter((c) => ["Numeric (Integer)", "Numeric (Float)", "Currency"].includes(String(c.semantic_type))).map((c) => String(c.name));
    const dateCols = columns.filter((c) => String(c.semantic_type) === "DateTime").map((c) => String(c.name));
    const otherCols = columns.filter((c) => !pkCols.includes(String(c.name)) && !numCols.includes(String(c.name)) && !dateCols.includes(String(c.name))).map((c) => String(c.name));

    mermaidCode = `graph TD\n  Dataset[("${tableName}")]\n  style Dataset fill:#22c55e,stroke:#fff,stroke-width:2px,color:#fff\n`;
    pkCols.forEach((c) => {
      const cleanC = cleanAttr(c);
      mermaidCode += `  Dataset --- ${cleanC}[${cleanC}]\n  style ${cleanC} fill:#3b82f6,color:#fff,stroke:#fff,stroke-dasharray: 5 5\n`;
    });
    numCols.slice(0, 5).forEach((c) => {
      const cleanC = cleanAttr(c);
      mermaidCode += `  Dataset --- ${cleanC}[${cleanC}]\n  style ${cleanC} fill:#eab308,color:#000,stroke:#fff\n`;
    });
    dateCols.slice(0, 3).forEach((c) => {
      const cleanC = cleanAttr(c);
      mermaidCode += `  Dataset --- ${cleanC}[${cleanC}]\n  style ${cleanC} fill:#a855f7,color:#fff,stroke:#fff\n`;
    });
    otherCols.slice(0, 5).forEach((c) => {
      const cleanC = cleanAttr(c);
      mermaidCode += `  Dataset --- ${cleanC}[${cleanC}]\n  style ${cleanC} fill:#333,color:#fff,stroke:#666\n`;
    });
  }

  const mermaidRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: currentTheme });
    if (mermaidRef.current) {
      mermaidRef.current.innerHTML = "";
      mermaid.render("mermaid-graph", mermaidCode).then((result) => {
        if (mermaidRef.current) mermaidRef.current.innerHTML = result.svg;
      }).catch(console.error);
    }
  }, [mermaidCode, currentTheme]);

  return (
    <div className="space-y-4 animate-fade-in">
      <h2 className="text-xl font-bold text-foreground">ERD & Schema Map</h2>
      <div className="glass-card p-6">
        <p className="text-xs text-muted-foreground mb-4">Mermaid ERD Visualization</p>
        <div ref={mermaidRef} className="flex justify-center overflow-x-auto bg-background p-4 rounded-lg border border-foreground/10 min-h-[300px]" />
        
        <details className="mt-4">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">View/Copy Mermaid Code</summary>
          <pre className="mt-2 text-xs text-green-400 font-mono p-4 rounded-lg overflow-auto"
            style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--foreground) / 0.06)" }}>
            {mermaidCode}
          </pre>
          <button onClick={() => navigator.clipboard.writeText(mermaidCode)}
            className="mt-3 text-xs px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(34,197,94,0.1)", color: "hsl(142 71% 55%)", border: "1px solid rgba(34,197,94,0.2)" }}>
            Copy Mermaid Code
          </button>
        </details>
      </div>
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────

function ChatPanel({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([
    { role: "ai", content: "Hello! I am SchemaScribe's AI Assistant. Ask me any question about your data, and I'll write and execute Pandas code to find the answer." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const convertBlobToWav = async (audioBlob: Blob): Promise<Blob> => {
    const arrayBuffer = await audioBlob.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new SpeechAudioContext();

    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }

    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const monoData = new Float32Array(length);

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        monoData[i] += channelData[i] / numChannels;
      }
    }

    const int16 = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      const clamped = Math.max(-1, Math.min(1, monoData[i]));
      int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
    }

    const dataBytes = int16.length * 2;
    const wavBuffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(wavBuffer);
    const writeStr = (off: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(off + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataBytes, true);

    new Uint8Array(wavBuffer, 44).set(new Uint8Array(int16.buffer));

    return new Blob([wavBuffer], { type: 'audio/wav' });
  };

  const toggleListening = async () => {
    if (isListening) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      setIsListening(false);
    } else {
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        alert("Your browser does not support audio recording.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onstop = async () => {
          stream.getTracks().forEach((track) => track.stop());

          const webmBlob = new Blob(audioChunksRef.current, { type: mimeType });
          try {
            setLoading(true);
            const wavBlob = await convertBlobToWav(webmBlob);
            const formData = new FormData();
            formData.append('audio', wavBlob, 'recording.wav');

            const res = await fetch("/api/voice-to-text", {
              method: "POST",
              body: formData,
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || `Server error ${res.status}`);
            }

            const data = await res.json();
            if (data.transcript) {
              setInput(prev => prev + (prev ? " " : "") + data.transcript);
            } else {
              alert("No speech detected. Please speak clearly.");
            }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (err: any) {
            console.error("Sarvam Voice transcription error:", err);
            alert(`Voice transcription failed: ${err.message}`);
          } finally {
            setLoading(false);
          }
        };

        recorder.start();
        setIsListening(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        console.error("Microphone access error:", err);
        alert(`Microphone error: ${err.message || err.name}`);
      }
    }
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: userMsg }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "ai", content: data.reply ?? data.error ?? "No response" }]);
    } catch {
      setMessages((prev) => [...prev, { role: "ai", content: "Error reaching AI service." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[70vh] animate-fade-in glass-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground) / 0.1)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-4 border-b border-white/[0.05]" style={{ background: "hsl(var(--foreground) / 0.02)" }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-500/10 text-green-500 border border-green-500/20">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" strokeWidth="3" strokeLinecap="round" />
            <line x1="16" y1="16" x2="16" y2="16" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-foreground">Chat with your Dataset</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-black/20">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "ai" && (
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-500/10 text-green-500 border border-green-500/20 mr-3 flex-shrink-0 mt-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                </svg>
              </div>
            )}
            <div className={`max-w-[80%] px-5 py-3.5 rounded-2xl text-sm leading-relaxed ${m.role === "user" ? "text-foreground rounded-tr-sm" : "text-foreground/90 rounded-tl-sm"}`}
              style={m.role === "user"
                ? { background: "hsl(var(--foreground) / 0.1)", border: "1px solid hsl(var(--foreground) / 0.15)" }
                : { background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.08)" }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-green-500/10 text-green-500 border border-green-500/20 mr-3 flex-shrink-0">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                </svg>
            </div>
            <div className="px-5 py-3.5 rounded-2xl rounded-tl-sm text-sm text-muted-foreground flex items-center gap-1.5"
              style={{ background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.08)" }}>
              <span className="w-1.5 h-1.5 bg-green-500/50 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-green-500/50 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
              <span className="w-1.5 h-1.5 bg-green-500/50 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
            </div>
          </div>
        )}
      </div>

      {/* Input Box */}
      <div className="p-4 border-t border-white/[0.05] bg-black/40">
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea 
              value={input} 
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask a question...e.g. 'What is the average price?'"
              className="w-full pl-4 pr-12 py-3.5 rounded-xl text-sm text-foreground/90 outline-none resize-none overflow-hidden block min-h-[50px] max-h-[150px]"
              style={{ background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.1)" }} 
              rows={1}
            />
          </div>
          <button onClick={send} disabled={loading || !input.trim()}
            className="w-12 h-12 flex items-center justify-center rounded-xl transition-all disabled:opacity-40 hover:bg-green-600/90 flex-shrink-0"
            style={{ background: "hsl(142 71% 45%)", color: "white" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
          <button onClick={toggleListening} title="Sarvam Voice Input"
            className={`w-12 h-12 flex items-center justify-center rounded-xl transition-all flex-shrink-0 ${isListening ? "animate-pulse" : ""}`}
            style={{ 
              background: isListening ? "rgba(34,197,94,0.15)" : "hsl(142 71% 45%)", 
              border: isListening ? "1px solid rgba(34,197,94,0.3)" : "none",
              color: isListening ? "hsl(142 71% 55%)" : "white" 
            }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SQL DDL Panel ─────────────────────────────────────────────────────────────

function SQLPanel({ ddl }: { ddl: Record<string, string> }) {
  const dialects = ["postgresql", "mysql", "sqlite", "snowflake", "sql_server", "oracle"];
  const [active, setActive] = useState("postgresql");
  const code = ddl[active] ?? "-- DDL not yet generated. Open Analyze tab first.";

  return (
    <div className="space-y-4 animate-fade-in">
      <h2 className="text-xl font-bold text-foreground">SQL DDL Generator</h2>
      <div className="flex flex-wrap gap-1">
        {dialects.map((d) => (
          <button key={d} onClick={() => setActive(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active === d ? "text-primary-foreground font-bold" : "text-muted-foreground"}`}
            style={active === d ? { background: "hsl(142 71% 45%)" } : { background: "hsl(var(--foreground) / 0.04)", border: "1px solid hsl(var(--foreground) / 0.07)" }}>
            {d}
          </button>
        ))}
      </div>
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05]">
          <span className="text-xs text-muted-foreground font-mono">{active}.sql</span>
          <div className="flex gap-2">
            <button onClick={() => navigator.clipboard.writeText(code)}
              className="text-xs px-3 py-1 rounded transition-all"
              style={{ background: "rgba(34,197,94,0.1)", color: "hsl(142 71% 55%)" }}>
              Copy
            </button>
            <button onClick={() => { const a = document.createElement("a"); a.href = `data:text/sql;charset=utf-8,${encodeURIComponent(code)}`; a.download = `schema_${active}.sql`; a.click(); }}
              className="text-xs px-3 py-1 rounded transition-all"
              style={{ background: "hsl(var(--foreground) / 0.05)", color: "hsl(var(--muted-foreground))" }}>
              Download
            </button>
          </div>
        </div>
        <pre className="text-xs text-green-400 font-mono p-5 overflow-auto max-h-[60vh]">
          {code}
        </pre>
      </div>
    </div>
  );
}

// ── Executive Report Panel ────────────────────────────────────────────────────

function ExecutiveReportPanel({ sessionId, datasetContext }: { sessionId: string; datasetContext: string }) {
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/executive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, dataset_context: datasetContext }),
      });
      const data = await res.json();
      if (res.ok) setReport(data.report);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Executive AI Report</h2>
        <button onClick={generate} disabled={loading}
          className="px-5 py-2 rounded-lg text-sm font-bold text-primary-foreground transition-all disabled:opacity-50"
          style={{ background: "hsl(142 71% 45%)" }}>
          {loading ? "Generating…" : "Generate Report"}
        </button>
      </div>
      {!report && !loading && (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-sm">Click &quot;Generate Report&quot; to create an AI-powered executive brief.</p>
        </div>
      )}
      {report && (
        <div className="space-y-4">
          <div className="glass-card p-6">
            <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "hsl(142 71% 45%)" }}>Domain</div>
            <h3 className="text-2xl font-bold text-foreground">{String(report.domain_label)}</h3>
          </div>
          {[
            { key: "business_overview", label: "Business Overview" },
            { key: "governance_scope", label: "Governance Scope" },
            { key: "health_assessment", label: "Health Assessment" },
          ].map(({ key, label }) => (
            <div key={key} className="glass-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{label}</div>
              <p className="text-sm text-foreground/80 leading-relaxed">{String(report[key])}</p>
            </div>
          ))}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="glass-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Key Findings</div>
              <ul className="space-y-2">
                {(report.key_findings as string[] ?? []).map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span style={{ color: "hsl(142 71% 45%)" }}>→</span> {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="glass-card p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Recommendations</div>
              <ul className="space-y-2">
                {(report.recommendations as string[] ?? []).map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80">
                    <span style={{ color: "hsl(43 96% 56%)" }}>•</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MCP Panel ─────────────────────────────────────────────────────────────────

function MCPPanel({ sessionId }: { sessionId: string | null }) {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://your-app.vercel.app";
  const config = JSON.stringify({
    mcpServers: {
      schemascribe: {
        command: "npx",
        args: ["schemascribe-mcp@latest"],
        env: {
          SCHEMASCRIBE_BASE_URL: baseUrl,
          SCHEMASCRIBE_API_KEY: "your-api-key",
          SCHEMASCRIBE_SESSION_ID: sessionId ?? "your-session-id",
        },
      },
    },
  }, null, 2);

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-foreground">MCP Server Integration</h2>
      <p className="text-sm text-muted-foreground">Use SchemaScribe directly from VS Code, Cursor, or any MCP-compatible editor.</p>

      <div className="glass-card p-6">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Add to .cursor/mcp.json</div>
        <pre className="text-xs text-green-400 font-mono p-4 rounded-lg overflow-auto"
          style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--foreground) / 0.06)" }}>
          {config}
        </pre>
        <button onClick={() => navigator.clipboard.writeText(config)}
          className="mt-3 text-xs px-4 py-2 rounded-lg transition-all"
          style={{ background: "rgba(34,197,94,0.1)", color: "hsl(142 71% 55%)", border: "1px solid rgba(34,197,94,0.2)" }}>
          Copy Config
        </button>
      </div>

      <div className="glass-card p-6">
        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Available MCP Tools</div>
        <div className="grid gap-3">
          {[
            { name: "scan_schema", desc: "Profile a file or live database" },
            { name: "get_column_info", desc: "Get details for a specific column" },
            { name: "chat_with_data", desc: "Ask natural language questions" },
            { name: "get_data_quality", desc: "Health score and quality issues" },
            { name: "generate_ddl", desc: "Get CREATE TABLE SQL script" },
            { name: "executive_report", desc: "AI-generated business report" },
          ].map((tool) => (
            <div key={tool.name} className="flex items-center gap-3">
              <span className="font-mono text-xs px-2 py-1 rounded"
                style={{ background: "rgba(34,197,94,0.08)", color: "hsl(142 71% 55%)", border: "1px solid rgba(34,197,94,0.15)" }}>
                {tool.name}
              </span>
              <span className="text-xs text-muted-foreground">{tool.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
