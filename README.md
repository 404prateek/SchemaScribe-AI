# 🧠 SchemaScribe AI
**Intelligent Data Dictionary & Analytics Agent — FastAPI + Vanilla JS**

SchemaScribe AI profiles raw datasets using Pandas, generates AI-powered column descriptions via Groq (Llama-3.1), executes natural-language queries against your data through a secure Python sandbox, and renders interactive dashboards — all without writing a single line of code.

---

## 📁 Project Structure

```
SchemaScribe-AI/
├── app/
│   ├── main.py          # FastAPI backend — all HTTP routes, auth, session store
│   ├── profiler.py      # Pandas profiling engine — stats, semantic types, DDL, ERD
│   ├── describer.py     # Groq API calls — column descriptions, outlier insights, key pool
│   ├── chat.py          # LLM chat agent — generates + sandboxed-executes pandas code
│   └── .env             # API keys and config (never commit this)
├── frontend/
│   ├── index.html       # Single-page app shell
│   ├── app.js           # All frontend logic — upload, dashboard, charts, chat, voice
│   └── style.css        # Dark glass UI theme
├── assets/              # Static assets
└── requirements.txt     # Python dependencies
```

---

## 🔍 What Every File Does

### `app/profiler.py` — The Data Scanner
**What it does:** Reads your CSV/XLSX/JSON file using Pandas and extracts statistics for every column — without ever sending raw data to an AI.

**How it works:**
1. Loads the file into a Pandas DataFrame
2. For each column it calculates: null %, unique count, min/max/mean/std, top outliers (IQR method), sample values
3. Runs `infer_semantic_type()` — a rule-based engine that detects 15+ types: Primary Key, Email, URL, Phone, Currency, DateTime, Boolean, Categorical, Geographic Coordinate, etc. (zero AI used here)
4. Generates SQL DDL scripts for 6 databases: PostgreSQL, MySQL, SQLite, Snowflake, SQL Server, Oracle
5. For multi-file uploads, generates an ERD mapping by detecting matching column names across files

**Key function:** `profile_dataset(file_path)` → returns a JSON-ready dict

---

### `app/describer.py` — The AI Description Engine
**What it does:** Takes the statistical profile from `profiler.py` and sends it (not the raw data) to Groq's Llama-3.1 model to generate professional business descriptions.

**How it works:**
1. `load_env()` reads `app/.env` into environment variables at startup
2. `_GroqKeyPool` manages multiple API keys — rotates to the next key automatically when one hits a 429 rate limit
3. `generate_column_insights()` (sync) — builds a stats summary text, sends to Groq, returns `{description, recommendation}`
4. `generate_column_insights_async()` (async, httpx) — same but truly async for concurrent calls
5. `generate_outlier_insights()` — sends top outlier values to Groq for a business hypothesis

**Key design:** The LLM never sees your actual data rows — only statistics. This prevents data leakage.

---

### `app/chat.py` — The Secure Code Execution Agent
**What it does:** Lets users ask plain-English questions about their data. The LLM writes pandas code, the code is security-checked, then executed on real data, and the result is returned.

**How it works (2-step pipeline):**
1. **Step 1 — Code generation:** Sends the user's question + column schema to Groq. Groq returns Python/Pandas code.
2. **Step 2 — Sandbox execution:**
   - Layer 1: Regex scan — blocks `import`, `os`, `sys`, `open`, `exec`, `eval`, all `__dunder__` names
   - Layer 2: AST walk — parses the code into a syntax tree and rejects any `Import` node or system calls
   - Layer 3: Restricted exec — runs `exec()` with `__builtins__: {}` — only 25 whitelisted functions available. `os`, `sys`, `requests` are completely inaccessible.
3. The actual data result (not AI's guess) is returned as the answer

**Why this matters:** The chat answers come from real code execution — they cannot hallucinate.

---

### `app/main.py` — The Backend Server
**What it does:** The FastAPI server that ties everything together and exposes HTTP endpoints.

**Routes:**

| Route | Method | What it does |
|---|---|---|
| `/api/analyze` | POST | Upload file → profile → AI descriptions → return dashboard data |
| `/api/chat` | POST | Send question → generate code → execute → return answer |
| `/api/investigate` | POST | Fetch outlier data for a column → AI explanation |
| `/api/clean` | POST | Apply noise filtering + imputation → save cleaned CSV |
| `/api/download/{id}` | GET | Download the cleaned CSV file |
| `/api/export/{id}/{format}` | GET | Export data dictionary as JSON or Markdown |
| `/api/reset/{id}` | POST | Delete cached files and session data |
| `/api/voice-to-text` | POST | Send audio blob → Sarvam AI → return transcript |

**Key systems inside:**
- `SessionStore` — stores analysis results in Redis (if available) or falls back to an in-memory dict
- `verify_api_key` — checks `X-API-Key` header against `APP_API_KEY` in `.env`
- `_groq_semaphore` — limits to 8 concurrent Groq calls to avoid rate limits
- `_fetch_insight_limited` — wraps async Groq calls with the semaphore

---

### `frontend/app.js` — The UI Brain
**What it does:** All frontend interactivity in vanilla JavaScript.

**Key flows:**
- **Upload:** Drag-and-drop or browse → POST to `/api/analyze` → renders full dashboard
- **Dashboard:** Health score gauge (SVG), stat cards, Chart.js analytics charts, schema table with search
- **SQL DDL tabs:** Switch between 6 database engines, copy to clipboard
- **Cleaning Studio:** Configure imputation settings → POST to `/api/clean` → authenticated download
- **Chat:** Type question → POST to `/api/chat` → render code + result + table
- **Voice input:** MediaRecorder API records audio → POST to `/api/voice-to-text` → transcript auto-fills chat
- **Export:** Authenticated fetch-to-Blob downloads (not `window.location.href`)

---

### `frontend/index.html` — The Page Shell
Single HTML file that loads all dependencies (FontAwesome 6.4.0, Chart.js, Mermaid.js) and defines the static structure. All content is dynamically injected by `app.js`.

---

### `frontend/style.css` — The Visual Theme
Dark glass-morphism UI. Key patterns: `backdrop-filter: blur()`, CSS custom properties for colors, ambient glow divs, animation classes (`animate-fade-in`, `animate-slide-up`).

---

## ⚙️ What Changes Were Made & Why

### 1. exec() Security Sandbox (`app/chat.py`)
**Problem:** The original code ran `exec(user_generated_code, {}, local_vars)` — an attacker could ask "delete my files" and the LLM might generate `import os; os.remove(...)` which would actually run.

**Fix:** Three-layer sandbox:
```
User question → LLM generates code → Regex scan → AST parse → exec with empty __builtins__
```
If any layer fails, the code is rejected before `exec()` is ever called.

---

### 2. API Key Authentication (`app/main.py` + `frontend/app.js`)
**Problem:** Anyone who knew your server's IP could call `/api/analyze` and use your Groq credits.

**Fix:** Every protected route now requires `X-API-Key: your-key` in the request header. Set `APP_API_KEY` in `.env` to enable it. If not set, auth is disabled (safe for local dev).

---

### 3. Groq API Key Pool (`app/describer.py`)
**Problem:** Single Groq key hits the free-tier rate limit (30 req/min) on large datasets.

**Fix:** `_GroqKeyPool` class — add multiple keys to `GROQ_API_KEYS` in `.env` (comma-separated). On a 429 response, the pool automatically rotates to the next key and retries. 3 keys = ~90 req/min effective capacity.

---

### 4. Parallel AI Calls with Semaphore (`app/main.py`)
**Problem:** Columns were processed one-by-one sequentially — a 30-column dataset meant 30 sequential API calls.

**Fix:** `asyncio.gather()` fires all column descriptions simultaneously. `asyncio.Semaphore(8)` caps it at 8 concurrent calls to stay within rate limits. A 30-column dataset now takes ~4 rounds instead of 30 sequential calls.

---

### 5. Redis Session Store (`app/main.py`)
**Problem:** Analysis results were stored in a plain Python dict — restarting the server lost all data.

**Fix:** `SessionStore` class — stores session data in Redis with a 2-hour TTL. Falls back to an in-memory dict if Redis isn't running. Set `REDIS_URL` in `.env` to connect.

---

### 6. Sarvam AI Voice Input (`app/main.py` + `frontend/`)
**Problem:** Users had to type questions.

**Fix:** `/api/voice-to-text` endpoint + mic button in the chat UI. Click mic → speak → transcript auto-populates the chat input → sends automatically. Uses browser `MediaRecorder` API + Sarvam AI `saaras:v3` model.

---

### 7. File Size Validation (`app/main.py`)
**Problem:** Frontend-only file size check could be bypassed by calling the API directly.

**Fix:** Backend reads file bytes and rejects anything over 100MB with HTTP 413 before any processing.

---

### 8. Authenticated Downloads (`frontend/app.js`)
**Problem:** Export and download buttons used `window.location.href` — plain browser navigation can't send custom headers, so auth was bypassed.

**Fix:** `_downloadWithAuth()` helper uses `fetch()` with `X-API-Key` header, converts response to a Blob, and triggers a client-side download.

---

## 🚀 Running Locally

```bash
# 1. Create virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Mac/Linux

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set up environment
# Edit app/.env and add your GROQ_API_KEY

# 4. Start the server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# 5. Open the frontend
# Open frontend/index.html in a browser
```

---

## 🔑 Environment Variables (`app/.env`)

```env
GROQ_API_KEY=your_primary_groq_key
GROQ_API_KEYS=key1,key2,key3          # optional key pool for higher rate limits
SARVAM_API_KEY=your_sarvam_key        # optional, for voice input
APP_API_KEY=your-secret-password      # optional, enables API auth
REDIS_URL=redis://localhost:6379/0    # optional, for persistent sessions
```

---

## 📦 Dependencies

| Package | Purpose |
|---|---|
| `fastapi` + `uvicorn` | Backend web server |
| `pandas` + `openpyxl` | Data profiling engine |
| `requests` | Sync Groq/Sarvam API calls |
| `httpx` | Async Groq API calls |
| `redis` | Session persistence |
| `python-multipart` | File upload handling |
| `pydantic` | Request body validation |

Say goodbye to manual data cleaning and confusing schemas. Just drag, drop, and chat with your data!

![SchemaScribe AI Banner](assets/banner.png)

---

## ✨ Enterprise-Grade Features

* 📊 **Automated Statistical Profiling:** Instantly processes `CSV`, `Excel`, and `JSON` files. Automatically calculates null ratios, cardinality, and detects pandas data types for up to millions of rows in seconds.
* 🤖 **AI-Powered Data Dictionary:** Leverages **Groq Llama-3.1 API** to generate rich, contextual business definitions and actionable cleaning recommendations for every column.
* 💻 **AI SQL DDL Generator:** Automatically generates `CREATE TABLE` scripts for PostgreSQL, MySQL, Snowflake, Oracle, and SQL Server.
* 🧼 **Smart Data Cleaning Studio:** One-click automated imputation for missing values and robust **IQR-based outlier mitigation** to ensure pristine data health.
* 💬 **Conversational Analytics (Agentic Sandbox):** Chat with your dataset in natural language! The AI translates your questions into Python Pandas code, executes it in a secure sandbox, and returns 100% mathematically accurate answers.
* 🗺️ **Multi-File ERD Visualizer:** Upload multiple datasets simultaneously. The semantic engine intelligently maps Primary and Foreign keys to generate stunning, interactive **Mermaid.js Entity-Relationship Diagrams (ERDs)**.
* 🎨 **Premium UI/UX:** Built with a breathtaking, Obsidian-inspired glassmorphism dark theme and smooth micro-animations.

---

## 🏗️ Tech Stack & Architecture

SchemaScribe AI utilizes a robust Client-Server architecture combining high-performance data processing with cutting-edge Large Language Models.

* **Frontend:** Vanilla HTML5, CSS3 (Glassmorphism), JavaScript, Chart.js, Mermaid.js
* **Backend:** Python, FastAPI, Uvicorn 
* **Data Engine:** Pandas, NumPy (for high-speed vectorized calculations)
* **AI Engine:** Groq Cloud API (Llama-3.1 8B Instant)

### 💡 Why an "Agentic Approach"?
Instead of passing millions of rows to an LLM (which exceeds token limits and causes math hallucinations), SchemaScribe AI uses an **Agentic execution loop**. The AI acts as a planner—it reads the schema, writes Pandas code, and the backend executes it. This guarantees **100% mathematical accuracy** while maintaining the conversational ease of a chatbot.

---

## 🚀 Installation & Setup

Follow these steps to run SchemaScribe AI on your local machine.

### Prerequisites
* Python 3.9+
* A free API key from [Groq Cloud](https://console.groq.com/)

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/SchemaScribe-AI.git
cd SchemaScribe-AI
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables
Create a `.env` file inside the `app/` directory and add your Groq API Key:
```env
GROQ_API_KEY=your_api_key_here
```

### 4. Run the Backend Server
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 5. Launch the Frontend
Simply double-click the `frontend/index.html` file in your browser, or use a tool like VS Code Live Server.

---

## 📸 Screenshots

### 1. Main Dashboard & Data Dictionary
![Dashboard](assets/dashboard.png)

### 2. Smart Data Cleaning Studio
![Data Cleaning](assets/cleaning.png)

### 3. Chat with Dataset (Conversational Analytics)
![Chat Interface](assets/chat.png)

### 4. Multi-File ERD Visualizer
![ERD Visualizer](assets/erd.png)

---

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

## 📄 License
This project is [MIT](LICENSE) licensed.
# 🚀 SchemaScribe-AI Backend Repository
Looking for the Backend Engine & Agentic Sandbox code? 
👉 https://schemascribe-ai.onrender.com

