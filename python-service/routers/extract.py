"""
PDF extraction endpoint.
Accepts PDF file uploads and returns extracted text page by page.
"""

import tempfile
import os

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from services.pdf_extractor import extract_text_by_page
from services.chunker import chunk_by_page

router = APIRouter()


class PageContent(BaseModel):
    page_number: int
    content: str


class ExtractionResponse(BaseModel):
    pages: list[PageContent]
    total_pages: int


class ChunkContent(BaseModel):
    page_number: int
    chunk_index: int
    content: str


class ChunkResponse(BaseModel):
    chunks: list[ChunkContent]
    total_chunks: int


@router.post("/extract", response_model=ExtractionResponse)
async def extract_pdf(file: UploadFile = File(...)):
    """
    Extract text from an uploaded PDF file, page by page.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    try:
        content = await file.read()
        os.write(tmp_fd, content)
        os.close(tmp_fd)

        pages = extract_text_by_page(tmp_path)
        return ExtractionResponse(
            pages=[PageContent(**p) for p in pages],
            total_pages=len(pages),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF extraction failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/extract-and-chunk", response_model=ChunkResponse)
async def extract_and_chunk(
    file: UploadFile = File(...),
    chunk_size: int = 1000,
    overlap: int = 200,
):
    """
    Extract text from PDF and split into overlapping chunks.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    try:
        content = await file.read()
        os.write(tmp_fd, content)
        os.close(tmp_fd)

        pages = extract_text_by_page(tmp_path)
        chunks = chunk_by_page(pages, chunk_size=chunk_size, overlap=overlap)
        return ChunkResponse(
            chunks=[ChunkContent(**c) for c in chunks],
            total_chunks=len(chunks),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction/chunking failed: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
