"""
Writer Agent Python Service
FastAPI service for PDF extraction, DOCX generation, and embeddings.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import extract, embed, docx_gen, process

app = FastAPI(
    title="Writer Agent Python Service",
    description="PDF extraction, DOCX generation, and embedding service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract.router, tags=["Extract"])
app.include_router(embed.router, tags=["Embed"])
app.include_router(docx_gen.router, tags=["DOCX Generation"])
app.include_router(process.router, tags=["Process"])


@app.on_event("startup")
async def _preload_embedder():
    # Force BGE-M3 weights into RAM BEFORE Fly marks this machine healthy
    # and routes /embed traffic. Otherwise the first /embed on a freshly
    # booted machine spends ~30-60s loading the model and trips the Node
    # worker's 2-min embed timeout (each scale-out machine repeats this).
    from services.embedder import preload
    preload()


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "writer-agent-python"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
