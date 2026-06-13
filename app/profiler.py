# profiler.py - High-Fidelity Pandas Profiling & Semantic Analytics Engine
import pandas as pd
import numpy as np
import re
import os

def clean_value(val):
    """Helper to convert numpy/pandas types into standard Python types for JSON serialization."""
    if pd.isna(val):
        return None
    if isinstance(val, (np.integer, np.int64, np.int32, np.int16, np.int8)):
        return int(val)
    if isinstance(val, (np.floating, np.float64, np.float32)):
        return float(val)
    if isinstance(val, (np.ndarray, list)):
        return [clean_value(x) for x in val]
    if isinstance(val, (pd.Timestamp, np.datetime64)):
        return str(val)
    return str(val)

def infer_semantic_type(col_name, series):
    """
    Acts like a Senior Data Analyst. Uses statistical distribution, heuristics,
    and regex to infer the real-world semantic type of a column.
    """
    col_lower = col_name.lower()
    non_null_series = series.dropna()
    total_len = len(series)
    non_null_len = len(non_null_series)
    
    if non_null_len == 0:
        return "Empty / Missing"
        
    unique_count = non_null_series.nunique()
    unique_ratio = unique_count / non_null_len if non_null_len > 0 else 0
    
    if any(hint in col_name.lower() for hint in ["aadhaar","aadhar","uid_no"]):
        return "Aadhaar ID"
    if any(hint in col_name.lower() for hint in ["blood_pressure","bp","systolic"]):
        return "Blood Pressure"

    # 1. Primary Key Detection
    if unique_count == total_len and total_len > 1:
        if any(substring in col_lower for substring in ["id", "key", "uuid", "code", "pk"]):
            return "Primary Key"
        # If it looks like a hash or unique identifier
        sample_str = str(non_null_series.iloc[0])
        if len(sample_str) > 10 and re.match(r'^[a-fA-F0-9\-]+$', sample_str):
            return "Unique Identifier"

    # 2. Email Address
    email_regex = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
    if non_null_len > 0 and all(isinstance(x, str) and re.match(email_regex, x.strip()) for x in non_null_series.head(10)):
        return "Email Address"

    # 3. URL/Link
    url_regex = r'^https?://[^\s/$.?#].[^\s]*$'
    if non_null_len > 0 and all(isinstance(x, str) and re.match(url_regex, x.strip()) for x in non_null_series.head(10)):
        return "URL / Link"

    # 4. Phone Number
    phone_regex = r'^\+?[\d\s\-()]{7,20}$'
    if any(x in col_lower for x in ["phone", "mobile", "tel", "contact"]):
        if all(isinstance(x, str) and re.match(phone_regex, x.strip()) for x in non_null_series.head(10)):
            return "Phone Number"

    # 5. Date/Time Detection
    if pd.api.types.is_datetime64_any_dtype(series):
        return "DateTime"
    if any(x in col_lower for x in ["date", "time", "created", "updated", "timestamp", "year", "month"]):
        try:
            pd.to_datetime(non_null_series.head(10), errors='raise')
            return "DateTime"
        except:
            pass

    # 6. Currency Detection
    currency_words = ["price", "amount", "salary", "cost", "revenue", "fee", "payment", "usd", "eur", "inr"]
    if any(x in col_lower for x in currency_words):
        if pd.api.types.is_numeric_dtype(series):
            return "Currency"
        # If string containing currency symbols
        sample_str = str(non_null_series.iloc[0])
        if any(sym in sample_str for sym in ["$", "€", "£", "₹"]):
            return "Currency"

    # 7. Zip/Postal Code
    if any(x in col_lower for x in ["zip", "postal", "pincode"]):
        if pd.api.types.is_numeric_dtype(series) or all(isinstance(x, str) and x.strip().isdigit() for x in non_null_series.head(10)):
            return "Zip / Postal Code"

    # 8. Boolean / Binary
    if unique_count == 2:
        vals = set(non_null_series.unique())
        if vals == {0, 1} or vals == {True, False} or vals == {"true", "false"} or vals == {"yes", "no"} or vals == {"Y", "N"}:
            return "Boolean / Flag"

    # 9. Categorical Variable
    if pd.api.types.is_object_dtype(series) or pd.api.types.is_categorical_dtype(series):
        if unique_count < 15 or unique_ratio < 0.15:
            return "Category"

    # 10. General Numeric types
    if pd.api.types.is_numeric_dtype(series):
        if pd.api.types.is_integer_dtype(series):
            return "Numeric (Integer)"
        return "Numeric (Float)"

    return "Text / String"

def _col_anomaly_penalty(series, col_lower):
    """
    Compute per-column anomaly penalty (0–20) for a single Series.
    Used by both detect_value_anomalies() and the per-column validity flag.
    """
    col_penalty = 0.0
    n = len(series)
    if n == 0:
        return col_penalty

    if pd.api.types.is_numeric_dtype(series):
        # Age column: valid range 0–120
        if any(k in col_lower for k in ['age']):
            invalid = ((series < 0) | (series > 120)).sum()
            col_penalty += (invalid / n) * 15

        # BMI: valid range 10–60
        elif any(k in col_lower for k in ['bmi']):
            invalid = ((series < 10) | (series > 60)).sum()
            col_penalty += (invalid / n) * 10

        # Financial columns: must be >= 0
        elif any(k in col_lower for k in
                 ['price', 'amount', 'bill', 'salary', 'cost',
                  'revenue', 'fee', 'charge', 'payment']):
            invalid = (series < 0).sum()
            col_penalty += (invalid / n) * 12

        # Percentage / discount / rating: 0–100
        elif any(k in col_lower for k in
                 ['pct', 'percent', 'discount', 'rating', 'score']):
            invalid = ((series < 0) | (series > 100)).sum()
            col_penalty += (invalid / n) * 8

        # Quantity / stock / count: must be >= 0
        elif any(k in col_lower for k in
                 ['qty', 'quantity', 'stock', 'count', 'units']):
            invalid = (series < 0).sum()
            col_penalty += (invalid / n) * 8

        # General 5×IQR extreme outlier check for ALL numeric cols
        Q1 = series.quantile(0.25)
        Q3 = series.quantile(0.75)
        IQR = Q3 - Q1
        if IQR > 0:
            extreme_low  = series < (Q1 - 5 * IQR)
            extreme_high = series > (Q3 + 5 * IQR)
            extreme_count = (extreme_low | extreme_high).sum()
            col_penalty += (extreme_count / n) * 10

    elif series.dtype == object:
        GARBAGE_VALUES = {
            '???', 'n/a', 'na', 'none', 'null', 'undefined',
            'unknown', 'tbd', 'test', 'xxx', '---', 'invalid',
            'notanemail', 'pending', 'missing', '#n/a', '#null!',
            '#value!', '#ref!', '#error', 'nan', 'inf', '-inf',
            '0/0', '999/999', 'abc/def', 'tomorrow', 'yesterday'
        }
        str_series = series.astype(str).str.strip().str.lower()
        garbage_count = str_series.isin(GARBAGE_VALUES).sum()
        col_penalty += (garbage_count / n) * 12

        empty_str = (str_series == '').sum()
        col_penalty += (empty_str / n) * 8

        # Email format validation
        if any(k in col_lower for k in ['email', 'mail']):
            valid_email = series.astype(str).str.match(
                r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
            )
            invalid_email = (~valid_email).sum()
            col_penalty += (invalid_email / n) * 10

        # Phone: 7–15 digits
        if any(k in col_lower for k in ['phone', 'mobile', 'tel', 'contact']):
            digit_only = series.astype(str).str.replace(
                r'[\s\-\+\(\)]', '', regex=True)
            invalid_phone = (~digit_only.str.match(r'^\d{7,15}$')).sum()
            col_penalty += (invalid_phone / n) * 8

        # Date column — try parsing, count failures and suspicious dates
        if any(k in col_lower for k in
               ['date', 'dob', 'dt', 'time', 'admission', 'joining']):
            parsed = pd.to_datetime(series, errors='coerce')
            unparseable = parsed.isna().sum()
            col_penalty += (unparseable / n) * 10
            future = (parsed > pd.Timestamp('2030-01-01')).sum()
            col_penalty += (future / n) * 8
            past = (parsed < pd.Timestamp('1900-01-01')).sum()
            col_penalty += (past / n) * 8

        # Pincode: must be exactly 6 digits (India)
        if any(k in col_lower for k in ['pin', 'pincode', 'postal', 'zip']):
            invalid_pin = (~series.astype(str).str.match(r'^\d{6}$')).sum()
            col_penalty += (invalid_pin / n) * 6

    return col_penalty


def detect_value_anomalies(df, columns_profile):
    """
    Runs semantic value checks across all columns and returns a normalised
    anomaly_penalty in [0, 50] to subtract from health_score.
    """
    total_penalty = 0.0
    for col in df.columns:
        series = df[col].dropna()
        col_lower = col.lower()
        col_penalty = _col_anomaly_penalty(series, col_lower)
        # Cap per-column contribution at 20 so one bad column can't dominate
        total_penalty += min(col_penalty, 20.0)

    num_cols = max(len(df.columns), 1)
    # Normalise: max raw = num_cols * 20; map onto [0, 50]
    normalized = (total_penalty / (num_cols * 20)) * 50
    return round(min(normalized, 50.0), 2)

def profile_dataset(file_path):
    """
    Main expert data analysis engine. Performs deep profiling, calculates quality indices, 
    detects anomalies, and creates standard statistical aggregates.
    """
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.csv':
        df = pd.read_csv(file_path)
    elif ext in ['.xlsx', '.xls']:
        df = pd.read_excel(file_path)
    elif ext == '.json':
        df = pd.read_json(file_path)
    else:
        raise ValueError("Unsupported file format. Please upload .csv, .xlsx, or .json!")

    total_rows = len(df)
    total_cols = len(df.columns)
    
    if total_rows == 0:
        return {
            "total_rows": 0,
            "total_cols": total_cols,
            "duplicate_rows": 0,
            "completeness": 0.0,
            "health_score": 0.0,
            "columns": [],
            "charts": {},
            "sql_ddl": {}
        }

    # Data Quality calculations
    duplicate_rows = int(df.duplicated().sum())
    dup_percentage = (duplicate_rows / total_rows) * 100
    
    total_possible_cells = total_rows * total_cols
    total_missing_cells = int(df.isna().sum().sum())
    completeness = ((total_possible_cells - total_missing_cells) / total_possible_cells) * 100
    
    # ── Data Health Score (deduction system) ────────────────────────────────
    health_score = 100.0

    # Step 2a — Structural penalties
    missing_ratio = total_missing_cells / total_possible_cells
    health_score -= (missing_ratio * 25.0)          # nulls          (max –25)
    health_score -= (dup_percentage * 0.20)          # duplicates     (max –20)
    empty_cols = sum(df.isna().all())
    if total_cols > 0:
        health_score -= ((empty_cols / total_cols) * 10.0)  # empty cols (max –10)

    health_score = max(0.0, min(100.0, health_score))
    
    # Columns profiling
    columns_profile = []
    for col in df.columns:
        series = df[col]
        non_null_count = int(series.notna().sum())
        null_count = int(series.isna().sum())
        null_percentage = float((null_count / total_rows) * 100)
        
        unique_vals = series.dropna().unique()
        unique_count = int(len(unique_vals))
        unique_ratio = float((unique_count / non_null_count) * 100) if non_null_count > 0 else 0.0
        
        semantic_type = infer_semantic_type(col, series)
        
        # Calculate stats for numeric columns
        mean_val, std_val, min_val, max_val = None, None, None, None
        outlier_count = 0
        
        if pd.api.types.is_numeric_dtype(series) and non_null_count > 0:
            numeric_series = series.dropna()
            mean_val = float(numeric_series.mean())
            std_val = float(numeric_series.std()) if len(numeric_series) > 1 else 0.0
            min_val = float(numeric_series.min())
            max_val = float(numeric_series.max())
            
            # Outlier detection using IQR
            q25 = numeric_series.quantile(0.25)
            q75 = numeric_series.quantile(0.75)
            iqr = q75 - q25
            outliers_data = []
            if iqr > 0:
                lower_bound = q25 - 1.5 * iqr
                upper_bound = q75 + 1.5 * iqr
                outliers = numeric_series[(numeric_series < lower_bound) | (numeric_series > upper_bound)]
                outlier_count = int(len(outliers))
                
                # Extract top 5 extreme outliers with context rows
                if outlier_count > 0:
                    median_val = numeric_series.median()
                    outliers_abs_dev = (outliers - median_val).abs()
                    top_outliers = outliers_abs_dev.nlargest(5).index
                    
                    for idx in top_outliers:
                        row_dict = df.loc[idx].to_dict()
                        clean_row = {str(k): clean_value(v) for k, v in row_dict.items()}
                        outliers_data.append({
                            "row_index": int(idx),
                            "value": clean_value(outliers[idx]),
                            "context": clean_row
                        })
        
        # Create a beautiful sample data string
        sample_size = min(3, unique_count)
        if sample_size > 0:
            sample_choices = np.random.choice(unique_vals, size=sample_size, replace=False)
            sample_str = ", ".join([str(clean_value(x)) for x in sample_choices])
        else:
            sample_str = "N/A (All Missing)"
            
        # Per-column validity flag ──────────────────────────────────────────
        col_vp = _col_anomaly_penalty(series.dropna(), col.lower())
        has_validity_issues = col_vp > 5
        validity_issue_pct  = round(col_vp, 1) if has_validity_issues else 0

        columns_profile.append({
            "name": col,
            "pandas_dtype": str(df[col].dtype),
            "semantic_type": semantic_type,
            "non_null_count": non_null_count,
            "null_count": null_count,
            "null_percentage": round(null_percentage, 2),
            "unique_count": unique_count,
            "unique_ratio": round(unique_ratio, 2),
            "mean": round(mean_val, 2) if mean_val is not None else None,
            "std": round(std_val, 2) if std_val is not None else None,
            "min": clean_value(min_val) if min_val is not None else None,
            "max": clean_value(max_val) if max_val is not None else None,
            "outliers_count": outlier_count,
            "top_outliers": outliers_data if pd.api.types.is_numeric_dtype(series) else [],
            "sample_data": sample_str,
            "has_validity_issues": has_validity_issues,
            "validity_issue_pct": validity_issue_pct
        })
        
    # 3. Dynamic Chart Aggregates for visual analytics
    chart_data = {}
    
    # Find a primary numeric column for aggregation
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and "id" not in c.lower()]
    
    if len(numeric_cols) > 0:
        # Prefer floats (like 'Values' or 'price') over integers
        float_cols = [c for c in numeric_cols if pd.api.types.is_float_dtype(df[c])]
        target_num = float_cols[0] if len(float_cols) > 0 else numeric_cols[0]
        
        # Find categorical columns
        cat_cols = []
        for col_profile in columns_profile:
            if col_profile["semantic_type"] == "Category" and col_profile["name"] in df.columns:
                cat_cols.append(col_profile["name"])
                
        # Group numeric column by the first categorical column (e.g. Locations)
        if len(cat_cols) > 0:
            c1 = cat_cols[0]
            try:
                # Limit to top 10 categories to keep chart clean
                cat_agg = df.groupby(c1)[target_num].mean().dropna()
                chart_data["categorical_1"] = {
                    "column": c1,
                    "target": target_num,
                    "data": {str(k): round(float(v), 2) for k, v in cat_agg.head(10).to_dict().items()}
                }
            except:
                pass
                
        # Group numeric column by the second categorical column (e.g. Parameters)
        if len(cat_cols) > 1:
            c2 = cat_cols[1]
            try:
                cat_agg2 = df.groupby(c2)[target_num].mean().dropna()
                chart_data["categorical_2"] = {
                    "column": c2,
                    "target": target_num,
                    "data": {str(k): round(float(v), 2) for k, v in cat_agg2.head(15).to_dict().items()}
                }
            except:
                pass
                
        # Group numeric column by temporal/hour column if present
        time_cols = [c for c in df.columns if "hour" in c.lower() or "month" in c.lower() or "year" in c.lower() or df[c].dtype == 'datetime64[ns]']
        if len(time_cols) > 0:
            t1 = time_cols[0]
            try:
                # Check if it is a datetime column
                if df[t1].dtype == 'datetime64[ns]':
                    time_agg = df.set_index(t1)[target_num].resample('ME').mean().dropna().tail(12)
                    labels = [str(x.strftime('%Y-%m')) for x in time_agg.index]
                    chart_data["temporal"] = {
                        "column": t1,
                        "target": target_num,
                        "data": {labels[i]: round(float(v), 2) for i, v in enumerate(time_agg.values)}
                    }
                else:
                    time_agg = df.groupby(t1)[target_num].mean().dropna()
                    chart_data["temporal"] = {
                        "column": t1,
                        "target": target_num,
                        "data": {str(k): round(float(v), 2) for k, v in time_agg.head(24).to_dict().items()}
                    }
            except:
                pass
        
    # Step 4 — Semantic / value anomaly penalty (max –50) ──────────────────
    anomaly_penalty = detect_value_anomalies(df, columns_profile)
    health_score -= anomaly_penalty
    health_score = max(0.0, min(100.0, health_score))
    health_score = round(health_score, 2)

    # Step 5 — Quality label ────────────────────────────────────────────────
    if health_score >= 85:
        quality_label = "Excellent data quality — dataset is production-ready."
    elif health_score >= 70:
        quality_label = "Good data quality with minor issues."
    elif health_score >= 50:
        quality_label = "Moderate data quality — cleaning recommended."
    elif health_score >= 30:
        quality_label = "Poor data quality — significant issues detected."
    else:
        quality_label = "Critical data quality — dataset requires major cleaning."

    return {
        "total_rows": total_rows,
        "total_cols": total_cols,
        "duplicate_rows": duplicate_rows,
        "completeness": round(completeness, 2),
        "health_score": health_score,
        "quality_label": quality_label,
        "anomaly_penalty": anomaly_penalty,
        "validity_issues_detected": anomaly_penalty > 5,
        "columns": columns_profile,
        "charts": chart_data
    }

def sanitize_sql_identifier(name):
    """Sanitizes file names and column names into standard, database-friendly identifiers."""
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', name)
    if sanitized and sanitized[0].isdigit():
        sanitized = "_" + sanitized
    return sanitized[:63].lower()

def generate_ddl_scripts(filename, columns):
    """
    Generates tailored, highly optimized SQL DDL CREATE TABLE scripts for 
    PostgreSQL, MySQL, SQLite, Snowflake, SQL Server, and Oracle.
    """
    # Sanitize the table name
    base_name = os.path.splitext(filename)[0]
    table_name = sanitize_sql_identifier(base_name)
    if not table_name:
        table_name = "analyzed_dataset"

    # Define DB mappings
    # Each entry maps semantic_type to (PostgreSQL, MySQL, SQLite, Snowflake, SQL Server, Oracle) data types
    type_mappings = {
        "Primary Key": {
            "postgres": "SERIAL PRIMARY KEY",
            "mysql": "INT AUTO_INCREMENT PRIMARY KEY",
            "sqlite": "INTEGER PRIMARY KEY AUTOINCREMENT",
            "snowflake": "VARCHAR(255) PRIMARY KEY",
            "sql_server": "INT IDENTITY(1,1) PRIMARY KEY",
            "oracle": "NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"
        },
        "Unique Identifier": {
            "postgres": "VARCHAR(255) UNIQUE",
            "mysql": "VARCHAR(255) UNIQUE",
            "sqlite": "TEXT UNIQUE",
            "snowflake": "VARCHAR(255) UNIQUE",
            "sql_server": "VARCHAR(255) UNIQUE",
            "oracle": "VARCHAR2(255) UNIQUE"
        },
        "Email Address": {
            "postgres": "VARCHAR(255)",
            "mysql": "VARCHAR(255)",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR(255)",
            "sql_server": "VARCHAR(255)",
            "oracle": "VARCHAR2(255)"
        },
        "URL / Link": {
            "postgres": "VARCHAR(512)",
            "mysql": "VARCHAR(512)",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR(512)",
            "sql_server": "VARCHAR(512)",
            "oracle": "VARCHAR2(512)"
        },
        "Phone Number": {
            "postgres": "VARCHAR(50)",
            "mysql": "VARCHAR(50)",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR(50)",
            "sql_server": "VARCHAR(50)",
            "oracle": "VARCHAR2(50)"
        },
        "DateTime": {
            "postgres": "TIMESTAMP",
            "mysql": "DATETIME",
            "sqlite": "TEXT",
            "snowflake": "TIMESTAMP_NTZ",
            "sql_server": "DATETIME2",
            "oracle": "TIMESTAMP"
        },
        "Currency": {
            "postgres": "NUMERIC(15, 2)",
            "mysql": "DECIMAL(15, 2)",
            "sqlite": "REAL",
            "snowflake": "NUMBER(15, 2)",
            "sql_server": "DECIMAL(15, 2)",
            "oracle": "NUMBER(15, 2)"
        },
        "Zip / Postal Code": {
            "postgres": "VARCHAR(20)",
            "mysql": "VARCHAR(20)",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR(20)",
            "sql_server": "VARCHAR(20)",
            "oracle": "VARCHAR2(20)"
        },
        "Boolean / Flag": {
            "postgres": "BOOLEAN",
            "mysql": "TINYINT(1)",
            "sqlite": "INTEGER",
            "snowflake": "BOOLEAN",
            "sql_server": "BIT",
            "oracle": "NUMBER(1)"
        },
        "Category": {
            "postgres": "VARCHAR(100)",
            "mysql": "VARCHAR(100)",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR(100)",
            "sql_server": "VARCHAR(100)",
            "oracle": "VARCHAR2(100)"
        },
        "Numeric (Integer)": {
            "postgres": "INTEGER",
            "mysql": "INT",
            "sqlite": "INTEGER",
            "snowflake": "NUMBER",
            "sql_server": "INT",
            "oracle": "NUMBER"
        },
        "Numeric (Float)": {
            "postgres": "DOUBLE PRECISION",
            "mysql": "DOUBLE",
            "sqlite": "REAL",
            "snowflake": "DOUBLE",
            "sql_server": "FLOAT",
            "oracle": "NUMBER"
        },
        "Text / String": {
            "postgres": "TEXT",
            "mysql": "TEXT",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR",
            "sql_server": "NVARCHAR(MAX)",
            "oracle": "CLOB"
        },
        "Empty / Missing": {
            "postgres": "VARCHAR(255)",
            "mysql": "VARCHAR(255)",
            "sqlite": "TEXT",
            "snowflake": "VARCHAR(255)",
            "sql_server": "VARCHAR(255)",
            "oracle": "VARCHAR2(255)"
        }
    }

    # Generate scripts
    scripts = {}
    
    # 1. POSTGRESQL
    pg_cols = []
    pg_comments = []
    pg_comments.append(f"COMMENT ON TABLE {table_name} IS 'Table generated by SchemaScribe AI for {filename}';")
    for col in columns:
        col_name = sanitize_sql_identifier(col["name"])
        sem_type = col.get("semantic_type", "Text / String")
        db_type = type_mappings.get(sem_type, type_mappings["Text / String"])["postgres"]
        null_stmt = " NOT NULL" if col.get("null_percentage", 0) == 0 and "PRIMARY KEY" not in db_type else ""
        pg_cols.append(f"  {col_name} {db_type}{null_stmt}")
        
        clean_desc = col.get("description", "").replace("'", "''")
        if clean_desc:
            pg_comments.append(f"COMMENT ON COLUMN {table_name}.{col_name} IS '{clean_desc}';")
            
    pg_script = f"CREATE TABLE {table_name} (\n" + ",\n".join(pg_cols) + "\n);\n\n" + "\n".join(pg_comments)
    scripts["postgresql"] = pg_script

    # 2. MYSQL
    my_cols = []
    for col in columns:
        col_name = sanitize_sql_identifier(col["name"])
        sem_type = col.get("semantic_type", "Text / String")
        db_type = type_mappings.get(sem_type, type_mappings["Text / String"])["mysql"]
        null_stmt = " NOT NULL" if col.get("null_percentage", 0) == 0 and "PRIMARY KEY" not in db_type else ""
        clean_desc = col.get("description", "").replace("'", "''")
        comment_stmt = f" COMMENT '{clean_desc}'" if clean_desc else ""
        my_cols.append(f"  {col_name} {db_type}{null_stmt}{comment_stmt}")
    my_script = f"CREATE TABLE {table_name} (\n" + ",\n".join(my_cols) + f"\n) ENGINE=InnoDB COMMENT='Table generated by SchemaScribe AI for {filename}';"
    scripts["mysql"] = my_script

    # 3. SQLITE
    sl_cols = []
    sl_header = f"-- SQLite Table DDL generated by SchemaScribe AI for {filename}\n"
    for col in columns:
        col_name = sanitize_sql_identifier(col["name"])
        sem_type = col.get("semantic_type", "Text / String")
        db_type = type_mappings.get(sem_type, type_mappings["Text / String"])["sqlite"]
        null_stmt = " NOT NULL" if col.get("null_percentage", 0) == 0 and "PRIMARY KEY" not in db_type else ""
        comment_inline = f" -- {col.get('description', '')}" if col.get('description') else ""
        sl_cols.append(f"  {col_name} {db_type}{null_stmt}{comment_inline}")
    sl_script = sl_header + f"CREATE TABLE {table_name} (\n" + ",\n".join(sl_cols) + "\n);"
    scripts["sqlite"] = sl_script

    # 4. SNOWFLAKE
    sf_cols = []
    for col in columns:
        col_name = sanitize_sql_identifier(col["name"])
        sem_type = col.get("semantic_type", "Text / String")
        db_type = type_mappings.get(sem_type, type_mappings["Text / String"])["snowflake"]
        null_stmt = " NOT NULL" if col.get("null_percentage", 0) == 0 and "PRIMARY KEY" not in db_type else ""
        clean_desc = col.get("description", "").replace("'", "''")
        comment_stmt = f" COMMENT '{clean_desc}'" if clean_desc else ""
        sf_cols.append(f"  {col_name} {db_type}{null_stmt}{comment_stmt}")
    sf_script = f"CREATE TABLE {table_name} (\n" + ",\n".join(sf_cols) + f"\n) COMMENT = 'Table generated by SchemaScribe AI for {filename}';"
    scripts["snowflake"] = sf_script

    # 5. SQL SERVER (T-SQL)
    ss_cols = []
    ss_header = f"-- Microsoft SQL Server Table DDL generated by SchemaScribe AI\n"
    for col in columns:
        col_name = sanitize_sql_identifier(col["name"])
        sem_type = col.get("semantic_type", "Text / String")
        db_type = type_mappings.get(sem_type, type_mappings["Text / String"])["sql_server"]
        null_stmt = " NOT NULL" if col.get("null_percentage", 0) == 0 and "PRIMARY KEY" not in db_type else ""
        comment_inline = f" -- {col.get('description', '')}" if col.get('description') else ""
        ss_cols.append(f"  {col_name} {db_type}{null_stmt}{comment_inline}")
    ss_script = ss_header + f"CREATE TABLE {table_name} (\n" + ",\n".join(ss_cols) + "\n);"
    scripts["sql_server"] = ss_script

    # 6. ORACLE
    ora_cols = []
    ora_comments = []
    ora_comments.append(f"COMMENT ON TABLE {table_name} IS 'Table generated by SchemaScribe AI for {filename}';")
    for col in columns:
        col_name = sanitize_sql_identifier(col["name"])
        sem_type = col.get("semantic_type", "Text / String")
        db_type = type_mappings.get(sem_type, type_mappings["Text / String"])["oracle"]
        null_stmt = " NOT NULL" if col.get("null_percentage", 0) == 0 and "PRIMARY KEY" not in db_type else ""
        ora_cols.append(f"  {col_name} {db_type}{null_stmt}")
        
        clean_desc = col.get("description", "").replace("'", "''")
        if clean_desc:
            ora_comments.append(f"COMMENT ON COLUMN {table_name}.{col_name} IS '{clean_desc}';")
            
    ora_script = f"CREATE TABLE {table_name} (\n" + ",\n".join(ora_cols) + "\n);\n\n" + "\n".join(ora_comments)
    scripts["oracle"] = ora_script

    return scripts

def generate_erd_mapping(tables_profiles):
    """
    Finds primary and foreign key relationships between multiple tables.
    Returns nodes and links for Mermaid.js rendering.
    """
    nodes = []
    links = []
    
    # Identify Primary Keys for each table
    pks = {}
    for profile in tables_profiles:
        table_name = profile.get("filename", "unknown").split('.')[0]
        nodes.append(table_name)
        
        for col in profile["columns"]:
            if col["semantic_type"] in ["Primary Key", "Unique Identifier"]:
                pks[table_name] = col["name"]
                
    # Detect Foreign Keys using heuristics
    for profile in tables_profiles:
        table_name = profile.get("filename", "unknown").split('.')[0]
        for col in profile["columns"]:
            col_name = col["name"].lower()
            
            for other_table, pk_name in pks.items():
                if other_table != table_name:
                    if other_table.lower() in col_name or (pk_name and pk_name.lower() in col_name):
                        links.append({
                            "source": other_table,
                            "target": table_name,
                            "label": f"{pk_name} -> {col['name']}"
                        })
                        
    return {"nodes": nodes, "links": links}

