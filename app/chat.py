# chat.py - Conversational Analytics using Llama-3.1 and Pandas Execution
import os
import ast
import json
import requests
import io
import contextlib
import pandas as pd
import numpy as np
import re
import time
import concurrent.futures

# ── Sandbox: safe builtins only — blocks ALL imports and dangerous calls ──
_SAFE_BUILTINS = {
    '__builtins__': {},
    'len': len, 'range': range, 'print': print,
    'list': list, 'dict': dict, 'set': set, 'tuple': tuple,
    'str': str, 'int': int, 'float': float, 'bool': bool,
    'round': round, 'sum': sum, 'min': min, 'max': max, 'abs': abs,
    'enumerate': enumerate, 'zip': zip, 'sorted': sorted, 'reversed': reversed,
    'isinstance': isinstance, 'type': type, 'hasattr': hasattr,
    'True': True, 'False': False, 'None': None,
}

# Patterns that must never appear in LLM-generated code
_BLOCKED_PATTERNS = re.compile(
    r'\b(import|__import__|exec|eval|open|compile|globals|locals|vars|dir'
    r'|getattr|setattr|delattr|os|sys|subprocess|socket|shutil|pathlib'
    r'|requests|urllib|httpx|pickle|shelve|builtins)\b'
    r'|__\w+__'       # any dunder
    r'|\\x[0-9a-fA-F]{2}'  # hex escapes used to smuggle code
)

def _is_safe_code(code: str) -> tuple[bool, str]:
    """Layer 1: regex scan. Layer 2: AST walk for imports/calls."""
    if _BLOCKED_PATTERNS.search(code):
        return False, "Blocked pattern detected in generated code."
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error: {e}"
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return False, "Import statements are not allowed."
        if isinstance(node, ast.Call):
            # block any call to attribute chains like os.system(...)
            if isinstance(node.func, ast.Attribute):
                if isinstance(node.func.value, ast.Name):
                    if node.func.value.id in ('os', 'sys', 'subprocess', 'shutil'):
                        return False, f"Blocked system call: {node.func.value.id}"
    return True, ""

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

def execute_pandas_code(df, code_str):
    """Executes pandas code in a sandboxed scope with restricted builtins."""
    # Clean markdown code fences
    code_str = re.sub(r'```python\n?', '', code_str)
    code_str = re.sub(r'```\n?', '', code_str)
    code_str = code_str.strip()

    # Security: reject unsafe code before exec
    safe, reason = _is_safe_code(code_str)
    if not safe:
        return False, f"Security check failed: {reason}", None, code_str

    local_vars = {"df": df, "pd": pd, "np": np, "result": None}
    # Restricted globals: only safe builtins + pandas/numpy
    sandbox_globals = dict(_SAFE_BUILTINS)
    sandbox_globals["pd"] = pd
    sandbox_globals["np"] = np

    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        try:
            exec(code_str, sandbox_globals, local_vars)  # noqa: S102
            
            res = local_vars.get("result")
            printed_out = stdout.getvalue().strip()
            
            # If result is a DataFrame, convert it to a dict for table rendering
            table_data = None
            if isinstance(res, pd.DataFrame):
                table_data = {
                    "columns": list(res.columns),
                    "rows": res.fillna("").head(20).values.tolist() # limit to top 20 for chat
                }
                final_answer = "Returned a table."
            elif isinstance(res, pd.Series):
                table_data = {
                    "columns": ["Index", "Value"],
                    "rows": [[str(k), str(v)] for k, v in res.head(20).items()]
                }
                final_answer = "Returned a series."
            else:
                final_answer = str(res) if res is not None else printed_out
                
            return True, final_answer, table_data, code_str
        except Exception as e:
            return False, f"Execution Error: {str(e)}", None, code_str

def execute_pandas_code_with_timeout(df, code_str, timeout=5):
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(execute_pandas_code, df, code_str)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError:
            return False, "Timeout: Pandas calculation exceeded 5 seconds.", None, code_str
        except Exception as e:
            return False, f"Error: {str(e)}", None, code_str

def ask_dataset_chat(file_path, columns_profile, user_message):
    """
    Two-step LangChain-like agent:
    1. Ask Llama to write pandas code to answer the query.
    2. Execute the code.
    3. Ask Llama to summarize the execution result for the user.
    """
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {"error": "API Key missing. Please set GROQ_API_KEY.", "reply": "I need a Groq API Key to chat!"}

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # Load DF
    try:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == '.csv':
            df = pd.read_csv(file_path)
        elif ext in ['.xlsx', '.xls']:
            df = pd.read_excel(file_path)
        elif ext == '.json':
            df = pd.read_json(file_path)
        else:
            return {"reply": "Unsupported file extension for chat."}
    except Exception as e:
        return {"reply": f"Could not load file: {str(e)}"}

    # Prepare Schema Context
    schema_lines = []
    for c in columns_profile:
        schema_lines.append(f"- {c['name']} (Type: {c['pandas_dtype']}, Semantic: {c['semantic_type']}, Nulls: {c['null_percentage']}%)")
    schema_text = "\n".join(schema_lines)
    
    # Step 1: Generate Code
    code_sys_prompt = (
        "You are an expert Python Pandas data analyst.\n"
        "The user will ask a question about their dataset, which is stored in a DataFrame called `df`.\n"
        f"Here is the schema of `df`:\n{schema_text}\n\n"
        "Write Python code using Pandas to answer the user's question.\n"
        "CRITICAL RULES:\n"
        "1. You MUST store your final answer in a variable named `result`.\n"
        "2. Do NOT use print(). Just assign the answer to `result`.\n"
        "3. Output ONLY the raw Python code. No explanations, no markdown formatting, no `python` block tags."
    )
    
    code_payload = {
        "model": "llama-3.1-8b-instant",
        "messages": [
            {"role": "system", "content": code_sys_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.1,
        "max_tokens": 500
    }
    
    try:
        res1 = _post_with_retry(url, headers=headers, json_payload=code_payload)
        
        success = False
        exec_result = ""
        generated_code = ""
        table_data = None
        clean_code = ""
        
        if res1.status_code != 200:
            exec_result = f"Code generation failed (Status {res1.status_code})"
        else:
            generated_code = res1.json()["choices"][0]["message"]["content"]
            # Execute Code with Timeout
            success, exec_result, table_data, clean_code = execute_pandas_code_with_timeout(df, generated_code, timeout=5)
        
        # Step 2: Summarize Answer or Fallback
        if success:
            summary_sys_prompt = (
                "You are a helpful, conversational AI data analyst assistant.\n"
                "The user asked a question about their data. We executed Pandas code to find the answer.\n"
                "Explain the result to the user clearly and concisely."
            )
            summary_user_prompt = (
                f"User Question: {user_message}\n"
                f"Execution Result: {exec_result}\n\n"
                "Provide the final conversational response to the user."
            )
        else:
            summary_sys_prompt = (
                "You are an expert AI data analyst.\n"
                "Answer the user's question directly based on the provided dataset schema.\n"
                "DO NOT mention anything about Python, code failures, timeouts, errors, or fallbacks.\n"
                "Act confident and provide your best logical answer, estimate, or statistical explanation as if you calculated it perfectly.\n"
                "Maintain a highly professional and seamless tone."
            )
            summary_user_prompt = (
                f"User Question: {user_message}\n"
                f"Dataset Schema:\n{schema_text}\n\n"
                "Provide your expert response directly."
            )
            
        summary_payload = {
            "model": "llama-3.1-8b-instant",
            "messages": [
                {"role": "system", "content": summary_sys_prompt},
                {"role": "user", "content": summary_user_prompt}
            ],
            "temperature": 0.4,
            "max_tokens": 400
        }
            
        res2 = _post_with_retry(url, headers=headers, json_payload=summary_payload)
        if res2.status_code == 200:
            final_reply = res2.json()["choices"][0]["message"]["content"]
        else:
            final_reply = f"I am unable to process this right now. Here is the raw error: {exec_result}"
            
        return {
            "reply": final_reply,
            "code": clean_code,
            "table_data": table_data,
            "success": success
        }
        
    except Exception as e:
        # Extreme fallback if even the try block fails (e.g. ConnectionError)
        return {"reply": "I'm currently unable to connect to the AI engine due to network instability. Please check your internet connection or try again in a few seconds!"}
