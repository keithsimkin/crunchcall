from pathlib import Path

path = Path(r"C:\TREA\meatola\src\ui\SettingsScreen.tsx")
text = path.read_text(encoding="utf-8")
start = text.index("function Models(")
end = text.index("function Machine(")
new = Path(r"C:\TREA\meatola\_models_chunk.tsx").read_text(encoding="utf-8")
if not new.endswith("\n\n"):
    new = new.rstrip() + "\n\n"
path.write_text(text[:start] + new + text[end:], encoding="utf-8")
print(f"replaced {end - start} chars with {len(new)}")
