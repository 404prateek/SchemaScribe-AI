/**
 * dbScanner.ts — Live database schema scanner
 * Supports PostgreSQL, MySQL, SQL Server (read-only, information_schema only)
 */

import type { DBScanResult, DBTable, DBColumn, DBType } from "@/types";

const QUERY_TIMEOUT_MS = 15000;

// ── PostgreSQL ────────────────────────────────────────────────────────────────

export async function scanPostgres(connectionString: string): Promise<DBScanResult> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    ssl: connectionString.includes("sslmode=require") || connectionString.includes("neon") || connectionString.includes("supabase")
      ? { rejectUnauthorized: false }
      : false,
  });

  const start = Date.now();

  try {
    const client = await pool.connect();

    // Get database name
    const dbRes = await client.query("SELECT current_database() AS db");
    const dbName = dbRes.rows[0]?.db ?? "unknown";

    // Get all tables + row counts
    const tablesRes = await client.query(`
      SELECT
        t.table_schema,
        t.table_name,
        COALESCE(s.reltuples::bigint, 0) AS approx_rows
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = t.table_schema AND s.relname = t.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY t.table_schema, t.table_name
      LIMIT 100
    `);

    // Get all columns
    const columnsRes = await client.query(`
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.table_schema, ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.table_schema = c.table_schema
           AND pk.table_name = c.table_name
           AND pk.column_name = c.column_name
      WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
      LIMIT 2000
    `);

    // Get FK relationships
    const fkRes = await client.query(`
      SELECT
        kcu.table_schema,
        kcu.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
      LIMIT 500
    `);

    client.release();
    await pool.end();

    // Build FK lookup
    const fkMap: Record<string, { table: string; col: string }> = {};
    for (const fk of fkRes.rows) {
      fkMap[`${fk.table_schema}.${fk.table_name}.${fk.column_name}`] = {
        table: fk.foreign_table_name,
        col: fk.foreign_column_name,
      };
    }

    // Build column map
    const colsByTable: Record<string, DBColumn[]> = {};
    for (const col of columnsRes.rows) {
      const key = `${col.table_schema}.${col.table_name}`;
      if (!colsByTable[key]) colsByTable[key] = [];
      const fkKey = `${col.table_schema}.${col.table_name}.${col.column_name}`;
      const fkRef = fkMap[fkKey];
      colsByTable[key].push({
        name: col.column_name,
        data_type: col.data_type,
        is_nullable: col.is_nullable === "YES",
        is_primary_key: col.is_pk === true,
        is_foreign_key: !!fkRef,
        references_table: fkRef?.table,
        references_column: fkRef?.col,
        default_value: col.column_default,
        max_length: col.character_maximum_length,
      });
    }

    // Build tables
    const tables: DBTable[] = tablesRes.rows.map((t) => ({
      name: t.table_name,
      schema: t.table_schema,
      row_count: Number(t.approx_rows),
      columns: colsByTable[`${t.table_schema}.${t.table_name}`] ?? [],
      indexes: [],
    }));

    return {
      db_type: "postgresql",
      database_name: dbName,
      tables,
      total_tables: tables.length,
      total_columns: tables.reduce((acc, t) => acc + t.columns.length, 0),
      scan_duration_ms: Date.now() - start,
    };
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
}

// ── MySQL ────────────────────────────────────────────────────────────────────

export async function scanMySQL(connectionString: string): Promise<DBScanResult> {
  const mysql = await import("mysql2/promise");

  // Parse connection string: mysql://user:pass@host:port/database
  const url = new URL(connectionString);
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port ?? "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ""),
    connectTimeout: QUERY_TIMEOUT_MS,
    ssl: { rejectUnauthorized: false },
  });

  const start = Date.now();

  try {
    const [tables] = await conn.execute(`
      SELECT
        TABLE_NAME,
        TABLE_ROWS
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
      LIMIT 100
    `) as [{ TABLE_NAME: string; TABLE_ROWS: number }[], unknown];

    const [columns] = await conn.execute(`
      SELECT
        c.TABLE_NAME,
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.COLUMN_DEFAULT,
        c.CHARACTER_MAXIMUM_LENGTH,
        c.COLUMN_KEY
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE()
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
      LIMIT 2000
    `) as [{ TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string; COLUMN_DEFAULT: string; CHARACTER_MAXIMUM_LENGTH: number; COLUMN_KEY: string }[], unknown];

    await conn.end();

    const colsByTable: Record<string, DBColumn[]> = {};
    for (const col of columns) {
      if (!colsByTable[col.TABLE_NAME]) colsByTable[col.TABLE_NAME] = [];
      colsByTable[col.TABLE_NAME].push({
        name: col.COLUMN_NAME,
        data_type: col.DATA_TYPE,
        is_nullable: col.IS_NULLABLE === "YES",
        is_primary_key: col.COLUMN_KEY === "PRI",
        is_foreign_key: col.COLUMN_KEY === "MUL",
        default_value: col.COLUMN_DEFAULT,
        max_length: col.CHARACTER_MAXIMUM_LENGTH,
      });
    }

    const dbTables: DBTable[] = tables.map((t) => ({
      name: t.TABLE_NAME,
      row_count: t.TABLE_ROWS ?? 0,
      columns: colsByTable[t.TABLE_NAME] ?? [],
      indexes: [],
    }));

    const dbName = new URL(connectionString).pathname.replace(/^\//, "");
    return {
      db_type: "mysql",
      database_name: dbName,
      tables: dbTables,
      total_tables: dbTables.length,
      total_columns: dbTables.reduce((acc, t) => acc + t.columns.length, 0),
      scan_duration_ms: Date.now() - start,
    };
  } catch (err) {
    await conn.end().catch(() => {});
    throw err;
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function scanDatabase(
  connectionString: string,
  dbType?: DBType
): Promise<DBScanResult> {
  const lc = connectionString.toLowerCase();
  const resolved: DBType =
    dbType ??
    (lc.startsWith("postgresql") || lc.startsWith("postgres")
      ? "postgresql"
      : lc.startsWith("mysql")
      ? "mysql"
      : "postgresql");

  switch (resolved) {
    case "postgresql":
      return scanPostgres(connectionString);
    case "mysql":
      return scanMySQL(connectionString);
    default:
      throw new Error(`Database type '${resolved}' not yet supported. Supported: postgresql, mysql`);
  }
}
