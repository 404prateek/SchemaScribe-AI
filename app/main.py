# main.py - FastAPI Application for Intelligent Data Dictionary & Analytics Agent
import os
import shutil
import uuid
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from typing import Optional, List

# Local imports
# Local imports
from .profiler import profile_dataset, generate_ddl_scripts, generate_erd_mapping
from .describer import generate_column_insights, generate_outlier_insights
from .chat import ask_dataset_chat

app = FastAPI(title="Intelligent Data Dictionary & Analytics Agent")

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_uploads")
os.makedirs(TEMP_DIR, exist_ok=True)

# Cache dictionary in memory for easy exporting
analysis_cache = {}

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

@app.post("/api/analyze")
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
                
            temp_file_path = os.path.join(TEMP_DIR, f"{workspace_id}_{file.filename}")
            
            with open(temp_file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
                
            # 1. Run pandas profiling
            profile_results = profile_dataset(temp_file_path)
            profile_results["filename"] = file.filename
            
            # 2. Enrich columns with Groq Llama-3 AI business descriptions
            if not is_multi:
                enriched_columns = []
                for col_profile in profile_results["columns"]:
                    ai_insights = generate_column_insights(
                        col_name=col_profile["name"],
                        profile_details=col_profile,
                        dataset_context=dataset_context
                    )
                    col_profile["description"] = ai_insights["description"]
                    col_profile["recommendation"] = ai_insights["recommendation"]
                    enriched_columns.append(col_profile)
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
            
            analysis_cache[f"{workspace_id}_{file.filename}"] = {
                "filename": file.filename,
                "file_path": temp_file_path,
                "data": profile_results
            }
            
        if len(profiles) == 0:
            raise HTTPException(status_code=400, detail="No valid files uploaded.")
            
        if not is_multi:
            p = profiles[0]
            # Override file_id backward compatibility
            analysis_cache[workspace_id] = analysis_cache[p["file_id"]]
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

@app.get("/api/export/{file_id}/{format_type}")
async def export_dictionary(file_id: str, format_type: str):
    """
    Exports the cached data dictionary in either Markdown or JSON formats.
    """
    if file_id not in analysis_cache:
        raise HTTPException(status_code=404, detail="Analysis results not found or expired.")

    cached = analysis_cache[file_id]
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

# Cleaning data cache
cleaned_files_cache = {}

class CleanRequest(BaseModel):
    file_id: str
    noise_value: Optional[float] = None
    numeric_imputation: str = "median" # median, mean, none
    categorical_imputation: str = "mode" # mode, placeholder, none

@app.post("/api/clean")
async def clean_dataset(request: CleanRequest):
    """
    Cleans sensor noise and applies smart imputation (median/mean/mode) 
    to numeric and categorical columns, then caches the cleaned dataset.
    """
    if request.file_id not in analysis_cache:
        raise HTTPException(status_code=404, detail="Original analysis dataset not found.")
        
    cached = analysis_cache[request.file_id]
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
        cleaned_files_cache[cleaned_file_id] = {
            "path": cleaned_path,
            "filename": download_name
        }
        
        return JSONResponse(content={
            "status": "success",
            "clean_file_id": cleaned_file_id,
            "download_name": download_name
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cleaning failed: {str(e)}")

@app.get("/api/download/{clean_file_id}")
async def download_cleaned_file(clean_file_id: str):
    """ Serves the cleaned CSV file for download. """
    if clean_file_id not in cleaned_files_cache:
        raise HTTPException(status_code=404, detail="Cleaned file not found or expired.")
        
    cached = cleaned_files_cache[clean_file_id]
    path = cached["path"]
    filename = cached["filename"]
    
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Cleaned file was deleted from disk.")
        
    return FileResponse(path, media_type="text/csv", filename=filename)

@app.post("/api/reset/{file_id}")
async def reset_dataset(file_id: str):
    """ Cleans up cached file paths from disk and clears the cache for a file_id. """
    if file_id in analysis_cache:
        cached = analysis_cache[file_id]
        file_path = cached.get("file_path")
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except:
                pass
        del analysis_cache[file_id]
        
    # Also clean related clean files
    keys_to_del = []
    for k, v in cleaned_files_cache.items():
        if os.path.exists(v["path"]):
            try:
                os.remove(v["path"])
            except:
                pass
        keys_to_del.append(k)
            
    for k in keys_to_del:
        del cleaned_files_cache[k]
        
    return {"status": "success", "message": "Cache and files cleared."}

# Create an empty __init__.py inside app directory to make it a module
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "__init__.py"), "w") as f:
    pass

class InvestigateRequest(BaseModel):
    file_id: str
    col_name: str
    dataset_context: Optional[str] = ""

@app.post("/api/investigate")
async def investigate_outliers(request: InvestigateRequest):
    if request.file_id not in analysis_cache:
        raise HTTPException(status_code=404, detail="Dataset analysis not found.")
        
    data = analysis_cache[request.file_id]["data"]
    
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

@app.post("/api/chat")
async def chat_with_dataset(request: ChatRequest):
    if request.file_id not in analysis_cache:
        raise HTTPException(status_code=404, detail="Dataset analysis not found.")
        
    cached = analysis_cache[request.file_id]
    file_path = cached.get("file_path")
    columns_profile = cached["data"]["columns"]
    
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset file expired or removed.")
        
    response = ask_dataset_chat(file_path, columns_profile, request.message)
    return response

