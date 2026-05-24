"""
Quilpen Python Service
FastAPI service for PDF extraction, DOCX generation, and OCR routing.

NOTE: /embed endpoint removed 2026-05-24 — Voyage AI handles all
embedding now (see src/lib/library-pipeline.ts). The BGE-M3 model
(~2.5 GB image bloat + 30-60s cold start) is gone with it. Routers
left in place: extract / docx_gen / process.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import extract, docx_gen, process

app = FastAPI(
    title="Quilpen Python Service",
    description="PDF extraction, DOCX generation, and OCR routing",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract.router, tags=["Extract"])
app.include_router(docx_gen.router, tags=["DOCX Generation"])
app.include_router(process.router, tags=["Process"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "quilpen-python"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
