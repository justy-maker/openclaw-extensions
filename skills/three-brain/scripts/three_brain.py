#!/usr/bin/env python3
"""
三腦會議 — Three-Brain Meeting
同時諮詢 Gemini 和 GPT，輸出結構化結果供 Claude 整合。

Usage:
    python3 three_brain.py --question "問題" [--context "背景"] [--role strategist|marketer|critic|analyst|open]
"""
import argparse, subprocess, json, os, sys, concurrent.futures, textwrap
from pathlib import Path

ROLE_PROMPTS = {
    "strategist": "You are a product strategist. Focus on market fit, ICP, value proposition, and MVP definition. Be specific and actionable.",
    "marketer": "You are a marketing strategist. Focus on positioning, channels, content strategy, and funnel design. Be specific and actionable.",
    "critic": "You are a devil's advocate / critic. Your job is to find flaws, challenge assumptions, identify risks, and push back on at least 30% of the proposal. Be constructive but relentless.",
    "analyst": "You are a data analyst. Focus on metrics, A/B test design, KPIs, and data-driven validation. Be specific about what to measure and how.",
    "open": "You are a strategic advisor. Be concise, specific, and actionable.",
}

def load_env():
    env_file = Path.home() / ".openclaw" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

def ask_gemini(question: str) -> str:
    try:
        result = subprocess.run(
            ["gemini", question],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return f"ERROR: {result.stderr.strip()}"
    except FileNotFoundError:
        return "ERROR: gemini CLI not found"
    except subprocess.TimeoutExpired:
        return "ERROR: Gemini timeout (120s)"

def ask_gpt(question: str, model: str = "gpt-4o", system: str = "") -> str:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return "ERROR: OPENAI_API_KEY not set"
    
    import urllib.request
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system or "You are a strategic advisor. Reply in the same language as the question."},
            {"role": "user", "content": question},
        ],
        "temperature": 0.7,
    }).encode()
    
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"ERROR: {e}"

def main():
    parser = argparse.ArgumentParser(description="三腦會議")
    parser.add_argument("--question", "-q", required=True, help="策略問題")
    parser.add_argument("--context", "-c", default="", help="背景資料")
    parser.add_argument("--role", "-r", default="open", choices=ROLE_PROMPTS.keys())
    parser.add_argument("--gpt-model", default="gpt-4o")
    parser.add_argument("--output", "-o", default="", help="輸出檔案路徑")
    args = parser.parse_args()
    
    load_env()
    
    system_prompt = ROLE_PROMPTS[args.role] + " Reply in the same language as the question."
    full_question = args.question
    if args.context:
        full_question = f"背景：\n{args.context}\n\n問題：\n{args.question}"
    
    gemini_q = f"[角色] {system_prompt}\n\n{full_question}"
    
    print("🧠 三腦會議開始...", file=sys.stderr)
    print(f"📋 議題：{args.question[:80]}", file=sys.stderr)
    print(f"🎭 角色：{args.role}", file=sys.stderr)
    print("⏳ 同時諮詢 Gemini 和 GPT...", file=sys.stderr)
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f_gemini = executor.submit(ask_gemini, gemini_q)
        f_gpt = executor.submit(ask_gpt, full_question, args.gpt_model, system_prompt)
        
        gemini_result = f_gemini.result()
        gpt_result = f_gpt.result()
    
    output = textwrap.dedent(f"""\
    # 🧠 三腦會議結果
    
    **議題：** {args.question}
    **角色：** {args.role}
    **背景：** {args.context or '(無)'}
    
    ---
    
    ## ♊ Gemini 觀點
    
    {gemini_result}
    
    ---
    
    ## 🤖 GPT 觀點
    
    {gpt_result}
    
    ---
    
    ## 📋 待 Claude 整合
    
    > Claude 作為主持人，請比較以上兩方觀點，加上自己的分析，產出：
    > 1. 共識點
    > 2. 分歧點
    > 3. 整合建議
    > 4. 下一步行動
    """)
    
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"✅ 結果已寫入 {args.output}", file=sys.stderr)
    else:
        print(output)
    
    print("✅ 三腦會議結束", file=sys.stderr)

if __name__ == "__main__":
    main()
