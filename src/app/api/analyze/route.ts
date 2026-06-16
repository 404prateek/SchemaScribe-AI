import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { profileDataset, generateERDMapping } from "@/lib/profiler";
import { generateDDLScripts } from "@/lib/ddlGenerator";
import { storeSession, storeFileBytes } from "@/lib/kvStore";
import type { SessionData, AnalyzeResponse, DatasetProfile } from "@/types";
import { randomUUID } from "crypto";

// Parse uploaded file bytes into rows
async function parseFile(
  bytes: Buffer,
  filename: string
): Promise<Record<string, unknown>[]> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "csv") {
    const Papa = (await import("papaparse")).default;
    const text = bytes.toString("utf-8");
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    return result.data;
  }

  if (ext === "xlsx" || ext === "xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(bytes, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  }

  if (ext === "json") {
    const parsed = JSON.parse(bytes.toString("utf-8"));
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  throw new Error(`Unsupported file format: .${ext}. Upload .csv, .xlsx, or .json`);
}

const MAX_BYTES = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];
  const datasetContext = (formData.get("dataset_context") as string) ?? "";

  if (!files || files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const isMulti = files.length > 1;
  const sessionId = randomUUID();
  const profiles: { filename: string; profile: DatasetProfile; fileBytes: Buffer }[] = [];

  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx", "xls", "json"].includes(ext ?? "")) continue;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    if (bytes.length > MAX_BYTES) {
      return NextResponse.json(
        { error: `${file.name} exceeds the 100MB limit.` },
        { status: 413 }
      );
    }

    const rows = await parseFile(bytes, file.name);
    const profile = profileDataset(rows, file.name);

    // Pre-fill AI placeholders
    for (const col of profile.columns) {
      if (col.null_percentage === 100 || col.semantic_type === "Empty / Missing") {
        col.description = "This column contains no valid data (100% missing).";
        col.recommendation = "Drop this column or investigate the data pipeline.";
      }
    }

    if (!isMulti) {
      profile.sql_ddl = generateDDLScripts(file.name, profile.columns);
    }

    profiles.push({ filename: file.name, profile, fileBytes: bytes });
  }

  if (profiles.length === 0) {
    return NextResponse.json({ error: "No valid files found." }, { status: 400 });
  }

  if (!isMulti) {
    const { filename, profile, fileBytes } = profiles[0];
    const fileId = `${sessionId}_${filename}`;

    // Cache file bytes for chat access
    await storeFileBytes(fileId, fileBytes.toString("base64"));

    const sessionData: SessionData = {
      id: sessionId,
      source_type: "file",
      filename,
      data: profile,
      created_at: Date.now(),
    };
    await storeSession(sessionId, sessionData);

    return NextResponse.json({
      status: "success",
      session_id: sessionId,
      filename,
      profile,
      is_multi: false,
      source_type: "file",
    } satisfies AnalyzeResponse);
  }

  // Multi-file: merge + ERD
  const erdMapping = generateERDMapping(
    profiles.map(({ filename, profile }) => ({
      filename,
      columns: profile.columns,
    }))
  );

  const mergedProfile: DatasetProfile = {
    total_rows: profiles.reduce((a, p) => a + p.profile.total_rows, 0),
    total_cols: profiles.reduce((a, p) => a + p.profile.total_cols, 0),
    duplicate_rows: profiles.reduce((a, p) => a + p.profile.duplicate_rows, 0),
    completeness: Math.round(
      (profiles.reduce((a, p) => a + p.profile.completeness, 0) / profiles.length) * 100
    ) / 100,
    health_score: Math.round(
      (profiles.reduce((a, p) => a + p.profile.health_score, 0) / profiles.length) * 100
    ) / 100,
    quality_label: "Multi-file workspace",
    anomaly_penalty: 0,
    validity_issues_detected: false,
    columns: profiles.flatMap(({ filename, profile }) => {
      const base = filename.replace(/\.[^/.]+$/, "");
      return profile.columns.map((c) => ({ ...c, name: `${base}.${c.name}` }));
    }),
    charts: {},
    sql_ddl: {},
    filename: "Multi-File Workspace",
  };

  const sessionData: SessionData = {
    id: sessionId,
    source_type: "file",
    filename: "Multi-File Workspace",
    data: mergedProfile,
    created_at: Date.now(),
  };
  await storeSession(sessionId, sessionData);

  return NextResponse.json({
    status: "success",
    session_id: sessionId,
    filename: "Multi-File Workspace",
    profile: mergedProfile,
    is_multi: true,
    erd_mapping: erdMapping,
    source_type: "file",
  } satisfies AnalyzeResponse);
}
