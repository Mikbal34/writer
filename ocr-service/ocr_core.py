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

import gc
import io
import threading
from dataclasses import dataclass

import pypdfium2 as pdfium
from PIL import Image

# Landscape ratio above which a page is treated as a 2-page spread.
SPREAD_RATIO = 1.15
DEFAULT_DPI = 200
# Cap the longest rendered side. Most scans are ~1300 px at 200 DPI; a few
# cover/foldout pages are scanned at 5000+ px (35 MP), whose bitmap spikes
# memory and crashes OCR. Clamp those down — normal pages are unaffected.
MAX_RENDER_PX = 2200


def _free_memory() -> None:
    """Release Python + GPU memory between page slices so OCR'ing a
    2000-page book doesn't accumulate allocations into an OOM."""
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass

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


# How many PDF pages to render+OCR at a time. Bounds peak memory: rendering
# a whole 1000+ page book at once OOMs the container, so we work in slices
# and let each slice's bitmaps be freed before the next.
PAGE_BATCH = 24


def ocr_pdf(pdf_bytes: bytes, dpi: int = DEFAULT_DPI) -> list[PageText]:
    """Full pipeline: render → spread-split → batched OCR → regroup, in
    page slices so memory stays bounded regardless of book size.

    One PageText per PDF page; spreads have right+left concatenated (right
    first) so page_number stays aligned with the rendered PDF page.
    """
    scale = dpi / 72.0
    doc = pdfium.PdfDocument(pdf_bytes)
    try:
        total = len(doc)
        pages: list[PageText] = []
        for start in range(0, total, PAGE_BATCH):
            end = min(start + PAGE_BATCH, total)
            # Render this slice, split spreads, remember halves-per-page.
            flat: list[Image.Image] = []
            counts: list[int] = []
            for i in range(start, end):
                page = doc[i]
                w_pt, h_pt = page.get_size()
                # Clamp scale so the longest side stays under MAX_RENDER_PX —
                # protects against the occasional 5000+ px scanned page.
                page_scale = min(scale, MAX_RENDER_PX / max(w_pt, h_pt))
                bitmap = page.render(scale=page_scale)
                halves = split_spread(bitmap.to_pil().convert("RGB"))
                counts.append(len(halves))
                flat.extend(halves)

            texts = _ocr_images(flat)

            idx = 0
            for offset, n in enumerate(counts):
                parts = texts[idx : idx + n]
                idx += n
                pages.append(
                    PageText(page_number=start + offset + 1, text="\n".join(parts).strip())
                )
            # Free this slice's bitmaps + GPU tensors before the next slice
            # so a 2000-page book doesn't accumulate into an OOM.
            del flat, texts
            _free_memory()
        return pages
    finally:
        doc.close()
