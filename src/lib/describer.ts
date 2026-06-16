/**
 * describer.ts — Groq AI column description generator
 * Port of describer.py — same prompts, same JSON output format
 */

import type { ColumnProfile, ExecutiveReport, DatasetProfile } from "@/types";
import { getCurrentKey, rotateKey } from "./groqPool";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";

async function groqPost(
  messages: { role: string; content: string }[],
  maxTokens = 350,
  jsonMode = true
): Promise<string | null> {
  let apiKey = getCurrentKey();
  if (!apiKey) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.15,
          max_tokens: maxTokens,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.status === 429) {
        apiKey = rotateKey();
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      if (!res.ok) return null;
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

export async function generateColumnInsights(
  colName: string,
  profile: ColumnProfile,
  datasetContext = ""
): Promise<{ description: string; recommendation: string }> {
  const statsText = [
    `Column Name: '${colName}'`,
    `Basic JS Type: ${profile.pandas_dtype}`,
    `Inferred Semantic Type: ${profile.semantic_type}`,
    `Completeness: ${profile.non_null_count} valid records, ${profile.null_percentage}% missing.`,
    `Cardinality: ${profile.unique_count} unique values (${profile.unique_ratio}% ratio).`,
    `Sample values: [${profile.sample_data}]`,
    profile.mean !== null
      ? `Numeric Distribution: Min=${profile.min}, Max=${profile.max}, Mean=${profile.mean}, StdDev=${profile.std}.`
      : "",
    profile.outliers_count > 0
      ? `Anomalies: ${profile.outliers_count} outliers detected via IQR.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are a world-class Principal Data Architect with 15+ years of experience in enterprise BI and data governance.
Analyze a column's statistical profile and write authoritative, elite-level business summaries.
Output EXACT JSON with two fields:
1. 'description': A highly professional, single-sentence executive business definition explaining why this data matters.
2. 'recommendation': An expert data quality, cleaning, and optimization recommendation with concrete technical instructions.
Output valid JSON only, no markdown codeblocks.`;

  const userPrompt = `Analyze this column profile:\n\n${statsText}\n\nOptional Dataset Context: ${datasetContext}\n\nReturn 'description' and 'recommendation' in JSON.`;

  const content = await groqPost([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  if (!content) {
    return {
      description: "AI description temporarily unavailable.",
      recommendation: "Check API key and connectivity.",
    };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      description: parsed.description ?? "No description generated.",
      recommendation: parsed.recommendation ?? "No recommendations found.",
    };
  } catch {
    return { description: content.slice(0, 200), recommendation: "" };
  }
}

export async function generateOutlierInsights(
  colName: string,
  outliers: ColumnProfile["top_outliers"],
  datasetContext = ""
): Promise<{ explanation: string }> {
  const systemPrompt = `You are a world-class Principal Data Architect.
Analyze the top extreme outliers of a column and provide a highly professional physical/business explanation for WHY these anomalies might exist.
Output EXACT JSON with one field: 'explanation': A sophisticated 2-3 sentence paragraph.
Output valid JSON only, no markdown codeblocks.`;

  const userPrompt = `Column Name: '${colName}'\nTop Extreme Outliers:\n${JSON.stringify(outliers, null, 2)}\nDataset Context: ${datasetContext}\n\nReturn 'explanation' in JSON.`;

  const content = await groqPost(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    280
  );

  if (!content) return { explanation: "Could not generate an explanation." };

  try {
    const parsed = JSON.parse(content);
    return { explanation: parsed.explanation ?? "No explanation generated." };
  } catch {
    return { explanation: content.slice(0, 300) };
  }
}

export async function generateExecutiveReport(
  profile: DatasetProfile,
  datasetContext = ""
): Promise<ExecutiveReport> {
  const schemaSummary = profile.columns
    .slice(0, 30)
    .map(
      (c) =>
        `- ${c.name} (${c.semantic_type}, ${c.null_percentage}% null, ${c.unique_count} unique)`
    )
    .join("\n");

  const systemPrompt = `You are a world-class Chief Data Officer writing an executive data governance report.
Analyze the provided dataset schema statistics and generate a comprehensive business intelligence brief.
Output EXACT JSON with these fields:
- domain_label: 1-3 word domain classification (e.g. "E-Commerce Sales", "Healthcare Records")
- business_overview: 2-3 sentence executive summary of what this dataset represents
- key_findings: Array of 3-5 specific data quality findings (strings)
- governance_scope: 1-2 sentences on data governance scope and responsibilities
- health_assessment: 1-2 sentences on overall data health and readiness
- recommendations: Array of 3-5 specific actionable recommendations (strings)
Output valid JSON only, no markdown.`;

  const userPrompt = `Dataset: ${profile.filename ?? "Unknown"}
Total Rows: ${profile.total_rows.toLocaleString()}
Total Columns: ${profile.total_cols}
Duplicate Rows: ${profile.duplicate_rows}
Data Completeness: ${profile.completeness}%
Health Score: ${profile.health_score}/100 (${profile.quality_label})
Anomaly Penalty: ${profile.anomaly_penalty}

Column Schema:
${schemaSummary}

Context: ${datasetContext}

Generate a comprehensive executive intelligence report.`;

  const content = await groqPost(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    600,
    true
  );

  if (!content) {
    return {
      domain_label: "Unknown Domain",
      business_overview: "Executive report generation failed. Please try again.",
      key_findings: ["Analysis unavailable"],
      governance_scope: "Not determined",
      health_assessment: `Health score: ${profile.health_score}/100`,
      recommendations: ["Check API connectivity"],
    };
  }

  try {
    return JSON.parse(content) as ExecutiveReport;
  } catch {
    return {
      domain_label: "Data Asset",
      business_overview: content.slice(0, 400),
      key_findings: [],
      governance_scope: "",
      health_assessment: `Health score: ${profile.health_score}/100`,
      recommendations: [],
    };
  }
}

export async function generateChatResponse(
  schemaText: string,
  userMessage: string
): Promise<{ code: string | null; answer: string | null }> {
  const codePrompt = `You are an expert JavaScript data analyst. The user's dataset is in an array of objects called \`data\`.
Schema:
${schemaText}

Write JavaScript code to answer: "${userMessage}"
Rules:
1. Store final answer in a variable called \`result\`. The \`result\` MUST be a friendly, natural language string directly answering the user (e.g. \`let result = 'The average is ' + avg + '.';\`). Do NOT just return a JSON object or array.
2. Use only native JS array methods (map, filter, reduce, etc.)
3. Output ONLY raw JS code — no imports, no markdown, no console.log
4. Do NOT use eval, require, or any Node.js APIs
5. Column names might contain spaces, uppercase letters, or special characters. Always access properties on row objects using bracket notation with the exact column name as specified in the schema (e.g. \`row['Court Name']\` or \`row['Case No']\`), rather than dot notation. Do not assume normalized or camelCase keys.`;

  const codeContent = await groqPost(
    [{ role: "user", content: codePrompt }],
    500,
    false
  );

  return { code: codeContent, answer: null };
}
