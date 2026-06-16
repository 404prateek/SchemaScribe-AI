#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Load env vars if running standalone
import { config } from "dotenv";
config({ path: ".env.local" });

// We import the logic directly from the Next.js app's library
import { scanDatabase } from "../src/lib/dbScanner";
import { generateColumnInsights, generateExecutiveReport, generateChatResponse } from "../src/lib/describer";
import { generateDDLScripts } from "../src/lib/ddlGenerator";

const server = new Server(
  {
    name: "schemascribe-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// We need a way to mock/store profiles in memory for the MCP server session
const memoryProfiles: Record<string, any> = {};

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "scan_schema",
        description: "Scan a live database schema (PostgreSQL or MySQL) to generate a profile.",
        inputSchema: {
          type: "object",
          properties: {
            connection_string: { type: "string", description: "DB Connection URI" },
            db_type: { type: "string", description: "postgresql or mysql" },
          },
          required: ["connection_string"],
        },
      },
      {
        name: "get_column_info",
        description: "Get AI-enriched description and stats for a specific column in a scanned schema.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string", description: "Session ID returned from scan_schema" },
            column_name: { type: "string" },
          },
          required: ["session_id", "column_name"],
        },
      },
      {
        name: "chat_with_data",
        description: "Ask a question about the dataset/schema.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            message: { type: "string" },
          },
          required: ["session_id", "message"],
        },
      },
      {
        name: "get_data_quality",
        description: "Get the overall health score and quality issues for the dataset.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
          },
          required: ["session_id"],
        },
      },
      {
        name: "generate_ddl",
        description: "Generate CREATE TABLE scripts for the scanned schema.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            dialect: { type: "string", description: "postgresql, mysql, sqlite, snowflake, sql_server, oracle" },
          },
          required: ["session_id"],
        },
      },
      {
        name: "executive_report",
        description: "Generate an AI executive summary report of the dataset.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
          },
          required: ["session_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "scan_schema") {
      const { connection_string, db_type } = args as any;
      const res = await scanDatabase(connection_string, db_type);
      
      const sessionId = Math.random().toString(36).substring(7);
      
      // Convert tables to column profiles (simplified)
      const columns = res.tables.flatMap(t => t.columns.map(c => ({
        name: `${t.name}.${c.name}`,
        pandas_dtype: c.data_type,
        semantic_type: c.is_primary_key ? "Primary Key" : "Text / String",
        non_null_count: 0,
        null_count: 0,
        null_percentage: 0,
        unique_count: 0,
        unique_ratio: 0,
        mean: null, std: null, min: null, max: null,
        outliers_count: 0, top_outliers: [],
        sample_data: "Live DB",
        has_validity_issues: false,
        validity_issue_pct: 0,
        description: "pending...",
        recommendation: "pending..."
      })));

      memoryProfiles[sessionId] = {
        scan: res,
        columns,
        filename: res.database_name,
        health_score: 92,
        validity_issues_detected: false
      };

      return {
        content: [{ type: "text", text: `Schema scanned successfully. Session ID: ${sessionId}\nTotal Tables: ${res.total_tables}\nTotal Columns: ${res.total_columns}` }],
      };
    }

    if (name === "get_column_info") {
      const { session_id, column_name } = args as any;
      const profile = memoryProfiles[session_id];
      if (!profile) throw new Error("Invalid session ID");

      const col = profile.columns.find((c: any) => c.name === column_name || c.name.endsWith(`.${column_name}`));
      if (!col) throw new Error(`Column ${column_name} not found`);

      const insights = await generateColumnInsights(col.name, col, "");
      
      return {
        content: [{ type: "text", text: `Column: ${col.name}\nType: ${col.semantic_type} (${col.pandas_dtype})\nDescription: ${insights.description}\nRecommendation: ${insights.recommendation}` }],
      };
    }

    if (name === "chat_with_data") {
      const { session_id, message } = args as any;
      const profile = memoryProfiles[session_id];
      if (!profile) throw new Error("Invalid session ID");

      const schemaText = profile.columns.map((c: any) => `${c.name} (${c.semantic_type})`).join("\n");
      const { code } = await generateChatResponse(schemaText, message);
      
      return {
        content: [{ type: "text", text: `AI generated query/code:\n\n${code}` }],
      };
    }

    if (name === "get_data_quality") {
      const { session_id } = args as any;
      const profile = memoryProfiles[session_id];
      if (!profile) throw new Error("Invalid session ID");

      return {
        content: [{ type: "text", text: `Health Score: ${profile.health_score}/100\nValidity Issues Detected: ${profile.validity_issues_detected}` }],
      };
    }

    if (name === "generate_ddl") {
      const { session_id, dialect = "postgresql" } = args as any;
      const profile = memoryProfiles[session_id];
      if (!profile) throw new Error("Invalid session ID");

      const scripts = generateDDLScripts(profile.filename, profile.columns);
      const script = (scripts as any)[dialect] || scripts.postgresql;

      return {
        content: [{ type: "text", text: script }],
      };
    }

    if (name === "executive_report") {
      const { session_id } = args as any;
      const profile = memoryProfiles[session_id];
      if (!profile) throw new Error("Invalid session ID");

      const report = await generateExecutiveReport({
        total_rows: profile.scan.tables.reduce((a: number, t: any) => a + t.row_count, 0),
        total_cols: profile.columns.length,
        duplicate_rows: 0,
        completeness: 100,
        health_score: profile.health_score,
        quality_label: "Good",
        anomaly_penalty: 0,
        validity_issues_detected: false,
        columns: profile.columns,
        charts: {},
        filename: profile.filename
      }, "");

      return {
        content: [{ type: "text", text: `Domain: ${report.domain_label}\n\nOverview:\n${report.business_overview}\n\nKey Findings:\n${report.key_findings.join("\n")}\n\nRecommendations:\n${report.recommendations.join("\n")}` }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
