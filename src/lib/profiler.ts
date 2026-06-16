/**
 * profiler.ts — High-Fidelity TypeScript Data Profiling Engine
 * Port of profiler.py — same algorithms, same health scoring, same semantic types.
 */

import type { ColumnProfile, DatasetProfile, SemanticType, ChartAggregate, ERDMapping } from "@/types";

// ── Utility ───────────────────────────────────────────────────────────────────

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function cleanValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v);
}

// ── Semantic Type Inference ───────────────────────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/;
const PHONE_RE = /^\+?[\d\s\-()\s]{7,20}$/;
const AADHAAR_RE = /^\d{12}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

export function inferSemanticType(colName: string, values: unknown[]): SemanticType {
  const colLower = colName.toLowerCase();
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  const total = values.length;
  const nonNullLen = nonNull.length;

  if (nonNullLen === 0) return "Empty / Missing";

  const uniqueVals = new Set(nonNull.map(String));
  const uniqueCount = uniqueVals.size;
  const uniqueRatio = uniqueCount / nonNullLen;

  // Domain-specific hints
  if (colLower.includes("aadhaar") || colLower.includes("aadhar") || colLower.includes("uid_no")) {
    return "Aadhaar ID";
  }
  if (colLower.includes("blood_pressure") || colLower.includes("systolic") || (colLower === "bp")) {
    return "Blood Pressure";
  }
  if (colLower.includes("gstin") || colLower.includes("gst_no")) return "GSTIN";
  if (colLower.includes("ifsc")) return "IFSC Code";
  if (colLower.includes("pan") && (colLower.includes("no") || colLower.includes("number") || colLower === "pan")) return "PAN Number";

  // Primary Key
  if (uniqueCount === total && total > 1) {
    if (["id", "key", "uuid", "code", "pk"].some((s) => colLower.includes(s))) return "Primary Key";
    const sample = String(nonNull[0]);
    if (sample.length > 10 && /^[a-fA-F0-9-]+$/.test(sample)) return "Unique Identifier";
  }

  // Email
  const head10 = nonNull.slice(0, 10).map(String);
  if (head10.every((v) => EMAIL_RE.test(v.trim()))) return "Email Address";

  // URL
  if (head10.every((v) => URL_RE.test(v.trim()))) return "URL / Link";

  // Phone
  const phoneHints = ["phone", "mobile", "tel", "contact"];
  if (phoneHints.some((h) => colLower.includes(h))) {
    if (head10.every((v) => PHONE_RE.test(v.trim()))) return "Phone Number";
  }

  // Aadhaar pattern check
  if (head10.every((v) => AADHAAR_RE.test(v.trim()))) return "Aadhaar ID";

  // GSTIN pattern
  if (head10.every((v) => GSTIN_RE.test(v.trim()))) return "GSTIN";

  // IFSC
  if (head10.every((v) => IFSC_RE.test(v.trim()))) return "IFSC Code";

  // PAN
  if (head10.every((v) => PAN_RE.test(v.trim()))) return "PAN Number";

  // DateTime
  const dateHints = ["date", "time", "created", "updated", "timestamp", "year", "month", "dob", "dt", "admission", "joining"];
  if (dateHints.some((h) => colLower.includes(h))) {
    const parseable = head10.filter((v) => !isNaN(Date.parse(v)));
    if (parseable.length >= head10.length * 0.8) return "DateTime";
  }

  // Currency
  const currencyHints = ["price", "amount", "salary", "cost", "revenue", "fee", "payment", "usd", "eur", "inr"];
  if (currencyHints.some((h) => colLower.includes(h))) {
    const nums = nonNull.map(toNumber).filter(isNumeric);
    if (nums.length / nonNullLen > 0.8) return "Currency";
  }

  // Zip/Postal
  if (["zip", "postal", "pincode", "pin"].some((h) => colLower.includes(h))) {
    const all = nonNull.map(String);
    if (all.every((v) => /^\d{5,6}$/.test(v.trim()))) return "Zip / Postal Code";
  }

  // Boolean
  if (uniqueCount === 2) {
    const vals = new Set(nonNull.map((v) => String(v).toLowerCase()));
    const boolSets = [
      new Set(["0", "1"]),
      new Set(["true", "false"]),
      new Set(["yes", "no"]),
      new Set(["y", "n"]),
    ];
    if (boolSets.some((bs) => [...vals].every((v) => bs.has(v)))) return "Boolean / Flag";
  }

  // Check if all values are numeric
  const numericVals = nonNull.map(toNumber).filter(isNumeric);
  const isNumericCol = numericVals.length / nonNullLen > 0.9;

  if (isNumericCol) {
    const hasDecimals = numericVals.some((n) => !Number.isInteger(n));
    return hasDecimals ? "Numeric (Float)" : "Numeric (Integer)";
  }

  // Categorical
  if (uniqueCount < 15 || uniqueRatio < 0.15) return "Category";

  return "Text / String";
}

// ── Statistics ────────────────────────────────────────────────────────────────

function computeStats(nums: number[]) {
  if (nums.length === 0) return { mean: null, std: null, min: null, max: null };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  const std = Math.sqrt(variance);
  const sorted = [...nums].sort((a, b) => a - b);
  return { mean, std, min: sorted[0], max: sorted[sorted.length - 1], sorted };
}

function computeIQR(sorted: number[]) {
  const q25 = sorted[Math.floor(sorted.length * 0.25)];
  const q75 = sorted[Math.floor(sorted.length * 0.75)];
  return { q25, q75, iqr: q75 - q25 };
}

// ── Per-column anomaly penalty ────────────────────────────────────────────────

function colAnomalyPenalty(values: unknown[], colLower: string): number {
  let penalty = 0;
  const n = values.length;
  if (n === 0) return 0;

  const numericVals = values.map(toNumber).filter(isNumeric) as number[];
  const isNumericCol = numericVals.length / n > 0.7;

  if (isNumericCol) {
    if (colLower.includes("age")) {
      const invalid = numericVals.filter((v) => v < 0 || v > 120).length;
      penalty += (invalid / n) * 15;
    } else if (colLower.includes("bmi")) {
      const invalid = numericVals.filter((v) => v < 10 || v > 60).length;
      penalty += (invalid / n) * 10;
    } else if (["price", "amount", "bill", "salary", "cost", "revenue", "fee", "charge", "payment"].some((k) => colLower.includes(k))) {
      const invalid = numericVals.filter((v) => v < 0).length;
      penalty += (invalid / n) * 12;
    } else if (["pct", "percent", "discount", "rating", "score"].some((k) => colLower.includes(k))) {
      const invalid = numericVals.filter((v) => v < 0 || v > 100).length;
      penalty += (invalid / n) * 8;
    } else if (["qty", "quantity", "stock", "count", "units"].some((k) => colLower.includes(k))) {
      const invalid = numericVals.filter((v) => v < 0).length;
      penalty += (invalid / n) * 8;
    }

    if (numericVals.length > 1) {
      const sorted = [...numericVals].sort((a, b) => a - b);
      const { q25, q75, iqr } = computeIQR(sorted);
      if (iqr > 0) {
        const extreme = numericVals.filter((v) => v < q25 - 5 * iqr || v > q75 + 5 * iqr).length;
        penalty += (extreme / n) * 10;
      }
    }
  } else {
    const GARBAGE = new Set([
      "???", "n/a", "na", "none", "null", "undefined", "unknown", "tbd",
      "test", "xxx", "---", "invalid", "notanemail", "pending", "missing",
      "#n/a", "#null!", "#value!", "#ref!", "#error", "nan", "inf", "-inf",
    ]);
    const strVals = values.map((v) => String(v ?? "").trim().toLowerCase());
    const garbage = strVals.filter((v) => GARBAGE.has(v)).length;
    penalty += (garbage / n) * 12;

    const empty = strVals.filter((v) => v === "").length;
    penalty += (empty / n) * 8;

    if (["email", "mail"].some((k) => colLower.includes(k))) {
      const invalid = strVals.filter((v) => !EMAIL_RE.test(v)).length;
      penalty += (invalid / n) * 10;
    }
    if (["phone", "mobile", "tel", "contact"].some((k) => colLower.includes(k))) {
      const invalid = strVals.filter((v) => !/^\d{7,15}$/.test(v.replace(/[\s\-()+]/g, ""))).length;
      penalty += (invalid / n) * 8;
    }
    if (["date", "dob", "dt", "time", "admission", "joining"].some((k) => colLower.includes(k))) {
      const unparseable = strVals.filter((v) => isNaN(Date.parse(v))).length;
      penalty += (unparseable / n) * 10;
    }
    if (["pin", "pincode", "postal", "zip"].some((k) => colLower.includes(k))) {
      const invalid = strVals.filter((v) => !/^\d{6}$/.test(v)).length;
      penalty += (invalid / n) * 6;
    }
  }

  return penalty;
}

// ── Main Profile Function ─────────────────────────────────────────────────────

export function profileDataset(
  rows: Record<string, unknown>[],
  filename: string
): DatasetProfile {
  const totalRows = rows.length;
  if (totalRows === 0) {
    return {
      total_rows: 0, total_cols: 0, duplicate_rows: 0,
      completeness: 0, health_score: 0,
      quality_label: "No data", anomaly_penalty: 0,
      validity_issues_detected: false, columns: [], charts: {},
    };
  }

  const colNames = Object.keys(rows[0]);
  const totalCols = colNames.length;

  // Duplicates: stringify each row, count repeated ones
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }

  // Completeness
  let totalMissing = 0;
  const colValueArrays: Record<string, unknown[]> = {};
  for (const col of colNames) {
    const vals = rows.map((r) => r[col]);
    colValueArrays[col] = vals;
    totalMissing += vals.filter((v) => v === null || v === undefined || v === "").length;
  }
  const totalCells = totalRows * totalCols;
  const completeness = ((totalCells - totalMissing) / totalCells) * 100;

  // ── Health Score ────────────────────────────────────────────────────────────
  let healthScore = 100.0;
  const missingRatio = totalMissing / totalCells;
  healthScore -= missingRatio * 25;

  const dupPct = (duplicateRows / totalRows) * 100;
  if (dupPct >= 50) healthScore -= 35;
  else if (dupPct >= 30) healthScore -= 22;
  else if (dupPct >= 15) healthScore -= 12;
  else if (dupPct >= 5) healthScore -= 6;
  else healthScore -= dupPct * 0.1;

  const emptyCols = colNames.filter((c) =>
    colValueArrays[c].every((v) => v === null || v === undefined || v === "")
  ).length;
  if (totalCols > 0) healthScore -= (emptyCols / totalCols) * 10;
  healthScore = Math.max(0, Math.min(100, healthScore));

  // ── Column Profiles ─────────────────────────────────────────────────────────
  const columnsProfile: ColumnProfile[] = [];

  for (const col of colNames) {
    const vals = colValueArrays[col];
    const nonNullVals = vals.filter((v) => v !== null && v !== undefined && v !== "");
    const nonNullCount = nonNullVals.length;
    const nullCount = totalRows - nonNullCount;
    const nullPct = (nullCount / totalRows) * 100;

    const uniqueVals = new Set(nonNullVals.map(String));
    const uniqueCount = uniqueVals.size;
    const uniqueRatio = nonNullCount > 0 ? (uniqueCount / nonNullCount) * 100 : 0;

    const semanticType = inferSemanticType(col, vals);

    // Numeric stats
    const numericVals = nonNullVals.map(toNumber).filter(isNumeric) as number[];
    const isNumericCol = numericVals.length / Math.max(nonNullCount, 1) > 0.8;

    let mean: number | null = null;
    let std: number | null = null;
    let minVal: number | null = null;
    let maxVal: number | null = null;
    let outlierCount = 0;
    const topOutliers: ColumnProfile["top_outliers"] = [];

    if (isNumericCol && numericVals.length > 0) {
      const stats = computeStats(numericVals);
      mean = Math.round((stats.mean ?? 0) * 100) / 100;
      std = Math.round((stats.std ?? 0) * 100) / 100;
      minVal = stats.min ?? null;
      maxVal = stats.max ?? null;

      if (stats.sorted && stats.sorted.length > 3) {
        const { q25, q75, iqr } = computeIQR(stats.sorted);
        if (iqr > 0) {
          const lower = q25 - 1.5 * iqr;
          const upper = q75 + 1.5 * iqr;
          const outlierVals = numericVals.filter((v) => v < lower || v > upper);
          outlierCount = outlierVals.length;

          if (outlierCount > 0) {
            const median = stats.sorted[Math.floor(stats.sorted.length / 2)];
            const sorted5 = [...outlierVals]
              .map((v) => ({ val: v, dev: Math.abs(v - median) }))
              .sort((a, b) => b.dev - a.dev)
              .slice(0, 5);

            for (const { val } of sorted5) {
              const rowIdx = rows.findIndex((r) => Number(r[col]) === val);
              topOutliers.push({
                row_index: rowIdx,
                value: val,
                context: rows[rowIdx] ?? {},
              });
            }
          }
        }
      }
    }

    // Sample data
    const uniqArr = [...uniqueVals].slice(0, 3);
    const sampleStr = uniqArr.length > 0 ? uniqArr.join(", ") : "N/A (All Missing)";

    // Per-column validity
    const penalty = colAnomalyPenalty(nonNullVals, col.toLowerCase());
    const hasValidityIssues = penalty > 5;

    columnsProfile.push({
      name: col,
      pandas_dtype: isNumericCol ? (numericVals.some((n) => !Number.isInteger(n)) ? "float64" : "int64") : "object",
      semantic_type: semanticType,
      non_null_count: nonNullCount,
      null_count: nullCount,
      null_percentage: Math.round(nullPct * 100) / 100,
      unique_count: uniqueCount,
      unique_ratio: Math.round(uniqueRatio * 100) / 100,
      mean,
      std,
      min: minVal !== null ? minVal : null,
      max: maxVal !== null ? maxVal : null,
      outliers_count: outlierCount,
      top_outliers: topOutliers,
      sample_data: sampleStr,
      has_validity_issues: hasValidityIssues,
      validity_issue_pct: hasValidityIssues ? Math.round(penalty * 10) / 10 : 0,
      description: "AI description pending...",
      recommendation: "AI recommendation pending...",
    });
  }

  // ── Anomaly penalty (normalized) ────────────────────────────────────────────
  let totalPenalty = 0;
  for (const col of colNames) {
    const penalty = colAnomalyPenalty(
      colValueArrays[col].filter((v) => v !== null && v !== undefined && v !== ""),
      col.toLowerCase()
    );
    totalPenalty += Math.min(penalty, 20);
  }
  const anomalyPenalty = Math.min((totalPenalty / (totalCols * 20)) * 50, 50);
  healthScore -= anomalyPenalty;
  healthScore = Math.round(Math.max(0, Math.min(100, healthScore)) * 100) / 100;

  // Quality label
  let qualityLabel: string;
  if (healthScore >= 85) qualityLabel = "Excellent data quality — dataset is production-ready.";
  else if (healthScore >= 70) qualityLabel = "Good data quality with minor issues.";
  else if (healthScore >= 50) qualityLabel = "Moderate data quality — cleaning recommended.";
  else if (healthScore >= 30) qualityLabel = "Poor data quality — significant issues detected.";
  else qualityLabel = "Critical data quality — dataset requires major cleaning.";

  // ── Chart aggregates ─────────────────────────────────────────────────────────
  const charts: DatasetProfile["charts"] = {};

  const numericCols = colNames.filter((c) => {
    const vals = colValueArrays[c].map(toNumber).filter(isNumeric);
    return vals.length / Math.max(colValueArrays[c].length, 1) > 0.8 && !c.toLowerCase().includes("id");
  });

  const catCols = columnsProfile
    .filter((c) => c.semantic_type === "Category")
    .map((c) => c.name);

  if (numericCols.length > 0 && catCols.length > 0) {
    const targetNum = numericCols[0];
    const numVals = colValueArrays[targetNum].map(toNumber).filter(isNumeric) as number[];

    // Categorical groupby
    const catAgg1: Record<string, number[]> = {};
    for (let i = 0; i < totalRows; i++) {
      const catKey = String(rows[i][catCols[0]] ?? "Unknown");
      const nv = toNumber(rows[i][targetNum]);
      if (isNumeric(nv)) {
        if (!catAgg1[catKey]) catAgg1[catKey] = [];
        catAgg1[catKey].push(nv);
      }
    }
    const cat1Data: Record<string, number> = {};
    Object.entries(catAgg1)
      .slice(0, 10)
      .forEach(([k, vals]) => {
        cat1Data[k] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
      });
    if (Object.keys(cat1Data).length > 0) {
      charts.categorical_1 = { column: catCols[0], target: targetNum, data: cat1Data };
    }

    if (catCols.length > 1) {
      const catAgg2: Record<string, number[]> = {};
      for (let i = 0; i < totalRows; i++) {
        const catKey = String(rows[i][catCols[1]] ?? "Unknown");
        const nv = toNumber(rows[i][targetNum]);
        if (isNumeric(nv)) {
          if (!catAgg2[catKey]) catAgg2[catKey] = [];
          catAgg2[catKey].push(nv);
        }
      }
      const cat2Data: Record<string, number> = {};
      Object.entries(catAgg2)
        .slice(0, 15)
        .forEach(([k, vals]) => {
          cat2Data[k] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
        });
      if (Object.keys(cat2Data).length > 0) {
        charts.categorical_2 = { column: catCols[1], target: targetNum, data: cat2Data };
      }
    }
  }

  return {
    total_rows: totalRows,
    total_cols: totalCols,
    duplicate_rows: duplicateRows,
    completeness: Math.round(completeness * 100) / 100,
    health_score: healthScore,
    quality_label: qualityLabel,
    anomaly_penalty: Math.round(anomalyPenalty * 100) / 100,
    validity_issues_detected: anomalyPenalty > 5,
    columns: columnsProfile,
    charts,
    filename,
  };
}

// ── ERD Mapping (multi-file) ──────────────────────────────────────────────────

export function generateERDMapping(tablesProfiles: { filename: string; columns: ColumnProfile[] }[]): ERDMapping {
  const nodes: ERDMapping["nodes"] = [];
  const links: ERDMapping["links"] = [];
  const pks: Record<string, string> = {};

  for (const { filename, columns } of tablesProfiles) {
    const tableName = filename.replace(/\.[^/.]+$/, "");
    nodes.push({ id: tableName, label: tableName, columns: columns.map((c) => c.name) });
    const pk = columns.find((c) => c.semantic_type === "Primary Key" || c.semantic_type === "Unique Identifier");
    if (pk) pks[tableName] = pk.name;
  }

  for (const { filename, columns } of tablesProfiles) {
    const tableName = filename.replace(/\.[^/.]+$/, "");
    for (const col of columns) {
      const colLower = col.name.toLowerCase();
      for (const [otherTable, pkName] of Object.entries(pks)) {
        if (otherTable !== tableName) {
          if (colLower.includes(otherTable.toLowerCase()) || (pkName && colLower.includes(pkName.toLowerCase()))) {
            links.push({ source: otherTable, target: tableName, label: `${pkName} → ${col.name}` });
          }
        }
      }
    }
  }

  return { nodes, links };
}
