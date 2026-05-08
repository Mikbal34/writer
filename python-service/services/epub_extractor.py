"""
EPUB text extraction.

EPUBs have no native concept of "page" — they're a zip of HTML
documents, one per chapter (or sub-section). We treat each XHTML
document inside the spine as one "page" so the chunker downstream
keeps working unchanged. The pageNumber field thus becomes a
chapter / section index from the reader's perspective.
"""

from __future__ import annotations

import io

from bs4 import BeautifulSoup
import ebooklib
from ebooklib import epub


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
    book = epub.read_epub(io.BytesIO(file_bytes))
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
