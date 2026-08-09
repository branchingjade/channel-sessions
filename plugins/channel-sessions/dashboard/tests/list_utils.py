"""列出编译 CSS 中可用的 w-* 和 max-w-* 类（避开转义噪音）。"""
import re

css = open(r"C:\Users\HMSJ\AppData\Local\hermes\hermes-agent\apps\desktop\dist\assets\index-Cdw-L9Ns.css", encoding="utf-8", errors="replace").read()

ws = set(re.findall(r"\.w-([a-zA-Z0-9\-]+)\{", css))
mws = set(re.findall(r"\.max-w-([a-zA-Z0-9\-]+)\{", css))
print("w- 可用:", sorted(ws))
print("max-w- 可用:", sorted(mws))
