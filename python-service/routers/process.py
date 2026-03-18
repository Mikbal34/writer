"""
Process endpoint.
Accepts a file path and extracts text from a PDF.
Extracts first 10 pages for bibliography detection and chunks all pages for embedding.
For scanned (OCR) PDFs, bibliography pages are extracted first, then remaining pages
are processed in a background task to avoid timeouts.
"""

import os
import asyncio
from typing import List, Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from services.pdf_extractor import extract_text_by_page, is_scanned_pdf, get_total_pages
from services.chunker import chunk_by_page

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
