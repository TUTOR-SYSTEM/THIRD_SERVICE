#!/usr/bin/env python3
"""UserPromptSubmit hook: nếu prompt của người dùng yêu cầu rõ ràng git push
thì ghi cờ cho đúng prompt này; guard.py đọc cờ để cho phép. Mỗi prompt ghi đè cờ cũ
(không có yêu cầu => xoá cờ => mặc định chặn lại)."""
import json, os, re, sys, tempfile

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

prompt = (data.get("prompt") or "").lower()
sid = re.sub(r"[^\w-]", "", data.get("session_id") or "nosession")
flag = os.path.join(tempfile.gettempdir(), f"claude-git-allow-{sid}.json")

# Bỏ qua khi bị phủ định ngay trước từ khoá: "đừng commit", "không push", "don't commit"...
NEG = r"(?<!đừng )(?<!không )(?<!chưa )(?<!khỏi )(?<!don't )(?<!do not )(?<!never )(?<!without )"
def asked(pattern):
    return re.search(NEG + pattern, prompt) is not None

allowed = set()
if asked(r"\b(commit|git commit)\b"):
    allowed |= {"add", "commit"}
if asked(r"\b(push|git push)\b|đẩy (code|lên)"):
    allowed.add("push")
if asked(r"\bgit add\b|\bstage\b"):
    allowed.add("add")

if allowed:
    with open(flag, "w") as f:
        json.dump(sorted(allowed), f)
else:
    try:
        os.remove(flag)
    except FileNotFoundError:
        pass
sys.exit(0)
