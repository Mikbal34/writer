"""
Surya OCR microservice (FastAPI). Runs on a GPU host (serverless or pod) and
is called by the ingest worker exactly like the embedder service — only the
`needsOcr` + hard-script branch reaches it.

Endpoints:
  GET  /health            → readiness (does not force model load)
  POST /ocr               → multipart {file: pdf} | raw pdf bytes
                            optional query: ?dpi=200
                            → {"pages": [{"page_number": 1, "text": "…"}, …]}

Auth: x-ocr-secret header == OCR_SERVICE_SECRET env (if the env is set).
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from ocr_core import DEFAULT_DPI, ocr_pdf

app = FastAPI(title="Quilpen OCR (Surya)", version="0.1.0")

MAX_BYTES = 200 * 1024 * 1024  # generous; classical multi-volume scans are big
_SECRET = os.environ.get("OCR_SERVICE_SECRET", "")


def _check_auth(provided: str | None) -> None:
    if _SECRET and provided != _SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    # Intentionally does NOT load the model — keeps serverless cold-start
    # health checks cheap. Model loads on the first /ocr call.
    return {"status": "ok"}


@app.post("/ocr")
async def ocr(
    request: Request,
    file: UploadFile | None = None,
    dpi: int = Query(DEFAULT_DPI, ge=72, le=400),
    x_ocr_secret: str | None = Header(default=None),
):
    _check_auth(x_ocr_secret)

    if file is not None:
        data = await file.read()
    else:
        data = await request.body()

    if not data:
        raise HTTPException(status_code=400, detail="empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file too large")

    try:
        pages = ocr_pdf(data, dpi=dpi)
    except Exception as exc:  # surface a clean error to the worker
        raise HTTPException(status_code=500, detail=f"ocr failed: {exc}") from exc

    return JSONResponse(
        {"pages": [{"page_number": p.page_number, "text": p.text} for p in pages]}
    )
