#!/usr/bin/env python3
"""PreToolUse hook — chính sách git + bảo vệ file env.

Git (Bash), mỗi lệnh `git ...` được phân loại:
  deny  : add / commit / push — chặn mặc định, chỉ chạy khi prompt của người dùng yêu cầu (git-allow.py)
  ask   : lệnh phá huỷ / ghi đè lịch sử / đổi working tree khó hoàn tác — luôn hỏi xác nhận
  allow : lệnh chỉ đọc — tự cho phép (chỉ khi cả câu lệnh toàn là git chỉ đọc, không redirect)
  (khác): để luồng quyền mặc định của Claude Code xử lý
Env: Bash đụng tới .env* hoặc Edit/Write file env => hỏi.
"""
import json, os, re, shlex, sys, tempfile

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

GATED = {"add", "commit", "push"}                      # deny trừ khi prompt yêu cầu
READONLY = {"status", "diff", "log", "show", "blame", "grep", "ls-files", "ls-tree",
            "rev-parse", "rev-list", "describe", "shortlog", "cat-file", "diff-tree",
            "show-ref", "name-rev", "merge-base", "for-each-ref", "count-objects",
            "check-ignore", "fetch", "version", "help", "whatchanged", "diff-index",
            "diff-files", "range-diff", "ls-remote", "show-branch", "verify-commit"}
ALWAYS_ASK = {"rebase", "merge", "cherry-pick", "revert", "pull", "am", "filter-branch",
              "filter-repo", "prune", "rm", "send-email", "request-pull", "replace", "bisect"}
GIT_OPTS_WITH_ARG = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
SEPARATORS = set("();|&")

def user_allowed():
    sid = re.sub(r"[^\w-]", "", data.get("session_id") or "nosession")
    try:
        with open(os.path.join(tempfile.gettempdir(), f"claude-git-allow-{sid}.json")) as f:
            return set(json.load(f))
    except Exception:
        return set()

def has(args, *flags):
    return any(a in flags or any(a.startswith(f + "=") for f in flags if f.startswith("--")) for a in args)

def classify(sub, args, allowed):
    """Trả về (decision, reason) với decision ∈ deny/ask/allow/None."""
    if sub in GATED:
        if sub not in allowed:
            return "deny", (f"git {sub} bị chặn mặc định. Chỉ chạy khi bạn yêu cầu rõ trong prompt "
                            f"(vd: 'commit', 'push', 'git add').")
        if sub == "commit" and has(args, "--amend"):
            return "ask", "git commit --amend viết lại commit trước đó — cần xác nhận."
        if sub in ("commit", "push") and has(args, "--no-verify", "-n") and sub == "push" or \
           sub == "commit" and has(args, "--no-verify"):
            return "ask", f"git {sub} --no-verify bỏ qua hook — cần xác nhận."
        if sub == "push" and (has(args, "-f", "--force", "--force-with-lease", "--force-if-includes",
                                   "--delete", "-d", "--mirror") or any(a[:1] in "+:" and len(a) > 1 for a in args)):
            return "ask", "git push --force/--delete/--mirror ghi đè hoặc xoá trên remote — cần xác nhận."
        return None, ""
    if sub in READONLY:
        return "allow", ""
    if sub in ALWAYS_ASK:
        return "ask", f"git {sub} đổi lịch sử/working tree — cần xác nhận."
    a0 = args[0] if args else ""
    if sub == "reset":
        if has(args, "--hard", "--merge", "--keep"):
            return "ask", "git reset --hard mất thay đổi chưa commit — cần xác nhận."
    elif sub == "clean":
        if not has(args, "-n", "--dry-run"):
            return "ask", "git clean xoá file untracked — cần xác nhận."
        return "allow", ""
    elif sub == "restore":
        if not (has(args, "--staged") and not has(args, "--worktree", "-W")):
            return "ask", "git restore ghi đè file trong working tree — cần xác nhận."
    elif sub in ("checkout", "switch"):
        if has(args, "--", "-f", "--force", "-B", "-C", "--discard-changes", ".") :
            return "ask", f"git {sub} có thể bỏ thay đổi chưa commit — cần xác nhận."
    elif sub == "branch":
        if has(args, "-D", "-d", "--delete", "-M", "-m", "-f", "--force", "--move"):
            return "ask", "git branch xoá/đổi tên/ghi đè nhánh — cần xác nhận."
        safe = {"-a", "-r", "-v", "-vv", "--list", "-l", "--show-current", "--all", "--remotes"}
        if all(x in safe or x.startswith(("--merged", "--no-merged", "--contains", "--sort", "--format")) for x in args):
            return "allow", ""
    elif sub == "tag":
        if has(args, "-d", "--delete"):
            return "ask", "git tag -d xoá tag — cần xác nhận."
        if not args or a0 in ("-l", "--list", "-n"):
            return "allow", ""
    elif sub == "stash":
        if a0 in ("drop", "clear"):
            return "ask", f"git stash {a0} xoá stash — cần xác nhận."
        if a0 in ("list", "show"):
            return "allow", ""
    elif sub == "remote":
        if a0 in ("remove", "rm", "set-url", "rename", "prune"):
            return "ask", f"git remote {a0} đổi cấu hình remote — cần xác nhận."
        if not args or a0 in ("-v", "show", "get-url"):
            return "allow", ""
    elif sub == "config":
        if has(args, "--global", "--system") and not has(args, "--get", "--get-all", "--list", "-l"):
            return "ask", "git config --global/--system đổi cấu hình toàn máy — cần xác nhận."
        if has(args, "--get", "--get-all", "--list", "-l", "--show-origin"):
            return "allow", ""
    elif sub == "worktree":
        if a0 in ("remove", "prune"):
            return "ask", f"git worktree {a0} — cần xác nhận."
        if a0 == "list":
            return "allow", ""
    elif sub == "reflog":
        if a0 in ("expire", "delete"):
            return "ask", f"git reflog {a0} xoá lịch sử — cần xác nhận."
        return "allow", ""
    elif sub == "gc":
        if has(args, "--prune=now", "--aggressive"):
            return "ask", "git gc --prune xoá object — cần xác nhận."
    elif sub == "update-ref":
        if has(args, "-d"):
            return "ask", "git update-ref -d xoá ref — cần xác nhận."
    elif sub == "submodule":
        if a0 in ("status", "summary"):
            return "allow", ""
        return "ask", "git submodule đổi submodule — cần xác nhận."
    return None, ""

def analyze(cmd, allowed, depth=0):
    """Trả về (danh sách (decision, reason) của từng lệnh git, chỉ_git_và_an_toàn)."""
    if depth > 3:
        return [], False
    try:
        lexer = shlex.shlex(cmd, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        toks = list(lexer)
    except ValueError:
        toks = cmd.split()

    results, only_git, i = [], True, 0
    # tách thành các segment theo toán tử ; && || | &
    segs, cur = [], []
    for t in toks:
        if t and set(t) <= SEPARATORS:
            segs.append(cur); cur = []
        else:
            cur.append(t)
    segs.append(cur)

    for seg in segs:
        if not seg:
            continue
        # bỏ qua gán biến môi trường đầu segment
        k = 0
        while k < len(seg) and re.match(r"^[A-Za-z_]\w*=", seg[k]):
            k += 1
        head = seg[k:]
        # `bash -c '<cmd>'` / `sh -lc` — phân tích đệ quy
        for idx, tok in enumerate(seg):
            if idx > 0 and seg[idx - 1] in ("-c", "-lc") and re.search(r"\bgit\b", tok):
                sub_res, _ = analyze(tok, allowed, depth + 1)
                results += sub_res
        if not head or not (head[0] == "git" or head[0].endswith("/git")):
            only_git = False
            continue
        if any(set(t) & set("<>") and set(t) <= set("<>&0123456789") for t in head):
            only_git = False           # có redirect => không auto-allow
        j = 1
        while j < len(head) and head[j].startswith("-"):
            opt = head[j]; j += 1
            if opt in GIT_OPTS_WITH_ARG:
                j += 1
        if j >= len(head):
            only_git = False
            continue
        results.append(classify(head[j], head[j + 1:], allowed))
    return results, only_git

if tool == "Bash":
    cmd = inp.get("command", "")
    results, only_git = analyze(cmd, user_allowed())
    for want in ("deny", "ask"):
        for d, why in results:
            if d == want:
                out(d, why + " (.claude/hooks/guard.py)")
    if re.search(r"(^|[\s/='\"])\.env(\.\w+)*(\s|$|['\"])|\S+\.env(\s|$|['\"])", cmd):
        out("ask", "Lệnh này động tới file env — cần bạn xác nhận.")
    if results and only_git and all(d == "allow" for d, _ in results):
        out("allow", "Lệnh git chỉ đọc.")

elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
    path = inp.get("file_path") or inp.get("notebook_path") or ""
    if ENV_FILE.search(path):
        out("ask", f"Sửa file env ({os.path.basename(path)}) — cần bạn xác nhận.")

sys.exit(0)
