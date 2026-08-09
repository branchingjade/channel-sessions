"""精确核对插件 className 全部存在于 Hermes 编译 CSS（防止再引入缺失类）。"""
import re

CSS = r"C:\Users\HMSJ\AppData\Local\hermes\hermes-agent\apps\desktop\dist\assets\index-Cdw-L9Ns.css"
PLUGIN = r"C:\Users\HMSJ\AppData\Local\hermes\desktop-plugins\channel-sessions\plugin.js"

css = open(CSS, encoding="utf-8", errors="replace").read()
src = open(PLUGIN, encoding="utf-8").read()

classes = set()
for m in re.finditer(r"className:\s*'([^']+)'", src):
    for part in m.group(1).split():
        if not part.startswith("'"):
            classes.add(part)


def in_css(c):
    """精确匹配：类主体（去变体前缀）以 .escaped 形式出现。"""
    body = c.split(":")[-1]  # hover:bg-x → bg-x；group-hover:x → x
    # Tailwind 产物转义: [ → \[ , . → \. , ( → \( , / → \/（开头点除外）
    esc = (
        body.replace("\\", "\\\\")
        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("(", "\\(")
        .replace(")", "\\)")
        .replace("/", "\\/")
        .replace(".", "\\.")
        .replace(":", "\\:")
    )
    return ("." + esc) in css


missing = sorted(c for c in classes if not in_css(c))
print(f"总类片段: {len(classes)}, 缺失: {len(missing)}")
for c in missing:
    print("  MISSING:", c)
if not missing:
    print("✅ 所有类均在 Hermes 编译 CSS 中")
