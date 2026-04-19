"""
Process endpoint.
Accepts a file path and extracts text from a PDF.
Extracts first 10 pages for bibliography detection and chunks all pages for embedding.
For scanned (OCR) PDFs, bibliography pages are extracted first, then remaining pages
are processed in a background task to avoid timeouts.

Also exposes /process-url and /process-bytes variants so Next.js can process
sources without sharing a filesystem with this container (Railway services run
in isolated containers).
"""

import os
import re
import tempfile
from typing import List, Optional
from urllib.parse import urljoin

import httpx
from fastapi import APIRouter, HTTPException, BackgroundTasks, File, UploadFile, Form
from pydantic import BaseModel

from services.pdf_extractor import extract_text_by_page, is_scanned_pdf, get_total_pages
from services.chunker import chunk_by_page


BROWSER_HEADERS = {
    # Present as a real browser — many publishers (Elsevier, Sage, JSTOR,
    # NCBI PMC) block obvious bot User-Agents with 403.
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/pdf,text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Meta tags scholarly publishers use to advertise the actual PDF URL on the
# HTML landing page. The first one that matches wins.
_CITATION_PDF_PATTERNS = [
    re.compile(
        r'<meta[^>]*name="citation_pdf_url"[^>]*content="([^"]+)"',
        re.IGNORECASE,
    ),
    re.compile(
        r'<meta[^>]*content="([^"]+)"[^>]*name="citation_pdf_url"',
        re.IGNORECASE,
    ),
]


async def _fetch_pdf_bytes(client: httpx.AsyncClient, url: str) -> tuple[bytes, str, str]:
    """GET a URL, returning (bytes, final_url, content_type). Raises on HTTP error."""
    response = await client.get(url, headers=BROWSER_HEADERS)
    response.raise_for_status()
    return response.content, str(response.url), response.headers.get("content-type", "")


async def _resolve_and_fetch_pdf(url: str) -> tuple[bytes, str]:
    """Fetch a URL and — if the response is an HTML landing page — find and
    follow the <meta name="citation_pdf_url"> tag. Returns (pdf_bytes, final_url).
    Raises HTTPException on failure."""
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        try:
            content, final_url, content_type = await _fetch_pdf_bytes(client, url)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"PDF download failed: {e}")

        if content[:5].startswith(b"%PDF"):
            return content, final_url

        # Not a PDF — look for citation_pdf_url in HTML body.
        if b"citation_pdf_url" in content[:200_000]:
            text = content.decode("utf-8", errors="replace")
            for pattern in _CITATION_PDF_PATTERNS:
                match = pattern.search(text)
                if not match:
                    continue
                pdf_url = urljoin(final_url, match.group(1))
                try:
                    pdf_bytes, pdf_final_url, _ = await _fetch_pdf_bytes(client, pdf_url)
                except httpx.HTTPError as e:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Scraped citation_pdf_url download failed: {e}",
                    )
                if not pdf_bytes[:5].startswith(b"%PDF"):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Scraped citation_pdf_url did not return a PDF ({pdf_final_url})",
                    )
                return pdf_bytes, pdf_final_url

        # Neither a PDF nor a landing page we can parse.
        snippet = content[:120].decode("utf-8", errors="replace").strip()
        raise HTTPException(
            status_code=422,
            detail=(
                f"Not a PDF (content-type: {content_type}). "
                f"Got: {snippet[:80]}"
            ),
        )

router = APIRouter()

# Store background OCR results keyed by sourceId
_ocr_results: dict[str, dict] = {}

# Pages to OCR for bibliography detection
_BIB_PAGES = 10


class ProcessRequest(BaseModel):
    sourceId: str
    filePath: str
    fileType: str
    reprocess: Optional[bool] = None


class ChunkItem(BaseModel):
    pageNumber: int
    chunkIndex: int
    content: str


class ProcessResponse(BaseModel):
    sourceId: str
    totalPages: int
    extractedText: str
    chunks: List[ChunkItem]
    ocrPending: bool = False


def _ocr_remaining_pages(source_id: str, file_path: str):
    """Background task: OCR all pages and store result."""
    try:
        pages = extract_text_by_page(file_path)
        raw_chunks = chunk_by_page(pages)
        _ocr_results[source_id] = {
            "pages": pages,
            "chunks": raw_chunks,
            "totalPages": len(pages),
        }
    except Exception as e:
        _ocr_results[source_id] = {"error": str(e)}


@router.post("/process", response_model=ProcessResponse)
async def process_source(req: ProcessRequest, background_tasks: BackgroundTasks):
    """
    Extract text from a PDF: first 10 pages for bibliography, all pages chunked for embedding.
    For scanned PDFs, only first pages are OCR'd synchronously; the rest runs in background.
    """
    if req.fileType != "pdf":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type for processing: {req.fileType}",
        )

    if not os.path.isfile(req.filePath):
        raise HTTPException(status_code=404, detail=f"File not found: {req.filePath}")

    try:
        scanned = is_scanned_pdf(req.filePath)
        total_pages = get_total_pages(req.filePath)

        if scanned:
            # OCR only first N pages synchronously for bibliography
            bib_pages = extract_text_by_page(req.filePath, max_pages=_BIB_PAGES)
            extracted_text = "\n\n---\n\n".join(
                f"[Page {p['page_number']}]\n{p['content']}" for p in bib_pages
            )

            # Schedule full OCR in background
            background_tasks.add_task(_ocr_remaining_pages, req.sourceId, req.filePath)

            return ProcessResponse(
                sourceId=req.sourceId,
                totalPages=total_pages,
                extractedText=extracted_text,
                chunks=[],
                ocrPending=True,
            )
        else:
            # Normal PDF: extract all pages at once
            pages = extract_text_by_page(req.filePath)

            first_pages = pages[:_BIB_PAGES]
            extracted_text = "\n\n---\n\n".join(
                f"[Page {p['page_number']}]\n{p['content']}" for p in first_pages
            )

            raw_chunks = chunk_by_page(pages)
            chunks = [
                ChunkItem(
                    pageNumber=c["page_number"],
                    chunkIndex=c["chunk_index"],
                    content=c["content"],
                )
                for c in raw_chunks
            ]

            return ProcessResponse(
                sourceId=req.sourceId,
                totalPages=len(pages),
                extractedText=extracted_text,
                chunks=chunks,
                ocrPending=False,
            )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Processing failed: {str(e)}"
        )


class OcrStatusResponse(BaseModel):
    sourceId: str
    ready: bool
    totalPages: int = 0
    chunks: List[ChunkItem] = []
    error: str = ""


@router.get("/ocr-status/{source_id}", response_model=OcrStatusResponse)
async def ocr_status(source_id: str):
    """Poll for background OCR completion."""
    result = _ocr_results.get(source_id)
    if result is None:
        return OcrStatusResponse(sourceId=source_id, ready=False)

    if "error" in result:
        # Clean up and return error
        del _ocr_results[source_id]
        return OcrStatusResponse(sourceId=source_id, ready=True, error=result["error"])

    chunks = [
        ChunkItem(
            pageNumber=c["page_number"],
            chunkIndex=c["chunk_index"],
            content=c["content"],
        )
        for c in result["chunks"]
    ]

    total = result["totalPages"]
    del _ocr_results[source_id]

    return OcrStatusResponse(
        sourceId=source_id,
        ready=True,
        totalPages=total,
        chunks=chunks,
    )


# ─── Content-delivery variants (no shared filesystem) ────────────────────────


def _process_local_path(source_id: str, file_path: str) -> ProcessResponse:
    """Shared extract+chunk path used by /process-url and /process-bytes.
    Extracts every page (OCR'd synchronously if the PDF is scanned) and
    returns the lot as chunks plus a bibliography-page preview."""
    total_pages = get_total_pages(file_path)

    # Single pass over the whole document — we always want all chunks for
    # embedding, and the first N pages are enough for a bibliography preview.
    pages = extract_text_by_page(file_path)

    first_pages = pages[: _BIB_PAGES]
    extracted_text = "\n\n---\n\n".join(
        f"[Page {p['page_number']}]\n{p['content']}" for p in first_pages
    )

    raw_chunks = chunk_by_page(pages)
    chunks = [
        ChunkItem(
            pageNumber=c["page_number"],
            chunkIndex=c["chunk_index"],
            content=c["content"],
        )
        for c in raw_chunks
    ]

    return ProcessResponse(
        sourceId=source_id,
        totalPages=total_pages,
        extractedText=extracted_text,
        chunks=chunks,
        ocrPending=False,
    )


class ProcessUrlRequest(BaseModel):
    sourceId: str
    url: str


@router.post("/process-url", response_model=ProcessResponse)
async def process_url(req: ProcessUrlRequest):
    """Download a PDF from a URL, extract + chunk, return. If the URL serves
    an HTML landing page, look for a citation_pdf_url meta tag and follow it."""
    pdf_bytes, _ = await _resolve_and_fetch_pdf(req.url)

    if len(pdf_bytes) < 1024:
        raise HTTPException(status_code=422, detail="PDF too small — likely invalid")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name

    try:
        return _process_local_path(req.sourceId, tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@router.post("/process-bytes", response_model=ProcessResponse)
async def process_bytes(
    sourceId: str = Form(...),
    file: UploadFile = File(...),
):
    """Accept a multipart PDF upload, extract + chunk, return."""
    pdf_bytes = await file.read()
    if len(pdf_bytes) < 1024:
        raise HTTPException(status_code=422, detail="PDF too small — likely invalid")

    if not pdf_bytes[:5].startswith(b"%PDF"):
        raise HTTPException(
            status_code=422,
            detail="Uploaded file is not a valid PDF (missing %PDF header).",
        )

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = tmp.name

    try:
        return _process_local_path(sourceId, tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
