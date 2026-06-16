# SchemaScribe AI

⚡ *Turn Any Database Into Instant Intelligence*

SchemaScribe AI automatically documents, visualizes, and explains your database or dataset files in seconds. Paste a connection string or upload a file → get a searchable data dictionary, interactive ER diagrams, graph visualizations, and AI-powered schema exploration.

Built for hackathons. Designed for real-world scale. Completely Vercel-ready with Next.js 16.

## 🏆 Core Features

- **Live Database Connection**: Point it to any PostgreSQL or MySQL database (e.g. Vercel Postgres, Neon, Supabase) and it will securely reverse-engineer your entire schema in seconds.
- **File Upload Support**: Drop any `.csv`, `.xlsx`, or `.json` file to auto-profile up to 100MB of data.
- **Deep Semantic Profiling**: Automatically detects 15+ rich semantic types like Aadhaar IDs, GSTINs, IFSC codes, PAN numbers, and business metrics.
- **AI-Powered Context**: Integrated with Groq Llama-3.1 to generate human-readable executive summaries, technical column descriptions, and data anomaly explanations.
- **Data Dictionary**: Searchable, enriched data catalog generated from your raw schema.
- **Interactive ER Diagrams**: Mermaid-powered diagrams auto-generated from foreign key relationships across your tables.
- **SQL DDL Generator**: Instantly port schemas across dialects (PostgreSQL, MySQL, SQLite, Snowflake, SQL Server, Oracle).
- **Executive Data Reports**: AI-generated governance and business intelligence briefs.
- **Chat with Data**: Ask natural language questions ("What is the average transaction value?") and the AI will write and execute sandboxed code (for files) or generate SQL (for DBs).
- **Secure by Default**: Zero raw data is sent to the LLM—only schema statistics. Fully protected Google OAuth sign-in.
- **MCP Server**: Natively includes a Model Context Protocol server. Connect Cursor or VS Code directly to your live database profiles!

## ⚙️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4 + custom Glassmorphism aesthetic
- **Authentication**: NextAuth v5 (Auth.js) + Google OAuth
- **Database (Auth)**: Vercel Postgres + Prisma ORM
- **Session Cache**: Vercel KV (Redis)
- **AI Integration**: Groq API (llama-3.1-8b-instant) + custom Round-Robin key pool
- **Data Parsing**: papaparse, xlsx
- **DB Drivers**: pg, mysql2

## 🚀 Quick Start (Local Development)

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.local.template` to `.env.local` and fill in the required values:
   ```bash
   cp .env.local.template .env.local
   ```
   - *Tip*: For local dev without Vercel KV, the app automatically falls back to in-memory sessions!

3. **Database Setup (Prisma)**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the Server**
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000`.

## 🔌 Using the MCP Server

SchemaScribe ships with a built-in MCP server that allows AI coding assistants (like Cursor, VS Code, or Antigravity) to read your live database schemas.

1. Ensure your `.env.local` is set up.
2. Add the following to your MCP client config (e.g., `~/.cursor/mcp.json`):
   ```json
   {
     "mcpServers": {
       "schemascribe": {
         "command": "npx",
         "args": ["tsx", "mcp-server/index.ts"],
         "env": {
           "GROQ_API_KEY": "your_groq_key"
         }
       }
     }
   }
   ```
3. Use the `scan_schema` tool from your editor to instantly pull your database schema into your AI's context!

## ☁️ Deployment on Vercel

This project is aggressively optimized for zero-config Vercel deployment:
1. Push to GitHub.
2. Import project in Vercel.
3. Attach **Vercel Postgres** and **Vercel KV** from the Storage tab.
4. Set up your `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, and `GROQ_API_KEYS`.
5. Deploy!

*(Note: API routes are explicitly configured for `maxDuration: 60` to allow complex DB scans and AI generation without timing out).*
