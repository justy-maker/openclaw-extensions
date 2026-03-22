#!/usr/bin/env python3
"""
策略會議 — Strategy Meeting (Phase 1-4)
多角色 Agent 從不同專業角度分析議題。

Features:
  Phase 1: 多角色並行諮詢 + CEO 彙整
  Phase 2: 角色記憶（歷史決策注入）
  Phase 3: 角色間對話反駁
  Phase 4: 會議紀錄自動歸檔

Usage:
    python3 strategy_meeting.py -q "議題" [-c "背景"] [-r cto,cmo,cfo] [--debate] [-o path]
"""
import argparse, subprocess, json, os, sys, concurrent.futures, textwrap, re
from pathlib import Path
from datetime import datetime, timezone, timedelta

SCRIPT_DIR = Path(__file__).parent
SKILL_DIR = SCRIPT_DIR.parent
CONFIG = json.loads((SKILL_DIR / "config.json").read_text())

TZ = timezone(timedelta(hours=8))  # Default GMT+8, override via config

# ─── Env ───

def load_env():
    env_file = Path.home() / ".openclaw" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

# ─── Phase 2: Role Memory ───

def get_role_memory(role_key: str) -> str:
    """Load past decisions for a role."""
    mem_file = SKILL_DIR / "memory" / "roles" / f"{role_key}.md"
    if not mem_file.exists():
        return ""
    content = mem_file.read_text().strip()
    # Keep last 2000 chars to avoid bloating prompts
    if len(content) > 2000:
        content = "...\n" + content[-2000:]
    return content

def save_role_memory(role_key: str, meeting_date: str, question: str, summary: str):
    """Append a role's decision summary to their memory."""
    mem_dir = SKILL_DIR / "memory" / "roles"
    mem_dir.mkdir(parents=True, exist_ok=True)
    mem_file = mem_dir / f"{role_key}.md"

    role = CONFIG["roles"][role_key]
    entry = f"\n\n## {meeting_date} — {question[:60]}\n{summary}\n"

    with open(mem_file, "a", encoding="utf-8") as f:
        f.write(entry)

# ─── Model Calls ───

def ask_gemini(question: str, system: str) -> str:
    full_q = f"{system}\n\n---\n\n{question}"
    try:
        result = subprocess.run(
            ["gemini", "-p", ""],
            input=full_q,
            capture_output=True, text=True, timeout=180
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return f"ERROR: {result.stderr.strip()}"
    except FileNotFoundError:
        return "ERROR: gemini CLI not found. Install: npm i -g @anthropic-ai/gemini-cli"
    except subprocess.TimeoutExpired:
        return "ERROR: Gemini timeout (180s)"

def ask_gpt(question: str, system: str, model: str = "gpt-4o") -> str:
    import urllib.request
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return "ERROR: OPENAI_API_KEY not set"
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
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
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"ERROR: {e}"

def ask_claude(question: str, system: str) -> str:
    """Claude roles are handled by the main agent — return placeholder."""
    return None

MODEL_FN = {
    "claude": ask_claude,
    "gemini": ask_gemini,
    "gpt": ask_gpt,
}

def call_role(role_key: str, question: str, extra_context: str = "") -> dict:
    """Call a single role's model with their prompt + memory + question."""
    role = CONFIG["roles"][role_key]
    model = role["model"]
    system = load_role_prompt(role_key)

    # Phase 2: inject role memory
    memory = get_role_memory(role_key)
    if memory:
        system += f"\n\n## 你過去的決策紀錄（保持一致性）\n{memory}"

    if extra_context:
        question = f"{extra_context}\n\n---\n\n{question}"

    fn = MODEL_FN[model]
    if model == "claude":
        return {"model": model, "prompt": system, "question": question, "response": None}
    elif model == "gpt":
        resp = fn(question, system, CONFIG["defaults"].get("gptModel", "gpt-4o"))
    else:
        resp = fn(question, system)

    return {"model": model, "response": resp}

def load_role_prompt(role_key: str) -> str:
    role = CONFIG["roles"][role_key]
    prompt_file = SKILL_DIR / role["promptFile"]
    if prompt_file.exists():
        return prompt_file.read_text().strip()
    return f"你是 {role['name']}（{role['title']}），請從你的專業角度分析以下議題。用繁體中文回答。"

# ─── Phase 1: Meeting ───

def run_round1(question: str, context: str, role_keys: list[str]) -> dict:
    """Round 1: Each role answers independently."""
    full_q = question
    if context:
        full_q = f"## 背景\n{context}\n\n## 議題\n{question}"
    full_q += "\n\n請從你的專業角度分析這個議題，提出：\n1. 你的核心觀點\n2. 機會或風險\n3. 具體建議\n4. 需要其他部門配合的事項"

    results = {}
    external = {}

    for rk in role_keys:
        role = CONFIG["roles"][rk]
        if role["model"] == "claude":
            results[rk] = call_role(rk, full_q)
        else:
            external[rk] = full_q

    # Parallel external calls
    if external:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futures = {rk: ex.submit(call_role, rk, q) for rk, q in external.items()}
            for rk, fut in futures.items():
                results[rk] = fut.result()

    return results

# ─── Phase 3: Debate ───

def run_debate(question: str, context: str, round1: dict, role_keys: list[str]) -> dict:
    """Round 2: Roles read others' opinions and rebut."""
    # Build summary of round 1
    others_text = ""
    for rk in role_keys:
        role = CONFIG["roles"][rk]
        r = round1[rk]
        resp = r.get("response") or "(待 Claude 補完)"
        others_text += f"\n### {role['emoji']} {role['name']}（{role['title']}）\n{resp}\n"

    debate_results = {}
    external = {}

    for rk in role_keys:
        role = CONFIG["roles"][rk]
        # Show others' views, ask for rebuttal
        debate_q = (
            f"## 其他角色的觀點\n{others_text}\n\n"
            f"## 你的任務\n"
            f"你是 {role['name']}（{role['title']}）。閱讀以上其他角色的觀點後：\n"
            f"1. 你同意哪些觀點？為什麼？\n"
            f"2. 你反對或質疑哪些觀點？為什麼？\n"
            f"3. 有沒有大家都忽略的盲點？\n"
            f"4. 修正後的最終建議\n\n"
            f"直接切入重點，不要重複你第一輪已經說過的。"
        )

        if role["model"] == "claude":
            debate_results[rk] = call_role(rk, debate_q)
        else:
            external[rk] = debate_q

    if external:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futures = {rk: ex.submit(call_role, rk, q) for rk, q in external.items()}
            for rk, fut in futures.items():
                debate_results[rk] = fut.result()

    return debate_results

# ─── Phase 4: Archive ───

def archive_meeting(question: str, context: str, role_keys: list[str],
                    round1: dict, debate: dict | None, now: datetime) -> Path:
    """Save full meeting record."""
    meetings_dir = SKILL_DIR / "meetings"
    meetings_dir.mkdir(exist_ok=True)

    date_str = now.strftime("%Y-%m-%d")
    slug = re.sub(r'[^\w\u4e00-\u9fff]', '-', question[:30]).strip('-')
    filename = f"{date_str}-{slug}.md"
    filepath = meetings_dir / filename

    lines = [
        f"# 🏢 策略會議紀錄",
        f"",
        f"- **日期：** {now.strftime('%Y-%m-%d %H:%M')}",
        f"- **議題：** {question}",
    ]
    if context:
        lines.append(f"- **背景：** {context}")
    lines.append(f"- **與會者：** {', '.join(CONFIG['roles'][rk]['emoji'] + ' ' + CONFIG['roles'][rk]['name'] for rk in role_keys)}")
    lines.append(f"- **模式：** {'對話模式' if debate else '單輪模式'}")
    lines.append("")

    # Round 1
    lines.append("---\n## 第一輪：各自發言\n")
    for rk in role_keys:
        role = CONFIG["roles"][rk]
        r = round1[rk]
        lines.append(f"### {role['emoji']} {role['name']}（{role['title']}）— {role['model'].upper()}\n")
        resp = r.get("response") or "(由 Claude 主 agent 補完)"
        lines.append(resp)
        lines.append("\n---\n")

    # Round 2 (debate)
    if debate:
        lines.append("## 第二輪：反駁與補充\n")
        for rk in role_keys:
            role = CONFIG["roles"][rk]
            r = debate[rk]
            lines.append(f"### {role['emoji']} {role['name']}（{role['title']}）反駁\n")
            resp = r.get("response") or "(由 Claude 主 agent 補完)"
            lines.append(resp)
            lines.append("\n---\n")

    lines.append("\n## 📋 CEO 彙整\n\n> (由 Claude 主 agent 彙整)\n")

    filepath.write_text("\n".join(lines), encoding="utf-8")
    return filepath

def save_all_role_memories(round1: dict, debate: dict | None, question: str, now: datetime):
    """Phase 2: Save each role's key points to their memory file."""
    date_str = now.strftime("%Y-%m-%d")
    for rk, r in round1.items():
        resp = r.get("response")
        if resp:
            # Extract first 300 chars as summary
            summary = resp[:300].split("\n\n")[0] if resp else "(no response)"
            save_role_memory(rk, date_str, question, summary)

# ─── Output ───

def format_output(question: str, context: str, round1: dict, debate: dict | None,
                  role_keys: list[str], archive_path: Path | None) -> str:
    sections = []
    sections.append(f"# 🏢 策略會議結果\n")
    sections.append(f"**議題：** {question}")
    if context:
        sections.append(f"**背景：** {context}")
    sections.append(f"**與會者：** {', '.join(CONFIG['roles'][rk]['emoji'] + ' ' + CONFIG['roles'][rk]['name'] for rk in role_keys)}")
    if debate:
        sections.append("**模式：** 對話模式（含反駁輪）")
    sections.append("")

    # Round 1
    sections.append("## 📢 第一輪：各自發言\n")
    claude_pending = []
    for rk in role_keys:
        role = CONFIG["roles"][rk]
        r = round1[rk]
        sections.append(f"### {role['emoji']} {role['name']}（{role['title']}）— {role['model'].upper()}\n")
        if r.get("response") is None:
            claude_pending.append(("round1", rk))
            sections.append(f"> ⏳ 待 Claude 以 {role['name']} 角色回答")
        else:
            sections.append(r["response"])
        sections.append("\n---\n")

    # Round 2 (debate)
    if debate:
        sections.append("## 🔥 第二輪：反駁與補充\n")
        for rk in role_keys:
            role = CONFIG["roles"][rk]
            r = debate[rk]
            sections.append(f"### {role['emoji']} {role['name']}（{role['title']}）反駁\n")
            if r.get("response") is None:
                claude_pending.append(("debate", rk))
                sections.append(f"> ⏳ 待 Claude 以 {role['name']} 角色反駁")
            else:
                sections.append(r["response"])
            sections.append("\n---\n")

    # Instructions for Claude main agent
    if claude_pending:
        sections.append("## 📋 Claude 待處理\n")
        for phase, rk in claude_pending:
            role = CONFIG["roles"][rk]
            phase_label = "發言" if phase == "round1" else "反駁"
            sections.append(f"- {role['emoji']} **{role['name']}** — {phase_label}")
        sections.append("")
        sections.append("> Claude 主 agent 請依序以上述角色身分回答，然後以 CEO 身分彙整所有觀點。")
    else:
        sections.append("## 📋 待 CEO 彙整\n")
        sections.append("> 請以 CEO 身分讀取以上所有觀點，產出：")
        sections.append("> 1. 共識點  2. 分歧點  3. 整合建議  4. 行動項目")

    if archive_path:
        sections.append(f"\n📁 會議紀錄已歸檔：`{archive_path.relative_to(SKILL_DIR)}`")

    return "\n".join(sections)

# ─── Main ───

def main():
    parser = argparse.ArgumentParser(description="策略會議 — Strategy Meeting")
    parser.add_argument("--question", "-q", required=True, help="議題")
    parser.add_argument("--context", "-c", default="", help="背景資料")
    parser.add_argument("--roles", "-r", default="cto,cmo,cfo",
                        help="角色（逗號分隔）或 'all'")
    parser.add_argument("--debate", "-d", action="store_true",
                        help="Phase 3: 啟用角色間反駁對話")
    parser.add_argument("--no-archive", action="store_true",
                        help="不歸檔會議紀錄")
    parser.add_argument("--no-memory", action="store_true",
                        help="不更新角色記憶")
    parser.add_argument("--output", "-o", default="", help="輸出檔案路徑")
    args = parser.parse_args()

    load_env()
    now = datetime.now(TZ)

    # Parse roles
    if args.roles == "all":
        role_keys = [k for k in CONFIG["roles"] if k != "ceo"]
    else:
        role_keys = [r.strip() for r in args.roles.split(",")]

    for rk in role_keys:
        if rk not in CONFIG["roles"]:
            print(f"ERROR: Unknown role '{rk}'. Available: {list(CONFIG['roles'].keys())}", file=sys.stderr)
            sys.exit(1)

    print(f"🏢 策略會議開始", file=sys.stderr)
    print(f"📋 議題：{args.question[:80]}", file=sys.stderr)
    print(f"👥 與會者：{', '.join(role_keys)}", file=sys.stderr)
    if args.debate:
        print(f"🔥 對話模式：啟用", file=sys.stderr)
    print(f"⏳ 第一輪諮詢中...", file=sys.stderr)

    # Phase 1: Round 1
    round1 = run_round1(args.question, args.context, role_keys)

    # Phase 3: Debate (optional)
    debate = None
    if args.debate:
        print(f"🔥 第二輪反駁中...", file=sys.stderr)
        debate = run_debate(args.question, args.context, round1, role_keys)

    # Phase 4: Archive
    archive_path = None
    if not args.no_archive:
        archive_path = archive_meeting(args.question, args.context, role_keys,
                                       round1, debate, now)
        print(f"📁 歸檔：{archive_path}", file=sys.stderr)

    # Phase 2: Save role memories
    if not args.no_memory:
        save_all_role_memories(round1, debate, args.question, now)

    # Output
    output = format_output(args.question, args.context, round1, debate,
                           role_keys, archive_path)

    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"✅ 結果已寫入 {args.output}", file=sys.stderr)
    else:
        print(output)

    print("✅ 策略會議結束", file=sys.stderr)

if __name__ == "__main__":
    main()
