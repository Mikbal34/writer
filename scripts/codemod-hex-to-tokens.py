#!/usr/bin/env python3
"""
One-shot codemod: replace Tailwind arbitrary-value hex literals with the
design-token classes that landed in Step 1.

Only rewrites class forms `bg-[#xxx]`, `text-[#xxx]`, etc. — inline
`style={{ color: "#xxx" }}` literals and ENTRY_TYPE_COLORS style objects
are left alone since they're JS, not Tailwind classes.

Run from the repo root.
"""

import re
import sys
import pathlib

# Canonical color → token. Group near-duplicates (e.g. F5EDE0 / FAF7F0)
# under the closest semantic token. Slight perceptual drift accepted —
# Step 1's oklch values are within a few percentage points anyway.
MAPPINGS = {
    # surfaces (warm parchment → page)
    "FAF7F0": "page",
    "faf7f0": "page",
    "FAF3E3": "page",
    "F5EDE0": "page",
    "F5EFE0": "page",
    "F5F0E6": "page",
    "f5f0e8": "page",
    # darker parchments → rail/panel/sandy-soft
    "F0E8D8": "rail",
    "F0E8D6": "rail",
    "e8dfd0": "sandy-soft",
    "e8e0d4": "sandy-soft",
    # brand gold
    "C9A84C": "gold",
    "c9a84c": "gold",
    "b5943d": "gold-dark",
    "8a5a1a": "gold-dark",
    "8a7540": "gold-dark",
    "d4b85a": "gold-hover",
    "FFEB3B": "gold",
    # forest
    "2C5F2E": "forest",
    "2D8B4E": "forest-light",
    # ink — every dark brown collapses to ink/ink-light/ink-muted
    "2D1F0E": "ink",
    "1A0F05": "ink",
    "1a0f05": "ink",
    "3C2415": "ink",
    "8a7a65": "ink-light",
    "5C4A32": "ink-light",
    "6b5a45": "ink-light",
    "a89a82": "ink-muted",
    "a89880": "ink-muted",
    # sandy
    "d4c9b5": "sandy",
    "c9bfad": "sandy",
    # destructive-ish (rare)
    "c44": "destructive",
    "8a4a4a": "destructive",
}

PREFIXES = "|".join([
    "bg", "text", "border", "from", "via", "to",
    "ring", "outline", "shadow", "fill", "stroke",
    "caret", "decoration", "placeholder", "accent", "divide",
])
HEX_RE = re.compile(rf"\b({PREFIXES})-\[#([a-fA-F0-9]+)\]")


def rewrite(text: str) -> tuple[str, int, list[str]]:
    """Return (new_text, replacements, leftover_hex_list)."""
    n = 0
    leftovers: set[str] = set()

    def repl(m: re.Match[str]) -> str:
        nonlocal n
        prefix, hex_val = m.group(1), m.group(2)
        token = MAPPINGS.get(hex_val)
        if token:
            n += 1
            return f"{prefix}-{token}"
        leftovers.add(hex_val)
        return m.group(0)

    new_text = HEX_RE.sub(repl, text)
    return new_text, n, sorted(leftovers)


def main():
    root = pathlib.Path("src")
    if not root.exists():
        print("run me from the repo root", file=sys.stderr)
        sys.exit(1)

    total = 0
    file_count = 0
    leftover_aggregate: set[str] = set()
    for p in list(root.rglob("*.tsx")) + list(root.rglob("*.ts")):
        original = p.read_text(encoding="utf-8")
        new, n, leftovers = rewrite(original)
        leftover_aggregate.update(leftovers)
        if new != original:
            p.write_text(new, encoding="utf-8")
            print(f"  {p}: {n} replacements")
            total += n
            file_count += 1

    print(f"\n{total} replacements across {file_count} files")
    if leftover_aggregate:
        print(f"\nLeftover hex literals (not in mapping — hand-review):")
        for hex_val in sorted(leftover_aggregate):
            print(f"  #{hex_val}")


if __name__ == "__main__":
    main()
