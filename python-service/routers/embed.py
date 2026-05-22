"""
Embedding endpoint — BGE-M3 (self-hosted, 1024-dim, normalized).
The whole corpus shares one vector space; all callers (chunk, query,
note) hit this single endpoint, so swapping the model here swaps it
everywhere consistently.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.embedder import generate_embeddings

router = APIRouter()


class EmbedRequest(BaseModel):
    texts: list[str]
    # Accepted for backward compatibility with callers that still send a
    # model field; ignored — the embedder is fixed to BGE-M3 so the
    # entire corpus stays in one vector space.
    model: str | None = None


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


@router.post("/embed", response_model=EmbedResponse)
async def embed_texts(request: EmbedRequest):
    """Generate BGE-M3 embeddings for a list of texts (1024-dim, unit)."""
    if not request.texts:
        raise HTTPException(status_code=400, detail="texts list cannot be empty")

    if len(request.texts) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 texts per request")

    try:
        embeddings = await generate_embeddings(texts=request.texts)
        return EmbedResponse(embeddings=embeddings)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Embedding generation failed: {str(e)}",
        )
