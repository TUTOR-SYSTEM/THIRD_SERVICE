#!/usr/bin/env python3
"""PreToolUse hook: chặn các lệnh git add / commit / push; hỏi trước khi sửa file env."""
import json, os, re, shlex, sys

data = json.load(sys.stdin)
tool = data.get("tool_name", "")
inp = data.get("tool_input", {}) or {}

def out(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason}}))
    sys.exit(0)

ENV_FILE = re.compile(r"(^|/)\.env(\.[^/\s]*)?$|(^|/)[^/\s]*\.env$")

BLOCKED_GIT_SUBCOMMANDS = {"add", "commit", "push"}
# Tùy chọn global của git nhận thêm một tham số rời (vd `git -C <dir> commit`).
GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}

def blocked_git_subcommand(cmd, depth=0):
    """Trả về subcommand bị chặn (add/commit/push) nếu lệnh gọi git như vậy, ngược lại None."""
    if depth > 3:
        return None
    try:
        lexer = shlex.shlex(cmd, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        toks = list(lexer)
    except ValueError:
        toks = cmd.split()

    for i, tok in enumerate(toks):
        # Chuỗi truyền cho shell qua `-c` (vd `bash -c 'git commit'`) — kiểm tra đệ quy.
        if i > 0 and toks[i - 1] in ("-c", "-lc") and re.search(r"\bgit\b", tok):
            sub = blocked_git_subcommand(tok, depth + 1)
            if sub:
                return sub
            continue
        if tok != "git" and not tok.endswith("/git"):
            continue
        j = i + 1
        while j < len(toks) and toks[j].startswith("-"):
            opt = toks[j]
            j += 1
            if opt in GIT_OPTS_WITH_ARG:
                j += 1
        if j < len(toks) and toks[j] in BLOCKED_GIT_SUBCOMMANDS:
            return toks[j]
    return None

if tool == "Bash":
    cmd = inp.get("command", "")
    sub = blocked_git_subcommand(cmd)
    if sub:
        out("deny", f"Lệnh git {sub} bị chặn bởi hook (.claude/hooks/guard.py).")
    if re.search(r"(^|[\s/='\"])\.env(\.\w+)*(\s|$|['\"])|\S+\.env(\s|$|['\"])", cmd):
        out("ask", "Lệnh này động tới file env — cần bạn xác nhận.")

elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
    path = inp.get("file_path") or inp.get("notebook_path") or ""
    if ENV_FILE.search(path):
        out("ask", f"Sửa file env ({os.path.basename(path)}) — cần bạn xác nhận.")

sys.exit(0)
