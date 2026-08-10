#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TEMPLATE: UTF-8 safe one-shot patch script (Windows / PowerShell friendly)

Copy this file, e.g.:
    scripts/_task_translate_logs.py

Fill in PATCHES / WRITES below. Run:
    python scripts/_task_translate_logs.py

Rules
-----
1. This .py file MUST be saved as UTF-8 (with Chinese text inside the file).
2. Do NOT generate Chinese via PowerShell here-strings.
3. Prefer ASCII-only *anchors* that uniquely locate the edit site; put the
   full old/new blocks (including Chinese) in this file.
4. Default newline policy is "keep" ? do not mass-convert CRLF/LF.
5. Abort if an anchor matches 0 or >1 times (replace_once).
6. Delete the one-shot script after the task if it was temporary.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow `python scripts/foo.py` to import scripts/utf8_patch.py
ROOT = Path(__file__).resolve().parents[1]  # repo root if placed in scripts/
# If you keep this template under scripts/templates/, parents[2] is repo root:
if (Path(__file__).resolve().parent.name == "templates"):
    ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(ROOT / "scripts"))
else:
    ROOT = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(ROOT / "scripts"))

from utf8_patch import (  # noqa: E402
    patch_file,
    read_text,
    replace_once,
    write_text,
)

# ---------------------------------------------------------------------------
# Declare edits here. Paths are relative to repo root unless absolute.
# ---------------------------------------------------------------------------

# Exact one-occurrence replacements: (relpath, old, new, label)
PATCHES: list[tuple[str, str, str, str]] = [
    # (
    #     "src-tauri/src/core/example.rs",
    #     'logging!(info, Type::Core, "Starting core");',
    #     'logging!(info, Type::Core, "??????");',
    #     "core-start-log",
    # ),
]

# Full file writes: (relpath, content)
WRITES: list[tuple[str, str]] = [
    # (
    #     "src/utils/example.ts",
    #     "export const hello = '??'\\n",
    # ),
]


def run() -> None:
    for rel, old, new, label in PATCHES:
        path = ROOT / rel
        replace_once(path, old, new, label=label)
        print(f"OK replace: {label} -> {rel}")

    for rel, content in WRITES:
        path = ROOT / rel
        # preserve newline style if file exists
        original = read_text(path) if path.exists() else None
        write_text(path, content, original=original, create_parents=True)
        print(f"OK write: {rel}")

    # Complex multi-step example (uncomment / adapt):
    # def mutator(text: str) -> str:
    #     if "??????" in text:
    #         return text
    #     return text.replace("FOO", "??FOO", 1)
    # patch_file(ROOT / "src/foo.ts", mutator, label="foo")

    print("All UTF-8 patches applied.")


if __name__ == "__main__":
    try:
        # Stable UTF-8 stdio on Windows
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass
        run()
    except SystemExit as e:
        raise
    except Exception as e:
        print(f"FAILED: {e}", file=sys.stderr)
        raise SystemExit(1)
