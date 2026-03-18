"""
PDF text extraction using PyMuPDF (fitz).
Extracts text page by page with optional header/footer cleaning.
Falls back to OCR (tesseract) for scanned/image-based PDFs.
"""

import io
import re

import fitz  # PyMuPDF

try:
    import pytesseract
    from PIL import Image
    HAS_OCR = True
except ImportError:
    HAS_OCR = False

# Minimum characters to consider a page as having real text
_MIN_TEXT_CHARS = 30


def _ocr_page(page: fitz.Page) -> str:
    """Render a page to image and run OCR via tesseract."""
    if not HAS_OCR:
        return ""
    pix = page.get_pixmap(dpi=300)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    text = pytesseract.image_to_string(img, lang="eng")
    return text


def is_scanned_pdf(file_path: str) -> bool:
    """Check if a PDF is scanned (image-based) by sampling first pages."""
    doc = fitz.open(file_path)
    sample_size = min(5, len(doc))
    native_chars = 0
    for i in range(sample_size):
        native_chars += len(doc.load_page(i).get_text("text").strip())
    doc.close()
    return (native_chars / max(sample_size, 1)) < _MIN_TEXT_CHARS


def get_total_pages(file_path: str) -> int:
    """Return total page count of a PDF."""
    doc = fitz.open(file_path)
    count = len(doc)
    doc.close()
    return count


def extract_text_by_page(file_path: str, max_pages: int = 0) -> list[dict]:
    """
    Extract text from a PDF file, returning content for each page.
    If native text extraction yields little/no text, falls back to OCR.

    Args:
        file_path: Path to the PDF file.
        max_pages: If > 0, only extract up to this many pages. 0 = all pages.

    Returns:
        List of dicts with keys: page_number (1-based), content (cleaned text).
    """
    doc = fitz.open(file_path)

    # Sample first few pages to decide if OCR is needed
    sample_size = min(5, len(doc))
    native_chars = 0
    for i in range(sample_size):
        native_chars += len(doc.load_page(i).get_text("text").strip())
    use_ocr = HAS_OCR and (native_chars / max(sample_size, 1)) < _MIN_TEXT_CHARS

    page_count = len(doc)
    if max_pages > 0:
        page_count = min(max_pages, page_count)

    pages = []
    for page_num in range(page_count):
        page = doc.load_page(page_num)
        raw_text = page.get_text("text")

        if len(raw_text.strip()) < _MIN_TEXT_CHARS and use_ocr:
            raw_text = _ocr_page(page)

        cleaned = _clean_page_text(raw_text)
        if cleaned.strip():
            pages.append({
                "page_number": page_num + 1,
                "content": cleaned,
            })

    doc.close()
    return pages


def _clean_page_text(text: str) -> str:
    """
    Clean extracted page text by removing common header/footer patterns.

    Removes:
      - Standalone page numbers (lines that are just digits)
      - Repeated header/footer lines (common patterns)
      - Excessive whitespace
    """
    lines = text.split("\n")
    cleaned_lines = []

    for line in lines:
        stripped = line.strip()

        # Skip lines that are just a page number
        if re.match(r"^\d{1,4}$", stripped):
            continue

        # Skip common header/footer patterns like "Page X of Y"
        if re.match(r"^[Pp]age\s+\d+\s+(of|/)\s+\d+$", stripped):
            continue

        # Skip lines that are just dashes or underscores (separators)
        if re.match(r"^[-_=]{3,}$", stripped):
            continue

        cleaned_lines.append(line)

    # Join and normalize whitespace
    result = "\n".join(cleaned_lines)

    # Collapse runs of 3+ newlines into 2
    result = re.sub(r"\n{3,}", "\n\n", result)

    return result.strip()
