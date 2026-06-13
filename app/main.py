# main.py - FastAPI Application for Intelligent Data Dictionary & Analytics Agent
import os
import shutil
import uuid
import json
import asyncio
import redis
import pickle
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Security, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from typing import Optional, List

# Local imports
from .profiler import profile_dataset, generate_ddl_scripts, generate_erd_mapping
from .describer import generate_column_insights, generate_column_insights_async, generate_outlier_insights
from .chat import ask_dataset_chat

app = FastAPI(title="Intelligent Data Dictionary & Analytics Agent")

# ── API Key Auth ──────────────────────────────────────────────────────────────
# Set APP_API_KEY in app/.env to enable auth. If not set, auth is skipped
# (safe for local dev, required for production deployment).
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(key: Optional[str] = Security(_api_key_header)):
    required = os.environ.get("APP_API_KEY")
    if required and key != required:
        raise HTTPException(status_code=403, detail="Invalid or missing API key. Set X-API-Key header.")

# ── Semaphore: max 8 concurrent Groq calls to stay within rate limits ─────────
_groq_semaphore = asyncio.Semaphore(8)

async def _fetch_insight_limited(col_profile, dataset_context):
    async with _groq_semaphore:
        result = await generate_column_insights_async(
            col_profile["name"], col_profile, dataset_context
        )
        return col_profile, result

# ── File upload size limit (100 MB) ──────────────────────────────────────────
_MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

# Enable CORS for frontend integration
# NOTE: allow_credentials=True is INCOMPATIBLE with allow_origins=["*"].
# Browsers will silently drop the response, causing "Failed to fetch" errors.
# Keep allow_credentials=False when using wildcard origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_uploads")
os.makedirs(TEMP_DIR, exist_ok=True)

# ── Session Store: Redis with in-process dict fallback ──────────────────────
class SessionStore:
    def __init__(self):
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        try:
            self.r = redis.from_url(redis_url, decode_responses=False)
            self.r.ping()
            self.available = True
        except Exception:
            self.r = None
            self.available = False
        self._fallback = {}
        self.TTL = 7200  # 2 hours

    def set(self, key: str, value: dict):
        if self.available:
            self.r.setex(key, self.TTL, pickle.dumps(value))
        else:
            self._fallback[key] = value

    def get(self, key: str):
        if self.available:
            raw = self.r.get(key)
            return pickle.loads(raw) if raw else None
        return self._fallback.get(key)

    def delete(self, key: str):
        if self.available:
            self.r.delete(key)
        else:
            self._fallback.pop(key, None)

    def exists(self, key: str) -> bool:
        if self.available:
            return bool(self.r.exists(key))
        return key in self._fallback

    def items_with_prefix(self, prefix: str):
        """Yields (key, value) pairs for all keys starting with prefix."""
        if self.available:
            for k in self.r.scan_iter(f"{prefix}*"):
                raw = self.r.get(k)
                if raw:
                    key_str = k.decode() if isinstance(k, bytes) else k
                    yield key_str, pickle.loads(raw)
        else:
            for k, v in list(self._fallback.items()):
                if k.startswith(prefix):
                    yield k, v

store = SessionStore()

class ColumnProfile(BaseModel):
    name: str
    pandas_dtype: str
    semantic_type: str
    non_null_count: int
    null_count: int
    null_percentage: float
    unique_count: int
    unique_ratio: float
    mean: Optional[float]
    std: Optional[float]
    min: Optional[str]
    max: Optional[str]
    outliers_count: int
    sample_data: str
    description: str
    recommendation: str

class DatasetProfile(BaseModel):
    total_rows: int
    total_cols: int
    duplicate_rows: int
    completeness: float
    health_score: float
    columns: List[ColumnProfile]

@app.post("/api/analyze", dependencies=[Depends(verify_api_key)])
async def analyze_file(files: List[UploadFile] = File(...), dataset_context: Optional[str] = Form("")):
    """
    Saves the uploaded file(s), runs the pandas profiling engine, generates 
    lightning-fast AI column descriptions, and stores the results in the cache.
    If multiple files are uploaded, it bypasses AI descriptions and generates an ERD map.
    """
    is_multi = len(files) > 1
    workspace_id = str(uuid.uuid4())
    
    profiles = []
    
    try:
        for file in files:
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in ['.csv', '.xlsx', '.xls', '.json']:
                continue

            # Backend file size enforcement
            file_bytes = await file.read()
            if len(file_bytes) > _MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail=f"{file.filename} exceeds the 100 MB upload limit.")

            temp_file_path = os.path.join(TEMP_DIR, f"{workspace_id}_{file.filename}")
            with open(temp_file_path, "wb") as buffer:
                buffer.write(file_bytes)
                
            # 1. Run pandas profiling in the default thread pool so it doesn't block the async event loop.
            # Use asyncio.get_running_loop() — correct for Python 3.10+ inside an async context.
            loop = asyncio.get_running_loop()
            profile_results = await loop.run_in_executor(None, profile_dataset, temp_file_path)
            profile_results["filename"] = file.filename
            
            # 2. Enrich columns with Groq Llama-3 AI business descriptions in parallel
            if not is_multi:
                # Pre-fill ALL columns with fallback text first (ensures fields always exist)
                for col_profile in profile_results["columns"]:
                    if col_profile.get("null_percentage", 0) == 100.0 or col_profile.get("semantic_type") == "Empty / Missing":
                        col_profile["description"] = "This column contains no valid data (100% missing). Populate it before analysis."
                        col_profile["recommendation"] = "Drop this column or investigate the data pipeline — all values are null."
                    else:
                        col_profile["description"] = "AI description pending..."
                        col_profile["recommendation"] = "AI recommendation pending..."

                # Collect only columns that need an AI call
                cols_needing_ai = [
                    c for c in profile_results["columns"]
                    if c.get("null_percentage", 0) != 100.0 and c.get("semantic_type") != "Empty / Missing"
                ]

                # Fire all AI calls concurrently, rate-limited by semaphore
                results = await asyncio.gather(
                    *[_fetch_insight_limited(c, dataset_context) for c in cols_needing_ai],
                    return_exceptions=True
                )
                for item in results:
                    if isinstance(item, Exception):
                        continue  # leave placeholder text already set
                    col_profile, ai_insights = item
                    col_profile["description"] = ai_insights["description"]
                    col_profile["recommendation"] = ai_insights["recommendation"]

                enriched_columns = profile_results["columns"]
                profile_results["columns"] = enriched_columns

                # 3. Generate Database DDL Scripts
                profile_results["sql_ddl"] = generate_ddl_scripts(file.filename, enriched_columns)
            else:
                for col_profile in profile_results["columns"]:
                    col_profile["description"] = "Multi-file workspace. AI insights bypassed."
                    col_profile["recommendation"] = "Multi-file workspace. AI recommendations bypassed."
                profile_results["sql_ddl"] = {}
                
            profiles.append({
                "file_id": f"{workspace_id}_{file.filename}",
                "filename": file.filename,
                "profile": profile_results
            })
            
            store.set(f"{workspace_id}_{file.filename}", {
                "filename": file.filename,
                "file_path": temp_file_path,
                "data": profile_results
            })
            
        if len(profiles) == 0:
            raise HTTPException(status_code=400, detail="No valid files uploaded.")
            
        if not is_multi:
            p = profiles[0]
            # Override file_id backward compatibility
            store.set(workspace_id, store.get(p["file_id"]))
            return JSONResponse(content={
                "status": "success",
                "file_id": workspace_id,
                "filename": p["filename"],
                "profile": p["profile"],
                "is_multi": False
            })
        else:
            erd_mapping = generate_erd_mapping([p["profile"] for p in profiles])
            
            merged_profile = {
                "total_rows": sum(p["profile"]["total_rows"] for p in profiles),
                "total_cols": sum(p["profile"]["total_cols"] for p in profiles),
                "duplicate_rows": sum(p["profile"]["duplicate_rows"] for p in profiles),
                "completeness": round(sum(p["profile"].get("completeness", 0) for p in profiles) / len(profiles), 2),
                "health_score": round(sum(p["profile"]["health_score"] for p in profiles) / len(profiles), 2),
                "columns": [],
                "charts": {},
                "sql_ddl": {}
            }
            
            for p in profiles:
                filename_no_ext = os.path.splitext(p["filename"])[0]
                for c in p["profile"]["columns"]:
                    c_copy = dict(c)
                    c_copy["name"] = f"{filename_no_ext}.{c['name']}"
                    merged_profile["columns"].append(c_copy)
                    
            return JSONResponse(content={
                "status": "success",
                "file_id": workspace_id,
                "filename": "Multi-File Workspace",
                "profile": merged_profile,
                "is_multi": True,
                "erd_mapping": erd_mapping
            })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
        
    finally:
        # File is kept in TEMP_DIR for cleaning/chatbot operations.
        # Deletion is handled when reset is triggered.
        pass

@app.get("/api/export/{file_id}/{format_type}", dependencies=[Depends(verify_api_key)])
async def export_dictionary(file_id: str, format_type: str):
    """
    Exports the cached data dictionary in either Markdown or JSON formats.
    """
    if not store.exists(file_id):
        raise HTTPException(status_code=404, detail="Analysis results not found or expired.")

    cached = store.get(file_id)
    filename = cached["filename"]
    data = cached["data"]

    if format_type.lower() == "json":
        export_filename = f"data_dictionary_{file_id}.json"
        export_path = os.path.join(TEMP_DIR, export_filename)
        with open(export_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        return FileResponse(export_path, media_type="application/json", filename=f"Data_Dictionary_{os.path.splitext(filename)[0]}.json")

    elif format_type.lower() == "markdown":
        export_filename = f"data_dictionary_{file_id}.md"
        export_path = os.path.join(TEMP_DIR, export_filename)
        
        # Generate elegant markdown string
        md = []
        md.append(f"# Data Dictionary & Analytics Report: {filename}\n")
        md.append("## 📊 Dataset Executive Summary\n")
        md.append(f"- **Total Rows:** {data['total_rows']:,}")
        md.append(f"- **Total Columns:** {data['total_cols']:,}")
        md.append(f"- **Duplicate Rows:** {data['duplicate_rows']:,}")
        md.append(f"- **Data Completeness:** {data['completeness']}%")
        md.append(f"- **Overall Data Health Score:** {data['health_score']}%/100%\n")
        
        md.append("## 📚 Column-Level Schema Definitions\n")
        
        for idx, col in enumerate(data["columns"], 1):
            md.append(f"### {idx}. {col['name']}\n")
            md.append(f"- **Semantic Data Type:** `{col['semantic_type']}` (Pandas Class: `{col['pandas_dtype']}`)")
            md.append(f"- **Completeness Score:** {col['non_null_count']:,} valid cells, {col['null_percentage']}% missing.")
            md.append(f"- **Cardinality Ratio:** {col['unique_count']:,} unique values ({col['unique_ratio']}% uniqueness).")
            md.append(f"- **Sample Values:** `[{col['sample_data']}]`")
            
            if col.get("mean") is not None:
                md.append(f"- **Numeric Summary:** Min={col['min']}, Max={col['max']}, Average={col['mean']}, StdDev={col['std']}")
                md.append(f"- **Outliers Flagged:** {col['outliers_count']} anomalous rows.")
                
            md.append(f"\n> **AI Analyst Description:** {col['description']}")
            md.append(f">\n> **Actionable Cleaning Recommendation:** {col['recommendation']}\n")
            md.append("---" * 15 + "\n")
            
        with open(export_path, "w", encoding="utf-8") as f:
            f.write("\n".join(md))
            
        return FileResponse(export_path, media_type="text/markdown", filename=f"Data_Dictionary_{os.path.splitext(filename)[0]}.md")
        
    else:
        raise HTTPException(status_code=400, detail="Invalid export format! Supported: markdown, json.")

class CleanRequest(BaseModel):
    file_id: str
    noise_value: Optional[float] = None
    numeric_imputation: str = "median" # median, mean, none
    categorical_imputation: str = "mode" # mode, placeholder, none

@app.post("/api/clean", dependencies=[Depends(verify_api_key)])
async def clean_dataset(request: CleanRequest):
    """
    Cleans sensor noise and applies smart imputation (median/mean/mode) 
    to numeric and categorical columns, then caches the cleaned dataset.
    """
    if not store.exists(request.file_id):
        raise HTTPException(status_code=404, detail="Original analysis dataset not found.")
        
    cached = store.get(request.file_id)
    file_path = cached.get("file_path")
    filename = cached["filename"]
    
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Original dataset file has expired or was removed.")
        
    try:
        import pandas as pd
        import numpy as np
        
        ext = os.path.splitext(file_path)[1].lower()
        if ext == '.csv':
            df = pd.read_csv(file_path)
        elif ext in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path)
        elif ext == '.json':
            df = pd.read_json(file_path)
        else:
            raise ValueError("Unsupported extension")
            
        # 1. Filter Sensor Errors (Noise replacement)
        if request.noise_value is not None:
            df = df.replace({request.noise_value: np.nan, str(request.noise_value): np.nan})
            try:
                float_noise = float(request.noise_value)
                df = df.replace({float_noise: np.nan, str(float_noise): np.nan})
            except:
                pass
                
        # 2. Imputation
        for col in df.columns:
            if df[col].isna().all():
                continue
                
            if pd.api.types.is_numeric_dtype(df[col]):
                if request.numeric_imputation == "median":
                    col_median = df[col].median()
                    df[col] = df[col].fillna(col_median)
                elif request.numeric_imputation == "mean":
                    col_mean = df[col].mean()
                    df[col] = df[col].fillna(col_mean)
            else:
                if request.categorical_imputation == "mode":
                    modes = df[col].mode()
                    col_mode = modes.iloc[0] if not modes.empty else "Unknown"
                    df[col] = df[col].fillna(col_mode)
                elif request.categorical_imputation == "placeholder":
                    df[col] = df[col].fillna("Missing")
                    
        # 3. Save cleaned file
        cleaned_file_id = str(uuid.uuid4())
        cleaned_filename = f"Cleaned_{cleaned_file_id}.csv"
        cleaned_path = os.path.join(TEMP_DIR, cleaned_filename)
        df.to_csv(cleaned_path, index=False)
        
        # Cache for download
        download_name = f"Cleaned_{os.path.splitext(filename)[0]}.csv"
        store.set(f"cleaned:{cleaned_file_id}", {
            "path": cleaned_path,
            "filename": download_name
        })
        
        return JSONResponse(content={
            "status": "success",
            "clean_file_id": cleaned_file_id,
            "download_name": download_name
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cleaning failed: {str(e)}")

@app.get("/api/download/{clean_file_id}", dependencies=[Depends(verify_api_key)])
async def download_cleaned_file(clean_file_id: str):
    """ Serves the cleaned CSV file for download. """
    if not store.exists(f"cleaned:{clean_file_id}"):
        raise HTTPException(status_code=404, detail="Cleaned file not found or expired.")
        
    cached = store.get(f"cleaned:{clean_file_id}")
    path = cached["path"]
    filename = cached["filename"]
    
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Cleaned file was deleted from disk.")
        
    return FileResponse(path, media_type="text/csv", filename=filename)

@app.post("/api/reset/{file_id}")
async def reset_dataset(file_id: str):
    """ Cleans up cached file paths from disk and clears the cache for a file_id. """
    if store.exists(file_id):
        cached = store.get(file_id)
        file_path = cached.get("file_path")
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        store.delete(file_id)
        
    # Also clean related clean files
    for k, v in store.items_with_prefix("cleaned:"):
        if os.path.exists(v["path"]):
            try:
                os.remove(v["path"])
            except:
                pass
        store.delete(k)
        
    return {"status": "success", "message": "Cache and files cleared."}

# Note: __init__.py is committed to the repo; no need to recreate it at runtime.

class InvestigateRequest(BaseModel):
    file_id: str
    col_name: str
    dataset_context: Optional[str] = ""

@app.post("/api/investigate", dependencies=[Depends(verify_api_key)])
async def investigate_outliers(request: InvestigateRequest):
    if not store.exists(request.file_id):
        raise HTTPException(status_code=404, detail="Dataset analysis not found.")
        
    data = store.get(request.file_id)["data"]
    
    col_profile = None
    for col in data["columns"]:
        if col["name"] == request.col_name:
            col_profile = col
            break
            
    if not col_profile:
        raise HTTPException(status_code=404, detail="Column not found.")
        
    top_outliers = col_profile.get("top_outliers", [])
    if not top_outliers:
        return {"explanation": "No extreme outliers found for this column to investigate.", "outliers": []}
        
    insights = generate_outlier_insights(request.col_name, top_outliers, request.dataset_context)
    return {
        "outliers": top_outliers,
        "explanation": insights.get("explanation", "Could not generate an explanation.")
    }

class ChatRequest(BaseModel):
    file_id: str
    message: str

# ── Voice-to-Text (Sarvam AI) ─────────────────────────────────────────────────
@app.post("/api/voice-to-text")
async def voice_to_text(audio: UploadFile = File(...)):
    """
    Receives an audio blob (webm/wav) from the browser MediaRecorder API,
    forwards it to Sarvam AI's speech-to-text endpoint, and returns the transcript.
    SARVAM_API_KEY must be set in app/.env.
    """
    from .describer import load_env as _reload_env
    _reload_env()  # pick up key if server wasn't restarted after .env edit

    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="SARVAM_API_KEY not set in app/.env.")

    try:
        import requests as _requests

        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file received.")

        response = _requests.post(
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": api_key},
            files={"file": (audio.filename or "audio.webm", audio_bytes, audio.content_type or "audio/webm")},
            data={
                "model": "saaras:v3",
                "language_code": "unknown",
                "mode": "transcribe",
            },
            timeout=30,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Sarvam API error {response.status_code}: {response.text[:200]}"
            )

        result = response.json()
        # Sarvam returns {"transcript": "...", ...}
        transcript = result.get("transcript") or result.get("text") or ""
        return JSONResponse(content={"transcript": transcript})

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Voice transcription failed: {str(e)}")


@app.post("/api/chat", dependencies=[Depends(verify_api_key)])
async def chat_with_dataset(request: ChatRequest):
    if not store.exists(request.file_id):
        raise HTTPException(status_code=404, detail="Dataset analysis not found.")
        
    cached = store.get(request.file_id)
    file_path = cached.get("file_path")
    columns_profile = cached["data"]["columns"]
    
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset file expired or removed.")
        
    response = ask_dataset_chat(file_path, columns_profile, request.message)
    return response


# ── Serve Frontend (must be mounted AFTER all API routes) ────────────────────
_FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.isdir(_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")

