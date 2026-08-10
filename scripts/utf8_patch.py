#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UTF-8 safe text-file helpers for Windows / PowerShell workflows.

Why this exists
---------------
On Windows, PowerShell here-strings / consoles often corrupt non-ASCII
(especially Chinese) when embedding patch content in the shell itself.
Always:
  1. Keep Chinese (and any non-ASCII) **inside a .py file saved as UTF-8**, or
  2. Pass paths / ASCII-only anchors from the shell and let this module
     read/write the target file with encoding="utf-8".

Never rely on PowerShell `"??"` / here-strings as the source of truth
for file contents.

Typical agent / CI usage
------------------------
    python scripts/utf8_patch.py replace path/to/file.rs \\
        --old-file old.txt --new-file new.txt

    python scripts/utf8_patch.py write path/to/out.ts --file content.ts

    python -c "from scripts.utf8_patch import replace_once; ..."
    # prefer: run a sibling *.py script that imports this module

Line endings
------------
Default is to **preserve** the file's existing newline style (\\n vs \\r\\n).
Pass --newline lf|crlf|keep (default keep) only when you intentionally
normalize. Do not mass-convert the repo.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable, Literal, Sequence

NewlineMode = Literal["keep", "lf", "crlf"]

__all__ = [
    "read_text",
    "write_text",
    "detect_newline",
    "apply_newline",
    "replace_once",
    "replace_all",
    "insert_after",
    "insert_before",
    "require_contains",
    "require_not_contains",
    "patch_file",
]


def read_text(path: str | Path) -> str:
    """Read a text file as UTF-8 (no locale guessing)."""
    return Path(path).read_text(encoding="utf-8")


def detect_newline(text: str) -> str:
    """Return the dominant newline sequence in *text*."""
    # Prefer CRLF if present so Windows files stay Windows files.
    if "\r\n" in text:
        return "\r\n"
    if "\n" in text:
        return "\n"
    return "\n"


def apply_newline(text: str, mode: NewlineMode, sample: str | None = None) -> str:
    """Normalize or preserve newlines.

    *keep* uses *sample* (usually the original file contents) to pick
    \\n vs \\r\\n. Content is first normalized to \\n, then re-expanded.
    """
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if mode == "lf":
        return normalized
    if mode == "crlf":
        return normalized.replace("\n", "\r\n")
    # keep
    nl = detect_newline(sample if sample is not None else text)
    if nl == "\n":
        return normalized
    return normalized.replace("\n", nl)


def write_text(
    path: str | Path,
    content: str,
    *,
    newline: NewlineMode = "keep",
    original: str | None = None,
    create_parents: bool = False,
) -> Path:
    """Write UTF-8 text, optionally preserving prior newline style.

    If *newline* is ``keep`` and the file already exists, existing newline
    style is preserved unless *original* is provided (then that sample is
    used). New files default to LF.
    """
    p = Path(path)
    if create_parents:
        p.parent.mkdir(parents=True, exist_ok=True)

    sample = original
    if sample is None and newline == "keep" and p.exists():
        sample = read_text(p)

    payload = apply_newline(content, newline, sample)
    # newline="" disables universal-newline translation on write.
    p.write_text(payload, encoding="utf-8", newline="")
    return p


def require_contains(text: str, snippet: str, *, label: str = "anchor") -> None:
    if snippet not in text:
        raise SystemExit(
            f"[utf8_patch] missing {label}: {snippet[:120]!r} "
            f"(len={len(snippet)})"
        )


def require_not_contains(text: str, snippet: str, *, label: str = "forbidden") -> None:
    if snippet in text:
        raise SystemExit(
            f"[utf8_patch] unexpectedly found {label}: {snippet[:120]!r}"
        )


def replace_once(
    path: str | Path,
    old: str,
    new: str,
    *,
    newline: NewlineMode = "keep",
    label: str | None = None,
) -> str:
    """Replace exactly one occurrence of *old* with *new*. Abort otherwise."""
    p = Path(path)
    text = read_text(p)
    count = text.count(old)
    tag = label or "replace_once"
    if count == 0:
        raise SystemExit(f"[utf8_patch] {tag}: old snippet not found in {p}")
    if count > 1:
        raise SystemExit(
            f"[utf8_patch] {tag}: old snippet found {count} times in {p}; "
            "use replace_all or tighten the anchor"
        )
    updated = text.replace(old, new, 1)
    write_text(p, updated, newline=newline, original=text)
    return updated


def replace_all(
    path: str | Path,
    old: str,
    new: str,
    *,
    newline: NewlineMode = "keep",
    expected_min: int = 1,
    label: str | None = None,
) -> tuple[str, int]:
    """Replace all occurrences. Requires at least *expected_min* hits."""
    p = Path(path)
    text = read_text(p)
    count = text.count(old)
    tag = label or "replace_all"
    if count < expected_min:
        raise SystemExit(
            f"[utf8_patch] {tag}: found {count} hits in {p}, "
            f"expected >= {expected_min}"
        )
    updated = text.replace(old, new)
    write_text(p, updated, newline=newline, original=text)
    return updated, count


def insert_after(
    path: str | Path,
    anchor: str,
    insertion: str,
    *,
    newline: NewlineMode = "keep",
    label: str | None = None,
) -> str:
    """Insert *insertion* immediately after the first *anchor* match."""
    p = Path(path)
    text = read_text(p)
    tag = label or "insert_after"
    require_contains(text, anchor, label=tag)
    idx = text.find(anchor)
    at = idx + len(anchor)
    updated = text[:at] + insertion + text[at:]
    write_text(p, updated, newline=newline, original=text)
    return updated


def insert_before(
    path: str | Path,
    anchor: str,
    insertion: str,
    *,
    newline: NewlineMode = "keep",
    label: str | None = None,
) -> str:
    """Insert *insertion* immediately before the first *anchor* match."""
    p = Path(path)
    text = read_text(p)
    tag = label or "insert_before"
    require_contains(text, anchor, label=tag)
    idx = text.find(anchor)
    updated = text[:idx] + insertion + text[idx:]
    write_text(p, updated, newline=newline, original=text)
    return updated


def patch_file(
    path: str | Path,
    mutator,
    *,
    newline: NewlineMode = "keep",
    label: str | None = None,
) -> str:
    """Read UTF-8 text, run ``mutator(text) -> new_text``, write back."""
    p = Path(path)
    text = read_text(p)
    updated = mutator(text)
    if not isinstance(updated, str):
        raise SystemExit(
            f"[utf8_patch] {label or 'patch_file'}: mutator must return str"
        )
    if updated == text:
        print(f"[utf8_patch] {label or p}: no change")
        return text
    write_text(p, updated, newline=newline, original=text)
    print(f"[utf8_patch] {label or p}: updated")
    return updated


def _read_arg_text(value: str | None, file: str | None, *, name: str) -> str:
    if file:
        return read_text(file)
    if value is not None:
        return value
    raise SystemExit(f"[utf8_patch] provide --{name} or --{name}-file")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="utf8_patch",
        description=(
            "UTF-8 safe file patch helpers. Prefer putting non-ASCII content "
            "in UTF-8 files, not in PowerShell strings."
        ),
    )
    parser.add_argument(
        "--newline",
        choices=["keep", "lf", "crlf"],
        default="keep",
        help="newline policy (default: keep existing style)",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_read = sub.add_parser("read", help="print file as UTF-8")
    p_read.add_argument("path")

    p_write = sub.add_parser("write", help="write UTF-8 file from --text/--file")
    p_write.add_argument("path")
    p_write.add_argument("--text")
    p_write.add_argument("--file", dest="file_")
    p_write.add_argument("--create-parents", action="store_true")

    p_rep = sub.add_parser("replace", help="replace exactly one snippet")
    p_rep.add_argument("path")
    p_rep.add_argument("--old")
    p_rep.add_argument("--old-file")
    p_rep.add_argument("--new")
    p_rep.add_argument("--new-file")
    p_rep.add_argument("--all", action="store_true", help="replace all hits")
    p_rep.add_argument("--label", default=None)

    p_ins = sub.add_parser("insert-after", help="insert after anchor")
    p_ins.add_argument("path")
    p_ins.add_argument("--anchor")
    p_ins.add_argument("--anchor-file")
    p_ins.add_argument("--text")
    p_ins.add_argument("--file", dest="file_")
    p_ins.add_argument("--label", default=None)

    p_inb = sub.add_parser("insert-before", help="insert before anchor")
    p_inb.add_argument("path")
    p_inb.add_argument("--anchor")
    p_inb.add_argument("--anchor-file")
    p_inb.add_argument("--text")
    p_inb.add_argument("--file", dest="file_")
    p_inb.add_argument("--label", default=None)

    p_has = sub.add_parser("contains", help="exit 0 if snippet exists")
    p_has.add_argument("path")
    p_has.add_argument("--snippet")
    p_has.add_argument("--snippet-file")
    p_has.add_argument("--invert", action="store_true")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    # Force UTF-8 stdio when possible (Windows cp936 consoles).
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass

    parser = _build_parser()
    args = parser.parse_args(argv)
    nl: NewlineMode = args.newline

    if args.cmd == "read":
        sys.stdout.write(read_text(args.path))
        return 0

    if args.cmd == "write":
        content = _read_arg_text(args.text, args.file_, name="text")
        write_text(
            args.path,
            content,
            newline=nl,
            create_parents=args.create_parents,
        )
        print(f"[utf8_patch] wrote {args.path}")
        return 0

    if args.cmd == "replace":
        old = _read_arg_text(args.old, args.old_file, name="old")
        new = _read_arg_text(args.new, args.new_file, name="new")
        if args.all:
            _, count = replace_all(
                args.path, old, new, newline=nl, label=args.label
            )
            print(f"[utf8_patch] replaced {count} hit(s) in {args.path}")
        else:
            replace_once(args.path, old, new, newline=nl, label=args.label)
            print(f"[utf8_patch] replaced 1 hit in {args.path}")
        return 0

    if args.cmd in ("insert-after", "insert-before"):
        anchor = _read_arg_text(args.anchor, args.anchor_file, name="anchor")
        insertion = _read_arg_text(args.text, args.file_, name="text")
        if args.cmd == "insert-after":
            insert_after(
                args.path, anchor, insertion, newline=nl, label=args.label
            )
        else:
            insert_before(
                args.path, anchor, insertion, newline=nl, label=args.label
            )
        print(f"[utf8_patch] {args.cmd} ok: {args.path}")
        return 0

    if args.cmd == "contains":
        snippet = _read_arg_text(args.snippet, args.snippet_file, name="snippet")
        text = read_text(args.path)
        found = snippet in text
        ok = (not found) if args.invert else found
        print(
            f"[utf8_patch] contains={found} path={args.path} ok={ok}"
        )
        return 0 if ok else 1

    parser.error(f"unknown cmd: {args.cmd}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
