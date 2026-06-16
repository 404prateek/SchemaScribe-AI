import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scanDatabase } from "@/lib/dbScanner";
import { generateDDLScripts } from "@/lib/ddlGenerator";
import { storeSession } from "@/lib/kvStore";
import { generateERDMapping } from "@/lib/profiler";
import type { DBScanResult, SessionData, ColumnProfile, SemanticType } from "@/types";
import { randomUUID } from "crypto";

function dbColumnToProfile(col: {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
}): ColumnProfile {
  let semanticType: SemanticType = "Text / String";
  if (col.is_primary_key) semanticType = "Primary Key";
  else if (col.is_foreign_key) semanticType = "Unique Identifier";
  else {
    const dt = col.data_type.toLowerCase();
    if (["integer", "int", "bigint", "smallint", "serial", "number"].some((t) => dt.includes(t))) semanticType = "Numeric (Integer)";
    else if (["float", "double", "decimal", "numeric", "real"].some((t) => dt.includes(t))) semanticType = "Numeric (Float)";
    else if (["timestamp", "datetime", "date", "time"].some((t) => dt.includes(t))) semanticType = "DateTime";
    else if (["bool", "bit", "tinyint(1)"].some((t) => dt.includes(t))) semanticType = "Boolean / Flag";
  }

  return {
    name: col.name,
    pandas_dtype: col.data_type,
    semantic_type: semanticType,
    non_null_count: 0,
    null_count: 0,
    null_percentage: col.is_nullable ? 0 : 0,
    unique_count: 0,
    unique_ratio: 0,
    mean: null,
    std: null,
    min: null,
    max: null,
    outliers_count: 0,
    top_outliers: [],
    sample_data: "N/A (Live DB)",
    has_validity_issues: false,
    validity_issue_pct: 0,
    description: "AI description pending...",
    recommendation: "AI recommendation pending...",
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { connection_string, db_type } = await req.json();

  if (!connection_string) {
    return NextResponse.json({ error: "connection_string is required" }, { status: 400 });
  }

  let scanResult: DBScanResult;
  try {
    scanResult = await scanDatabase(connection_string, db_type);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown connection error";
    return NextResponse.json(
      { error: `Database connection failed: ${msg}` },
      { status: 422 }
    );
  }

  const sessionId = randomUUID();

  // Convert DB tables into a dataset profile-like structure
  const allColumns: ColumnProfile[] = scanResult.tables.flatMap((t) =>
    t.columns.map((col) => ({
      ...dbColumnToProfile(col),
      name: `${t.name}.${col.name}`,
    }))
  );

  // ERD from FK relationships
  const erdMapping = generateERDMapping(
    scanResult.tables.map((t) => ({
      filename: t.name,
      columns: t.columns.map(dbColumnToProfile),
    }))
  );

  const profile = {
    total_rows: scanResult.tables.reduce((a, t) => a + t.row_count, 0),
    total_cols: scanResult.total_columns,
    duplicate_rows: 0,
    completeness: 100,
    health_score: 92,
    quality_label: "Live database schema scan — file-based quality metrics N/A.",
    anomaly_penalty: 0,
    validity_issues_detected: false,
    columns: allColumns,
    charts: {},
    sql_ddl: Object.fromEntries(
      scanResult.tables.slice(0, 5).map((t) => {
        const cols = t.columns.map(dbColumnToProfile);
        const scripts = generateDDLScripts(t.name, cols);
        return [t.name, scripts.postgresql ?? ""];
      })
    ),
    filename: `${scanResult.database_name} (${scanResult.db_type})`,
  };

  const sessionData: SessionData = {
    id: sessionId,
    source_type: "database",
    filename: `${scanResult.database_name} (${scanResult.db_type})`,
    db_type: scanResult.db_type,
    data: profile,
    created_at: Date.now(),
  };
  await storeSession(sessionId, sessionData);

  return NextResponse.json({
    status: "success",
    session_id: sessionId,
    db_scan: scanResult,
    profile,
    erd_mapping: erdMapping,
    source_type: "database",
    filename: sessionData.filename,
    is_multi: scanResult.tables.length > 1,
  });
}
