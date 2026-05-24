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
import urllib.request
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
# Tesseract -l strings, chosen per detected script. Tesseract allows
# multi-lang ("-l eng+deu+fra+..."); each language model is loaded once
# and the engine picks per-character, so one pass handles a mixed
# European corpus without re-running. Ordering puts English first as a
# weak prior since most academic books carry some English.
#
# CORE vs EXTENDED — every extra language model Tesseract loads adds
# linear cost to per-page recognition (each model contributes word
# features, scored every page). 26-lang Latin is ~2-3× slower than the
# 8-lang core. Strategy:
#   • Pass 1: CORE on every page (fast)                   — 8 langs
#   • Pass 2: EXTENDED only on weak pages (per-page conf) — 26 langs
# CORE covers ~95% of academic corpora (en/de/fr/tr/it/es/pt/lat).
# Pass 2 catches Polish/Hungarian/Slavic outliers without paying the
# 26-lang cost on the whole document. Pages still below threshold after
# Pass 2 escalate to Surya via the existing conf+coverage signal.
_LATIN_LANGS_CORE = "eng+deu+fra+tur+ita+spa+por+lat"
_LATIN_LANGS_EXTENDED = (
    "eng+deu+fra+spa+ita+por+nld+cat+swe+dan+nor+fin+isl+pol+"
    "ces+slk+hun+ron+hrv+slv+lit+lav+est+sqi+lat+tur"
)
# Per-page conf threshold for escalating CORE → EXTENDED. Tuned same
# as the doc-level threshold below; can be relaxed via env if false
# positives waste cycles.
_PAGE_CONF_ESCALATE = float(os.environ.get("OCR_PAGE_ESCALATE_CONF", "55"))
# Back-compat alias — older callers and the single-page fallback path
# still reference _LATIN_LANGS; treat it as the extended set.
_LATIN_LANGS = _LATIN_LANGS_EXTENDED
_CYRILLIC_LANGS = "rus+ukr+bul+srp+mkd"
_GREEK_LANGS = "ell"
# Fallback for undetermined script — includes ara so an Arabic doc
# whose OSD failed isn't starved (Surya still carries it via the
# coverage net below).
_OCR_LANGS = _LATIN_LANGS_EXTENDED + "+ara"

# Worker count = min(cpu_count, 4). performance-4x has 4 vCPU so the
# pool can saturate the machine; smaller boxes fall back automatically.
# Each worker holds one 300-DPI page bitmap (~30-60 MB) plus a
# Tesseract process. With CORE 8-lang Tesseract (~400 MB per process)
# + BGE-M3 (~1.5 GB), 4 workers on 16 GB leaves ~10 GB headroom for
# concurrent OCR + embed requests without OOM. Override via OCR_WORKERS.
try:
    import multiprocessing as _mp
    _DEFAULT_OCR_WORKERS = min(4, max(1, (_mp.cpu_count() or 2)))
except Exception:
    _DEFAULT_OCR_WORKERS = 2
_OCR_WORKERS = max(1, int(os.environ.get("OCR_WORKERS", str(_DEFAULT_OCR_WORKERS))))

# ── Tiered OCR routing ───────────────────────────────────────────────
# Tesseract stays the primary engine for Latin scripts (the majority).
# Hard scripts — where Tesseract produces garbage — are routed to the
# Surya OCR service (GPU). All Surya use is GATED behind SURYA_OCR_URL:
# when unset (or on any failure) we transparently fall back to the
# existing Tesseract path, so no GPU == no behaviour change.
_SURYA_OCR_URL = os.environ.get("SURYA_OCR_URL", "").strip()
_SURYA_OCR_SECRET = os.environ.get("OCR_SERVICE_SECRET", "").strip()
# Latin bad-scan safety nets. Two signals together catch what
# confidence alone missed (the van-Ess failure: high conf on a tiny
# set of words while 90% of the page was lost):
#   * conf      — mean Tesseract word confidence over OCR'd pages
#   * coverage  — mean (extracted_chars / expected_chars_per_page)
# Either falling below its threshold escalates the whole doc to Surya.
_OCR_CONF_THRESHOLD = float(os.environ.get("OCR_CONF_THRESHOLD", "60"))
_OCR_MIN_COVERAGE = float(os.environ.get("OCR_MIN_COVERAGE", "0.30"))
_EXPECTED_CHARS_PER_PAGE = float(os.environ.get("OCR_EXPECTED_CHARS_PER_PAGE", "800"))
# Tesseract OSD script names we route to Surya instead of Tesseract.
_HARD_SCRIPTS = {"Arabic", "Hebrew", "Thaana", "Syriac"}
# Smart routing thresholds — Tesseract is the fast/free CPU path,
# Surya is the GPU path for hard/heavy work. Defaults:
#   • >120 pages → Surya (GPU faster than CPU at this size)
#   • >25 MB AND >=60 pages → Surya (dense scan, Tesseract slow)
# Both gated behind SURYA_OCR_URL.
_HEAVY_SCAN_PAGES = int(os.environ.get("OCR_HEAVY_PAGES", "120"))
_HEAVY_SCAN_MB = float(os.environ.get("OCR_HEAVY_MB", "25"))

# N-user spillover — bound local Tesseract concurrency to vCPU count
# so 10 simultaneous uploads don't thrash the CPU. When the local
# semaphore is exhausted, the NEXT scan request transparently routes
# to Surya regardless of size. Tesseract handles steady state; Modal
# absorbs bursts. This is the spillover pattern big systems use.
import threading
_LOCAL_OCR_LIMIT = int(os.environ.get("OCR_LOCAL_LIMIT", str(_DEFAULT_OCR_WORKERS)))
_LOCAL_OCR_SEMAPHORE = threading.Semaphore(_LOCAL_OCR_LIMIT)


def _is_heavy_scan(file_path: str, pages_to_ocr: list[int]) -> bool:
    """True when the document should skip Tesseract upfront: hard
    scripts already triggered separately, this catches Latin/Cyrillic/
    Greek scans that are big enough that GPU clearly beats CPU.
    Returns False only when Surya is unconfigured (dev fallback)."""
    if not _SURYA_OCR_URL:
        return False
    n = len(pages_to_ocr)
    if n > _HEAVY_SCAN_PAGES:
        return True
    try:
        size_mb = os.path.getsize(file_path) / 1_048_576
        if size_mb > _HEAVY_SCAN_MB and n >= 60:
            return True
    except OSError:
        pass
    return False


def _try_acquire_local_ocr_slot() -> bool:
    """Non-blocking attempt to grab a local Tesseract slot. Returns
    True if a slot was acquired (caller must call _release_local_ocr_slot
    when done); False if all slots are busy → caller should spill to Surya."""
    return _LOCAL_OCR_SEMAPHORE.acquire(blocking=False)


def _release_local_ocr_slot() -> None:
    _LOCAL_OCR_SEMAPHORE.release()
# OSD script → Tesseract -l string. Anything not listed falls back to
# the comprehensive _OCR_LANGS default; hard scripts skip Tesseract.
# Latin uses CORE here — extended set is reserved for the per-page
# escalation pass in extract_text_by_page().
_SCRIPT_LANGS = {
    "Latin": _LATIN_LANGS_CORE,
    "Cyrillic": _CYRILLIC_LANGS,
    "Greek": _GREEK_LANGS,
}


# Mean luminance threshold above which a rendered page is treated as
# essentially blank (white separator pages, scan inserts). Tuned conserv-
# atively at 248/255 — real text pages average 200-240 due to ink, so
# 248 only catches near-uniform white. Drop via env if false positives
# (very faint scans) appear.
_BLANK_LUMA_THRESHOLD = float(os.environ.get("OCR_BLANK_LUMA", "248"))


def _is_blank_page(file_path: str, page_num: int) -> bool:
    """Cheap blankness check via 75-DPI render + sub-sampled mean pixel
    value. Used to skip Tesseract on separator/blank pages in scanned
    books — typical academic scans have 5-10% blank pages and each
    saves ~5-10 s of OCR work. The 75-DPI render itself is ~50 ms so
    the trade is firmly net-positive whenever even one page is blank."""
    if not HAS_OCR:
        return False
    try:
        doc = fitz.open(file_path)
        try:
            pix = doc.load_page(page_num).get_pixmap(dpi=75)
            sample = pix.samples
            if not sample:
                return True
            # Sub-sample ~4 k bytes — enough to estimate mean luminance
            # without scanning the whole bitmap.
            step = max(1, len(sample) // 4096)
            subset = sample[::step]
            mean = sum(subset) / len(subset)
            return mean > _BLANK_LUMA_THRESHOLD
        finally:
            doc.close()
    except Exception:
        return False


def _sample_indices(page_count: int, sample: int) -> list[int]:
    """Evenly spaced page indices for script sampling (skip the cover)."""
    if page_count <= 0:
        return []
    sample = min(sample, page_count)
    if sample == 1:
        return [page_count // 2]
    step = max(1, page_count // (sample + 1))
    return [min(page_count - 1, step * (i + 1)) for i in range(sample)]


def _detect_script(file_path: str, page_count: int, sample: int = 3) -> str | None:
    """Dominant script across a few sampled pages via Tesseract OSD.
    Returns a script name ('Arabic', 'Latin', …) or None if undetermined
    (caller then treats the doc as Latin and stays on Tesseract)."""
    if not HAS_OCR:
        return None
    try:
        doc = fitz.open(file_path)
    except Exception:
        return None
    counts: dict[str, int] = {}
    try:
        for i in _sample_indices(page_count, sample):
            try:
                pix = doc.load_page(i).get_pixmap(dpi=200)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                osd = pytesseract.image_to_osd(
                    img, output_type=pytesseract.Output.DICT
                )
                script = osd.get("script")
                if script:
                    counts[script] = counts.get(script, 0) + 1
            except Exception:
                continue
    finally:
        doc.close()
    if not counts:
        return None
    return max(counts, key=counts.get)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Don't auto-follow redirects — Modal long-requests answer 303 while
    pending, and we must poll with a delay rather than chase the chain."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _ocr_via_surya(file_path: str) -> dict[int, str] | None:
    """POST the whole PDF to the Surya OCR service and return {page_index0:
    text}, or None when unconfigured / on any failure (caller falls back).

    Handles Modal's long-request protocol: a request over ~150 s returns a
    303 to a __modal_function_call_id URL that stays 303 while pending and
    becomes 200 with the result when done. We poll it manually.
    """
    if not _SURYA_OCR_URL:
        return None
    import json
    import time
    import urllib.error
    import urllib.request

    def _to_pages(payload: dict) -> dict[int, str]:
        out: dict[int, str] = {}
        for p in payload.get("pages", []):
            try:
                pn = int(p.get("page_number", 0))
            except (TypeError, ValueError):
                continue
            if pn >= 1:
                out[pn - 1] = p.get("text", "") or ""
        return out

    try:
        with open(file_path, "rb") as fh:
            data = fh.read()
        post_headers = {"Content-Type": "application/pdf"}
        poll_headers = {}
        if _SURYA_OCR_SECRET:
            post_headers["x-ocr-secret"] = _SURYA_OCR_SECRET
            poll_headers["x-ocr-secret"] = _SURYA_OCR_SECRET

        opener = urllib.request.build_opener(_NoRedirect)
        next_url: str | None = None  # None → do the POST; else poll this URL
        transient = 0  # retry budget for blips (Modal saturation / 5xx)
        for _ in range(4000):  # generous ceiling at 8 s/poll
            try:
                if next_url is None:
                    req = urllib.request.Request(
                        _SURYA_OCR_URL, data=data, method="POST", headers=post_headers
                    )
                else:
                    req = urllib.request.Request(
                        next_url, method="GET", headers=poll_headers
                    )
                with opener.open(req, timeout=10 * 60) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                return _to_pages(payload)
            except urllib.error.HTTPError as exc:
                if exc.code in (301, 302, 303, 307):
                    loc = exc.headers.get("Location")
                    if not loc:
                        return None
                    next_url = loc
                    time.sleep(8)
                    continue
                # 5xx / 429 → Modal briefly saturated; retry the SAME step
                # with backoff instead of failing the whole document.
                if exc.code in (429, 500, 502, 503) and transient < 8:
                    transient += 1
                    time.sleep(min(60, 5 * 2 ** transient))
                    continue
                raise
            except urllib.error.URLError:
                # Connection dropped (saturation) — retry with backoff.
                if transient < 8:
                    transient += 1
                    time.sleep(min(60, 5 * 2 ** transient))
                    continue
                raise
        return None
    except Exception as exc:
        print(f"[pdf_extractor] Surya OCR failed, falling back to tesseract: {exc}")
        return None


def _reconstruct_from_data(data: dict) -> tuple[str, float]:
    """Rebuild line-broken text + mean word confidence from Tesseract's
    image_to_data DICT output (one pass gives us both)."""
    lines: dict[tuple, list[str]] = {}
    confs: list[float] = []
    n = len(data.get("text", []))
    for i in range(n):
        word = data["text"][i]
        if not word or not word.strip():
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(word)
        try:
            cv = float(data["conf"][i])
        except (TypeError, ValueError, KeyError):
            cv = -1.0
        if cv >= 0:
            confs.append(cv)
    text = "\n".join(" ".join(ws) for _, ws in sorted(lines.items()))
    mean_conf = (sum(confs) / len(confs)) if confs else 0.0
    return text, mean_conf


def _ocr_page_conf_at_path(args: tuple[str, int, str]) -> tuple[int, str, float]:
    """ProcessPool worker: render one page, OCR with image_to_data so we
    get text AND a confidence score in a single Tesseract pass."""
    file_path, page_num, langs = args
    try:
        doc = fitz.open(file_path)
        try:
            page = doc.load_page(page_num)
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            try:
                data = pytesseract.image_to_data(
                    img, lang=langs, output_type=pytesseract.Output.DICT
                )
            except pytesseract.TesseractError:
                data = pytesseract.image_to_data(
                    img, lang="eng", output_type=pytesseract.Output.DICT
                )
            text, conf = _reconstruct_from_data(data)
            return (page_num, text, conf)
        finally:
            doc.close()
    except Exception:
        return (page_num, "", 0.0)


def _parallel_ocr_conf(
    file_path: str, page_nums: list[int], langs: str
) -> tuple[dict[int, str], float, dict[int, float]]:
    """Confidence-aware parallel OCR. Returns ({page_num: text}, mean_conf,
    {page_num: conf}). Per-page conf is what enables the CORE→EXTENDED
    escalation in extract_text_by_page (re-OCR only the weak pages)."""
    if not page_nums or not HAS_OCR:
        return {}, 100.0, {}
    workers = min(len(page_nums), _OCR_WORKERS)
    texts: dict[int, str] = {}
    page_confs: dict[int, float] = {}
    confs: list[float] = []
    args = [(file_path, p, langs) for p in page_nums]
    try:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            for page_num, text, conf in executor.map(_ocr_page_conf_at_path, args):
                texts[page_num] = text
                page_confs[page_num] = conf
                if text.strip():
                    confs.append(conf)
    except BrokenExecutor:
        for page_num in [p for p in page_nums if p not in texts]:
            _, text, conf = _ocr_page_conf_at_path((file_path, page_num, langs))
            texts[page_num] = text
            page_confs[page_num] = conf
            if text.strip():
                confs.append(conf)
    doc_conf = (sum(confs) / len(confs)) if confs else 0.0
    return texts, doc_conf, page_confs


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

        # Pass 2: OCR the pages that came back too thin to be real text.
        # Only kicks in when the sample already flagged the doc as OCR-
        # needing — pure native-text PDFs skip this entirely.
        #
        # Tiered routing (all Surya use gated behind SURYA_OCR_URL):
        #   • hard script (Arabic-family)    → Surya (whole doc, one call)
        #   • Latin / Cyrillic / Greek       → Tesseract with the
        #       script-matched -l string (e.g. 26-lang European set for
        #       Latin), then BOTH conf + coverage are checked.
        #       └─ low conf OR low coverage  → escalate whole doc to Surya
        #   • Surya unconfigured / failed    → Tesseract _OCR_LANGS default
        ocr_texts: dict[int, str] = {}
        if use_ocr:
            pages_to_ocr = [
                p for p, text in native_texts.items()
                if len(text.strip()) < _MIN_TEXT_CHARS
            ]
            # Pre-filter blank pages — 5-10% of typical academic scans
            # are separator/blank pages and each saves ~5-10 s of
            # Tesseract work. The 75-DPI check is ~50 ms per page so
            # the overhead is dwarfed by the savings on real scans.
            if pages_to_ocr:
                kept: list[int] = []
                blanks = 0
                for p in pages_to_ocr:
                    if _is_blank_page(file_path, p):
                        blanks += 1
                    else:
                        kept.append(p)
                if blanks:
                    print(
                        f"[pdf_extractor] skipped {blanks}/{len(pages_to_ocr)} "
                        f"blank pages from OCR"
                    )
                pages_to_ocr = kept
            if pages_to_ocr and not _SURYA_OCR_URL:
                # Surya not configured → original Tesseract path, unchanged.
                ocr_texts = _parallel_ocr(file_path, pages_to_ocr)
            elif pages_to_ocr:
                script = _detect_script(file_path, page_count)
                hard = script in _HARD_SCRIPTS
                heavy = _is_heavy_scan(file_path, pages_to_ocr)
                surya_text: dict[int, str] | None = None
                # Smart routing decision:
                #   1. Hard scripts (Arabic/Hebrew) → Surya (Tesseract bad)
                #   2. Heavy scans (>120 pages or >25MB+60p) → Surya (GPU)
                #   3. Local CPU at capacity → Surya (spillover, see
                #      _try_acquire_local_ocr_slot above)
                #   4. Everything else → Tesseract (fast, free, local)
                local_slot_acquired = False
                spill_reason = None
                if hard:
                    spill_reason = f"hard script ({script})"
                elif heavy:
                    try:
                        size_mb = os.path.getsize(file_path) / 1_048_576
                    except OSError:
                        size_mb = 0
                    spill_reason = f"heavy scan ({len(pages_to_ocr)} pages, {size_mb:.0f} MB)"
                else:
                    # Try to grab a local Tesseract slot. If at capacity,
                    # spill over to Surya so the request doesn't queue.
                    local_slot_acquired = _try_acquire_local_ocr_slot()
                    if not local_slot_acquired:
                        spill_reason = f"local OCR capacity full ({_LOCAL_OCR_LIMIT} slots in use)"

                if spill_reason:
                    print(f"[pdf_extractor] scan → Surya GPU ({spill_reason})")
                    surya_text = _ocr_via_surya(file_path)
                    if surya_text is None:
                        print("[pdf_extractor] Surya failed → falling back to Tesseract")
                        # Couldn't reach Surya, fall through to local
                        # Tesseract path. Grab a slot if we don't have
                        # one (blocking is OK as last resort).
                        if not local_slot_acquired:
                            _LOCAL_OCR_SEMAPHORE.acquire()
                            local_slot_acquired = True

                if surya_text is not None:
                    ocr_texts = {p: surya_text.get(p, "") for p in pages_to_ocr}
                    # Release any local slot we grabbed but didn't end up using.
                    if local_slot_acquired:
                        _release_local_ocr_slot()
                        local_slot_acquired = False
                else:
                    # Tesseract path. Pick the lang set per detected
                    # script; fall back to the comprehensive default
                    # when OSD was undetermined.
                    langs = _SCRIPT_LANGS.get(script, _OCR_LANGS)
                    ocr_texts, doc_conf, page_confs = _parallel_ocr_conf(
                        file_path, pages_to_ocr, langs
                    )
                    # Per-page CORE → EXTENDED escalation. Latin docs
                    # default to the 8-lang core; pages with weak conf
                    # get a second pass with the full 26-lang set. This
                    # gives the 2-3× speedup on mono-language books
                    # (de/fr/tr/es academic) without hurting Polish or
                    # Hungarian books — those weak pages auto-promote.
                    if script == "Latin" and page_confs:
                        weak = [
                            p for p in pages_to_ocr
                            if page_confs.get(p, 0.0) < _PAGE_CONF_ESCALATE
                            or not (ocr_texts.get(p) or "").strip()
                        ]
                        # Only re-OCR when it's a small minority — if
                        # most pages are weak the whole doc probably
                        # needs Surya anyway (caught by coverage net
                        # below). Cap at 40% to keep speedup intact.
                        if 0 < len(weak) <= max(1, int(len(pages_to_ocr) * 0.4)):
                            print(
                                f"[pdf_extractor] Latin CORE→EXTENDED: "
                                f"re-OCR {len(weak)}/{len(pages_to_ocr)} weak pages"
                            )
                            refined, _r_doc, _r_pages = _parallel_ocr_conf(
                                file_path, weak, _LATIN_LANGS_EXTENDED
                            )
                            for p, t in refined.items():
                                if t.strip():
                                    ocr_texts[p] = t
                            # Recompute doc_conf after escalation so the
                            # Surya net below sees the refined picture.
                            kept = [
                                page_confs.get(p, 0.0)
                                for p in pages_to_ocr
                                if (ocr_texts.get(p) or "").strip()
                            ]
                            if kept:
                                doc_conf = sum(kept) / len(kept)
                    # Coverage signal — caught van Ess's failure mode
                    # where Tesseract returned a tiny but confident
                    # word set while losing 90% of the page text.
                    text_lens = [
                        len((ocr_texts.get(p) or "").strip())
                        for p in pages_to_ocr
                    ]
                    mean_len = (sum(text_lens) / len(text_lens)) if text_lens else 0
                    coverage = mean_len / _EXPECTED_CHARS_PER_PAGE
                    if not hard and (
                        doc_conf < _OCR_CONF_THRESHOLD
                        or coverage < _OCR_MIN_COVERAGE
                    ):
                        print(
                            f"[pdf_extractor] {script or 'unknown'} OCR weak: "
                            f"conf={doc_conf:.0f}/{_OCR_CONF_THRESHOLD:.0f} "
                            f"coverage={coverage:.2f}/{_OCR_MIN_COVERAGE:.2f} — "
                            f"escalating to Surya"
                        )
                        esc = _ocr_via_surya(file_path)
                        if esc is not None:
                            for p in pages_to_ocr:
                                if esc.get(p, "").strip():
                                    ocr_texts[p] = esc[p]
                    # Tesseract path done — release the local slot.
                    if local_slot_acquired:
                        _release_local_ocr_slot()
                        local_slot_acquired = False

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
