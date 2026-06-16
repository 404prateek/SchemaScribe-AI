// ── Shared TypeScript types for SchemaScribe AI v2 ──────────────────────────

export type SemanticType =
  | "Primary Key"
  | "Unique Identifier"
  | "Aadhaar ID"
  | "GSTIN"
  | "IFSC Code"
  | "PAN Number"
  | "Email Address"
  | "URL / Link"
  | "Phone Number"
  | "DateTime"
  | "Blood Pressure"
  | "Currency"
  | "Zip / Postal Code"
  | "Boolean / Flag"
  | "Category"
  | "Numeric (Integer)"
  | "Numeric (Float)"
  | "Text / String"
  | "Empty / Missing";

export interface ColumnOutlier {
  row_index: number;
  value: number;
  context: Record<string, unknown>;
}

export interface ColumnProfile {
  name: string;
  pandas_dtype: string; // kept for compat — now JS dtype
  semantic_type: SemanticType;
  non_null_count: number;
  null_count: number;
  null_percentage: number;
  unique_count: number;
  unique_ratio: number;
  mean: number | null;
  std: number | null;
  min: string | number | null;
  max: string | number | null;
  outliers_count: number;
  top_outliers: ColumnOutlier[];
  sample_data: string;
  has_validity_issues: boolean;
  validity_issue_pct: number;
  description: string;
  recommendation: string;
}

export interface ChartAggregate {
  column: string;
  target: string;
  data: Record<string, number>;
}

export interface DatasetProfile {
  total_rows: number;
  total_cols: number;
  duplicate_rows: number;
  completeness: number;
  health_score: number;
  quality_label: string;
  anomaly_penalty: number;
  validity_issues_detected: boolean;
  columns: ColumnProfile[];
  charts: {
    categorical_1?: ChartAggregate;
    categorical_2?: ChartAggregate;
    temporal?: ChartAggregate;
  };
  sql_ddl?: Record<string, string>;
  filename?: string;
}

export interface ERDNode {
  id: string;
  label: string;
  columns: string[];
}

export interface ERDLink {
  source: string;
  target: string;
  label: string;
}

export interface ERDMapping {
  nodes: ERDNode[];
  links: ERDLink[];
}

// ── Session / Cache types ────────────────────────────────────────────────────

export type SourceType = "file" | "database";

export interface SessionData {
  id: string;
  source_type: SourceType;
  filename: string;
  file_path?: string;         // temp file path (file uploads)
  connection_string?: string; // for DB sessions (never persisted long-term)
  db_type?: DBType;
  data: DatasetProfile;
  created_at: number;
}

export interface MultiFileSession {
  id: string;
  source_type: "file";
  is_multi: true;
  files: { file_id: string; filename: string }[];
  merged_profile: DatasetProfile;
  erd_mapping: ERDMapping;
  created_at: number;
}

// ── Database scanner types ───────────────────────────────────────────────────

export type DBType = "postgresql" | "mysql" | "mssql" | "snowflake";

export interface DBColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  references_table?: string;
  references_column?: string;
  default_value?: string;
  max_length?: number;
}

export interface DBTable {
  name: string;
  schema?: string;
  row_count: number;
  columns: DBColumn[];
  indexes: string[];
  sample_data?: Record<string, unknown>[];
}

export interface DBScanResult {
  db_type: DBType;
  database_name: string;
  tables: DBTable[];
  total_tables: number;
  total_columns: number;
  scan_duration_ms: number;
}

// ── Chat types ───────────────────────────────────────────────────────────────

export interface ChatResponse {
  reply: string;
  code?: string;
  table_data?: {
    columns: string[];
    rows: (string | number | boolean | null)[][];
  };
  success: boolean;
}

// ── Analysis response ────────────────────────────────────────────────────────

export interface AnalyzeResponse {
  status: "success" | "error";
  session_id: string;
  filename: string;
  profile: DatasetProfile;
  is_multi: boolean;
  erd_mapping?: ERDMapping;
  source_type: SourceType;
}

// ── DDL types ────────────────────────────────────────────────────────────────

export type DDLDialect = "postgresql" | "mysql" | "sqlite" | "snowflake" | "sql_server" | "oracle";

// ── Executive Report ─────────────────────────────────────────────────────────

export interface ExecutiveReport {
  domain_label: string;
  business_overview: string;
  key_findings: string[];
  governance_scope: string;
  health_assessment: string;
  recommendations: string[];
}

// ── MCP types ────────────────────────────────────────────────────────────────

export interface MCPScanSchemaArgs {
  session_id?: string;
  connection_string?: string;
  db_type?: DBType;
}
