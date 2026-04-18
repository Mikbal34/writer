"""
PDF text extraction using PyMuPDF (fitz), with pypdf fallback for PDFs that
PyMuPDF chokes on (malformed xref tables, unusual encoders, etc.).
Extracts text page by page with optional header/footer cleaning.
Falls back to OCR (tesseract) for scanned/image-based PDFs.
"""

import io
import re

import fitz  # PyMuPDF

try:
    import pypdf  # fallback parser
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

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


def _pypdf_page_count(file_path: str) -> int:
    if not HAS_PYPDF:
        return 0
    reader = pypdf.PdfReader(file_path, strict=False)
    return len(reader.pages)


def _pypdf_extract_pages(file_path: str, max_pages: int = 0) -> list[dict]:
    """Fallback extractor using pypdf — slower and lower fidelity than
    PyMuPDF but handles some malformed PDFs PyMuPDF rejects."""
    if not HAS_PYPDF:
        return []
    reader = pypdf.PdfReader(file_path, strict=False)
    total = len(reader.pages)
    if max_pages > 0:
        total = min(max_pages, total)
    pages: list[dict] = []
    for i in range(total):
        try:
            raw = reader.pages[i].extract_text() or ""
        except Exception:
            raw = ""
        cleaned = _clean_page_text(raw)
        if cleaned.strip():
            pages.append({"page_number": i + 1, "content": cleaned})
    return pages


def is_scanned_pdf(file_path: str) -> bool:
    """Check if a PDF is scanned (image-based) by sampling first pages.
    Returns False if PDF cannot be opened with PyMuPDF (caller will retry via pypdf)."""
    try:
        doc = fitz.open(file_path)
    except Exception:
        return False
    try:
        sample_size = min(5, len(doc))
        native_chars = 0
        for i in range(sample_size):
            native_chars += len(doc.load_page(i).get_text("text").strip())
        return (native_chars / max(sample_size, 1)) < _MIN_TEXT_CHARS
    finally:
        doc.close()


def get_total_pages(file_path: str) -> int:
    """Return total page count of a PDF, trying PyMuPDF first then pypdf."""
    try:
        doc = fitz.open(file_path)
        try:
            return len(doc)
        finally:
            doc.close()
    except Exception:
        return _pypdf_page_count(file_path)


def extract_text_by_page(file_path: str, max_pages: int = 0) -> list[dict]:
    """
    Extract text from a PDF file, returning content for each page.
    Tries PyMuPDF first; on failure or if a page throws, falls back to pypdf.
    If native text extraction yields little/no text, falls back to OCR.
    """
    # Primary path: PyMuPDF.
    try:
        doc = fitz.open(file_path)
    except Exception:
        # PyMuPDF can't even open this PDF — go straight to pypdf.
        return _pypdf_extract_pages(file_path, max_pages)

    try:
        sample_size = min(5, len(doc))
        native_chars = 0
        for i in range(sample_size):
            try:
                native_chars += len(doc.load_page(i).get_text("text").strip())
            except Exception:
                pass
        use_ocr = HAS_OCR and (native_chars / max(sample_size, 1)) < _MIN_TEXT_CHARS

        page_count = len(doc)
        if max_pages > 0:
            page_count = min(max_pages, page_count)

        pages: list[dict] = []
        mupdf_errors = 0
        for page_num in range(page_count):
            try:
                page = doc.load_page(page_num)
                raw_text = page.get_text("text") or ""
                if len(raw_text.strip()) < _MIN_TEXT_CHARS and use_ocr:
                    raw_text = _ocr_page(page)
            except Exception:
                mupdf_errors += 1
                continue

            cleaned = _clean_page_text(raw_text)
            if cleaned.strip():
                pages.append({
                    "page_number": page_num + 1,
                    "content": cleaned,
                })

        # If PyMuPDF returned nothing or choked on most pages, retry with pypdf.
        if not pages or mupdf_errors > page_count // 2:
            fallback = _pypdf_extract_pages(file_path, max_pages)
            if fallback:
                return fallback

        return pages
    finally:
        doc.close()


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
