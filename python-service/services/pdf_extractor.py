"""
PDF text extraction using PyMuPDF (fitz), with pypdf fallback for PDFs that
PyMuPDF chokes on (malformed xref tables, unusual encoders, etc.).
Extracts text page by page with optional header/footer cleaning.
Falls back to OCR (tesseract) for scanned/image-based PDFs.

OCR is parallelized across CPU cores via ProcessPoolExecutor — Arabic
classical works regularly need 30+ s per page in tesseract, so serial
processing of a 500-page book hits the Node→Python fetch timeout long
before extraction completes. Splitting the work across workers keeps
the whole book under the 10-min HTTP budget for any reasonable size.
"""

import io
import os
import re
from concurrent.futures import BrokenExecutor, ProcessPoolExecutor

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


# Languages tesseract attempts in one pass. Multi-language costs ~30% on
# CPU but is necessary because academic PDFs in this app routinely mix
# Latin scripts with Turkish diacritics or Arabic transliteration.
_OCR_LANGS = "eng+tur+ara"

# Cap parallelism so we don't OOM Railway. Each worker holds one
# 300-DPI page bitmap (≈30-60 MB for a typical academic page) plus a
# tesseract process. The default 2 fit comfortably on a small Railway
# plan; bump via OCR_WORKERS when the host has more headroom. We saw a
# 4-worker pool OOM on a 37 MB Arabic book — 2 is the safer floor.
_OCR_WORKERS = max(1, int(os.environ.get("OCR_WORKERS", "2")))


def _ocr_page_at_path(args: tuple[str, int]) -> tuple[int, str]:
    """Worker for ProcessPoolExecutor — opens the doc, renders one page,
    runs OCR. Module-level so it's picklable across processes."""
    file_path, page_num = args
    try:
        doc = fitz.open(file_path)
        try:
            page = doc.load_page(page_num)
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            try:
                text = pytesseract.image_to_string(img, lang=_OCR_LANGS)
            except pytesseract.TesseractError:
                # Missing traineddata for one of the languages — fall
                # back to English-only rather than dropping the page.
                text = pytesseract.image_to_string(img, lang="eng")
            return (page_num, text)
        finally:
            doc.close()
    except Exception:
        return (page_num, "")


def _parallel_ocr(file_path: str, page_nums: list[int]) -> dict[int, str]:
    """OCR many pages in parallel; returns {page_num: text}.

    Falls back to serial OCR if the worker pool dies mid-flight (the
    common cause is a single OOM page taking down a worker, which
    surfaces as BrokenProcessPool). Serial is slow but always finishes.
    """
    if not page_nums or not HAS_OCR:
        return {}
    workers = min(len(page_nums), _OCR_WORKERS)
    results: dict[int, str] = {}
    try:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            for page_num, text in executor.map(
                _ocr_page_at_path,
                [(file_path, p) for p in page_nums],
            ):
                results[page_num] = text
        return results
    except BrokenExecutor:
        # Pool exploded — fall back to serial so the whole extraction
        # isn't lost. Anything we already collected stays in results.
        pass

    remaining = [p for p in page_nums if p not in results]
    for page_num in remaining:
        _, text = _ocr_page_at_path((file_path, page_num))
        results[page_num] = text
    return results


def _ocr_page(page: fitz.Page) -> str:
    """Render a single page to image and run OCR — kept for callers that
    still hold a fitz.Page open (notably the existing single-page
    fallback paths). Prefer `_parallel_ocr` for bulk extraction."""
    if not HAS_OCR:
        return ""
    pix = page.get_pixmap(dpi=300)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    try:
        return pytesseract.image_to_string(img, lang=_OCR_LANGS)
    except pytesseract.TesseractError:
        return pytesseract.image_to_string(img, lang="eng")


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
            # pypdf fallback doesn't surface printed page labels; the
            # downstream chunker treats page_label=None as "use the
            # PDF index". Only a small minority of corpora hit this
            # path so the precision loss is acceptable.
            pages.append({"page_number": i + 1, "page_label": None, "content": cleaned})
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

    Two-pass strategy: PyMuPDF over every page to grab native text fast,
    then a single parallel-OCR pass for the pages whose native text fell
    below MIN_TEXT_CHARS. This decouples the cheap step from the expensive
    one and lets the OCR pool saturate multiple cores instead of running
    page-by-page in lockstep.

    Falls back to pypdf for PDFs PyMuPDF can't open or that explode mid-
    document.
    """
    # Primary path: PyMuPDF.
    try:
        doc = fitz.open(file_path)
    except Exception:
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

        # Pass 1: native text for every page.
        native_texts: dict[int, str] = {}
        mupdf_errors = 0
        for page_num in range(page_count):
            try:
                raw_text = doc.load_page(page_num).get_text("text") or ""
                native_texts[page_num] = raw_text
            except Exception:
                mupdf_errors += 1
                native_texts[page_num] = ""

        # Pass 2: parallel OCR the pages that came back too thin to be real
        # text. Only kicks in when the sample already flagged the doc as
        # OCR-needing — pure native-text PDFs skip this entirely.
        ocr_texts: dict[int, str] = {}
        if use_ocr:
            pages_to_ocr = [
                p for p, text in native_texts.items()
                if len(text.strip()) < _MIN_TEXT_CHARS
            ]
            if pages_to_ocr:
                ocr_texts = _parallel_ocr(file_path, pages_to_ocr)

        # Pull printed-page labels (the "49" the book shows even when
        # the PDF index is 64 because of front matter). PyMuPDF exposes
        # them via doc.get_page_labels() when the PDF /PageLabels tree
        # is present; many academic PDFs include this. Falls back to
        # None per-page when missing or when the index is out of range,
        # and the downstream chunker uses pageNumber in that case.
        page_labels: list[str | None] = []
        try:
            raw_labels = doc.get_page_labels()
            # PyMuPDF returns either a list of strings (one per page)
            # or a list of label dict structs depending on version. We
            # only care about per-page label strings, so handle both.
            if isinstance(raw_labels, list):
                for entry in raw_labels:
                    if isinstance(entry, str):
                        page_labels.append(entry or None)
                    else:
                        # Unsupported shape — abandon labels rather than
                        # half-fill; chunker will drop back to pageNumber.
                        page_labels = []
                        break
        except Exception:
            page_labels = []

        # Stitch + clean.
        pages: list[dict] = []
        for page_num in range(page_count):
            raw_text = ocr_texts.get(page_num) or native_texts.get(page_num, "")
            cleaned = _clean_page_text(raw_text)
            if cleaned.strip():
                label = (
                    page_labels[page_num]
                    if 0 <= page_num < len(page_labels)
                    else None
                )
                pages.append({
                    "page_number": page_num + 1,
                    "page_label": label,
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
