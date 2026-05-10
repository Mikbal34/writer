"""
EPUB text + metadata extraction.

EPUBs have no native concept of "page" — they're a zip of HTML
documents, one per chapter (or sub-section). We treat each XHTML
document inside the spine as one "page" so the chunker downstream
keeps working unchanged. The pageNumber field thus becomes a
chapter / section index from the reader's perspective.

Dublin Core metadata (title / creator / date / publisher / description
/ language) is also exposed via ebooklib's `book.get_metadata` API —
extracting it lets the Node side skip Haiku entirely for the common
case where the publisher has filled the EPUB's OPF correctly.
"""

from __future__ import annotations

import os
import re
import tempfile

from bs4 import BeautifulSoup
import ebooklib
from ebooklib import epub


def _read_epub_from_bytes(file_bytes: bytes):
    """ebooklib's read_epub doesn't accept BytesIO in current releases;
    it shells out to `os.stat`, which requires a real path. Use a
    NamedTemporaryFile so callers can stay byte-oriented."""
    with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name
    try:
        # ignore_ncx silences a deprecation warning and matches what
        # ebooklib 1.x will do by default.
        return epub.read_epub(tmp_path, options={"ignore_ncx": True})
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _clean_html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    # Strip script/style etc.
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    # Collapse multi-blanks
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    return "\n".join(lines)


def extract_epub_pages(file_bytes: bytes) -> list[dict]:
    """Return [{ page_number, content }] — one entry per spine document.
    page_number is the reading-order index (1-based)."""
    book = _read_epub_from_bytes(file_bytes)
    pages: list[dict] = []
    page_number = 0
    for item in book.get_items():
        if item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        try:
            html = item.get_content().decode("utf-8", errors="ignore")
        except Exception:
            continue
        text = _clean_html_to_text(html)
        if not text.strip():
            continue
        page_number += 1
        pages.append({"page_number": page_number, "content": text})
    return pages


def get_epub_total_pages(file_bytes: bytes) -> int:
    """Counts non-empty spine documents — what the reader would see as
    chapters / sections."""
    return len(extract_epub_pages(file_bytes))


def _first_dc(book, key: str) -> str | None:
    """Pull the first Dublin Core value for a given key, or None."""
    try:
        items = book.get_metadata("DC", key) or []
    except Exception:
        return None
    if not items:
        return None
    first = items[0]
    # ebooklib returns tuples like (value, attrs_dict). Stringify the
    # value and trim defensively.
    if isinstance(first, tuple) and first:
        value = first[0]
    else:
        value = first
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def extract_epub_metadata(file_bytes: bytes) -> dict:
    """Dublin Core fields the publisher filled into the EPUB's OPF.
    All keys are optional — missing → field omitted."""
    book = _read_epub_from_bytes(file_bytes)
    out: dict = {}

    title = _first_dc(book, "title")
    if title:
        out["title"] = title

    creator = _first_dc(book, "creator")
    if creator:
        out["author"] = creator

    date = _first_dc(book, "date")
    if date:
        # OPF dates are usually ISO ("2019-03-15"), so the first 4
        # chars are the year. Strip otherwise.
        m = re.match(r"(\d{4})", date)
        if m:
            out["year"] = m.group(1)

    description = _first_dc(book, "description")
    if description:
        # ebooklib sometimes returns HTML in <description>.
        out["abstract"] = _clean_html_to_text(description)

    publisher = _first_dc(book, "publisher")
    if publisher:
        out["publisher"] = publisher

    language = _first_dc(book, "language")
    if language:
        out["language"] = language

    return out
