import os
import json
import requests
import time

def _post_with_retry(url, headers, json_payload, max_retries=2, backoff=1):
    for attempt in range(max_retries):
        try:
            response = requests.post(url, headers=headers, json=json_payload, timeout=5)
            if response.status_code in [429, 500, 502, 503, 504]:
                if attempt < max_retries - 1:
                    time.sleep(backoff)
                    continue
            return response
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            if attempt < max_retries - 1:
                time.sleep(backoff)
            else:
                raise e

def load_env():
    """Custom light-weight dotenv loader for zero external dependencies."""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()

# Load env immediately
load_env()

def generate_column_insights(col_name, profile_details, dataset_context=""):
    """
    Acts like an expert Senior Data Analyst. Calls the lightning-fast Groq API 
    (Llama3-8b) to generate JSON-formatted business descriptions and cleaning recommendations.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {
            "description": "API Key missing. Please set GROQ_API_KEY in the app/.env file.",
            "recommendation": "Set your Groq API key to unlock expert AI descriptions."
        }

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # Prepare detailed statistical profile text
    stats_text = (
        f"Column Name: '{col_name}'\n"
        f"Basic Pandas Type: {profile_details.get('pandas_dtype')}\n"
        f"Inferred Semantic Type: {profile_details.get('semantic_type')}\n"
        f"Completeness: {profile_details.get('non_null_count')} valid records, "
        f"{profile_details.get('null_percentage')}% missing.\n"
        f"Cardinality: {profile_details.get('unique_count')} unique values ({profile_details.get('unique_ratio')}% ratio).\n"
        f"Sample values: [{profile_details.get('sample_data')}]\n"
    )
    
    if profile_details.get("mean") is not None:
        stats_text += (
            f"Numeric Distribution: Min={profile_details.get('min')}, Max={profile_details.get('max')}, "
            f"Mean={profile_details.get('mean')}, StdDev={profile_details.get('std')}.\n"
            f"Anomalies: {profile_details.get('outliers_count')} outliers detected via Interquartile Range (IQR).\n"
        )

    system_prompt = (
        "You are a world-class Principal Data Architect and Senior Data Analyst with 15+ years of experience in enterprise business intelligence, database indexing, and data governance.\n"
        "Your objective is to analyze a column's statistical profile, cardinality, null ratios, anomalies, and sample values, and write authoritative, elite-level business summaries.\n"
        "You must output your response in EXACT JSON format with these two fields:\n"
        "1. 'description': A highly professional, single-sentence executive business definition. Explain *why* this data matters in a business context, what business KPIs it drives, and what it represents. Use sophisticated, concise terminology (e.g., 'chronological anchor', 'categorical dimension', 'metric variable') instead of basic descriptions.\n"
        "2. 'recommendation': An expert data quality, cleaning, and optimization recommendation. Provide concrete, advanced technical instructions based on the column's metrics (e.g., specify how to handle the exact null percentage, whether to index it for faster lookups, how to treat the outliers, or suggesting binning, scaling, or database partitioning based on cardinality and type).\n"
        "Your output must be valid JSON only, without any markdown codeblocks."
    )

    user_prompt = (
        f"Please analyze this column profile:\n\n{stats_text}\n"
        f"Optional Dataset Context: {dataset_context}\n"
        "Return the 'description' and 'recommendation' strictly in JSON format."
    )

    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.15,
        "max_tokens": 300,
        "response_format": {"type": "json_object"}
    }

    try:
        response = _post_with_retry(url, headers=headers, json_payload=payload)
        if response.status_code == 200:
            result_json = response.json()
            content_str = result_json["choices"][0]["message"]["content"]
            parsed_content = json.loads(content_str)
            return {
                "description": parsed_content.get("description", "No description generated."),
                "recommendation": parsed_content.get("recommendation", "No recommendations found.")
            }
        else:
            return {
                "description": f"Failed to generate description. Groq API returned status code {response.status_code}.",
                "recommendation": "Please verify your Groq API Key and internet connectivity."
            }
    except Exception as e:
        return {
            "description": f"AI Engine Connection Error: {str(e)}",
            "recommendation": "Review backend logs or check network state."
        }

def generate_outlier_insights(col_name, outliers_data, dataset_context=""):
    """
    Calls the Llama-3 API to generate a physical/business explanation for why these 
    specific extreme outliers might exist based on their row context.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {
            "explanation": "API Key missing. Please set GROQ_API_KEY in the app/.env file to unlock AI outlier analysis."
        }

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    outliers_text = json.dumps(outliers_data, indent=2)

    system_prompt = (
        "You are a world-class Principal Data Architect and Senior Data Analyst.\n"
        "Your objective is to analyze the top extreme outliers of a column along with their surrounding row context and provide a highly professional, physical/business explanation for WHY these anomalies might exist.\n"
        "Are they data entry errors, system glitches, or legitimate extreme business events? Provide your expert hypothesis.\n"
        "You must output your response in EXACT JSON format with a single field:\n"
        "1. 'explanation': A sophisticated, concise paragraph (2-3 sentences) explaining the likely root cause of these outliers based on the provided context.\n"
        "Your output must be valid JSON only, without any markdown codeblocks."
    )

    user_prompt = (
        f"Column Name: '{col_name}'\n"
        f"Top Extreme Outliers and Context Rows:\n{outliers_text}\n"
        f"Optional Dataset Context: {dataset_context}\n"
        "Return the 'explanation' strictly in JSON format."
    )

    payload = {
        "model": "llama-3.1-8b-instant",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 250,
        "response_format": {"type": "json_object"}
    }

    try:
        response = _post_with_retry(url, headers=headers, json_payload=payload)
        if response.status_code == 200:
            result_json = response.json()
            content_str = result_json["choices"][0]["message"]["content"]
            parsed_content = json.loads(content_str)
            return {
                "explanation": parsed_content.get("explanation", "No explanation generated.")
            }
        else:
            return {
                "explanation": f"Failed to generate explanation. Groq API returned status code {response.status_code}."
            }
    except Exception as e:
        return {
            "explanation": f"AI Engine Connection Error: {str(e)}"
        }
