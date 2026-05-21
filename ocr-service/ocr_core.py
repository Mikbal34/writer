"""
Surya-based OCR core for scanned PDFs (hard scripts: Arabic, Persian, …).

Two problems this module solves, both measured on real classical-Arabic
scans before being written:

1. Quality — Tesseract produces garbage on connected, diacritic-heavy RTL
   scripts. Surya matches Gemini-gold quality there. (Latin scripts stay on
   Tesseract upstream; they never reach this service.)

2. Reading order — most scanned classical books are TWO-PAGE SPREADS (a book
   opening photographed as one landscape image). Any line-sorter that orders
   by vertical position interleaves the right and left page. We split the
   spread down the middle and OCR RIGHT page first, then LEFT (Arabic RTL),
   then concatenate back into ONE text block per PDF page — so the chunk's
   pageNumber still maps to the PDF page the viewer renders.

Predictors are lazy singletons: loaded once on first request (~1.3 GB model),
reused for the life of the process. Pin transformers==4.56.1 — surya 0.17.1
breaks on transformers 5.x ('SuryaDecoderConfig has no pad_token_id').
"""

from __future__ import annotations

import io
import threading
from dataclasses import dataclass

import pypdfium2 as pdfium
from PIL import Image

# Landscape ratio above which a page is treated as a 2-page spread.
SPREAD_RATIO = 1.15
DEFAULT_DPI = 200

_lock = threading.Lock()
_predictors = None  # (foundation, recognition, detection, ocr_task)


def _get_predictors():
    """Load Surya predictors once, lazily. Thread-safe."""
    global _predictors
    if _predictors is not None:
        return _predictors
    with _lock:
        if _predictors is not None:
            return _predictors
        from surya.foundation import FoundationPredictor
        from surya.recognition import RecognitionPredictor
        from surya.detection import DetectionPredictor

        try:
            from surya.common.surya.schema import TaskNames
            ocr_task = TaskNames.ocr_with_boxes
        except Exception:
            ocr_task = "ocr_with_boxes"

        foundation = FoundationPredictor()
        recognition = RecognitionPredictor(foundation)
        detection = DetectionPredictor()
        _predictors = (foundation, recognition, detection, ocr_task)
    return _predictors


def split_spread(img: Image.Image, ratio_threshold: float = SPREAD_RATIO) -> list[Image.Image]:
    """A landscape image is a 2-page spread → [right, left] (Arabic RTL,
    right page is read first). Otherwise a single page → [img]."""
    w, h = img.size
    if w <= h * ratio_threshold:
        return [img]
    mid = w // 2
    right = img.crop((mid, 0, w, h))
    left = img.crop((0, 0, mid, h))
    return [right, left]


def render_pdf(pdf_bytes: bytes, dpi: int = DEFAULT_DPI) -> list[Image.Image]:
    """Render every PDF page to a PIL RGB image via pdfium (no system deps)."""
    scale = dpi / 72.0
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        out = []
        for i in range(len(doc)):
            page = doc[i]
            bitmap = page.render(scale=scale)
            out.append(bitmap.to_pil().convert("RGB"))
        return out
    finally:
        doc.close()


@dataclass
class PageText:
    page_number: int  # 1-based PDF page index (matches the viewer)
    text: str


def _ocr_images(images: list[Image.Image]) -> list[str]:
    """Batched Surya OCR. Returns one joined-lines string per input image."""
    if not images:
        return []
    _, recognition, detection, ocr_task = _get_predictors()
    preds = recognition(
        images,
        task_names=[ocr_task] * len(images),
        det_predictor=detection,
    )
    return ["\n".join(line.text for line in p.text_lines) for p in preds]


def ocr_pdf(pdf_bytes: bytes, dpi: int = DEFAULT_DPI) -> list[PageText]:
    """Full pipeline: render → spread-split → batched OCR → regroup.

    One PageText per PDF page; spreads have right+left concatenated (right
    first) so page_number stays aligned with the rendered PDF page.
    """
    page_images = render_pdf(pdf_bytes, dpi=dpi)

    # Flatten all half-pages into one batch (efficient on GPU), remembering
    # how many halves each PDF page contributed so we can regroup.
    flat: list[Image.Image] = []
    counts: list[int] = []
    for img in page_images:
        halves = split_spread(img)
        counts.append(len(halves))
        flat.extend(halves)

    texts = _ocr_images(flat)

    pages: list[PageText] = []
    idx = 0
    for page_no, n in enumerate(counts, start=1):
        parts = texts[idx : idx + n]
        idx += n
        pages.append(PageText(page_number=page_no, text="\n".join(parts).strip()))
    return pages
