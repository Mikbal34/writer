"""
Embedding endpoint.
Calls Google Gemini Embedding API to generate text embeddings.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.embedder import generate_embeddings

router = APIRouter()


class EmbedRequest(BaseModel):
    texts: list[str]
    model: str = "models/text-embedding-004"


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


@router.post("/embed", response_model=EmbedResponse)
async def embed_texts(request: EmbedRequest):
    """
    Generate embeddings for a list of texts using Google Gemini Embedding API.
    """
    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_AI_API_KEY environment variable is not set",
        )

    if not request.texts:
        raise HTTPException(status_code=400, detail="texts list cannot be empty")

    if len(request.texts) > 100:
        raise HTTPException(
            status_code=400,
            detail="Maximum 100 texts per request",
        )

    try:
        embeddings = await generate_embeddings(
            texts=request.texts,
            model=request.model,
            api_key=api_key,
        )
        return EmbedResponse(embeddings=embeddings)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Embedding generation failed: {str(e)}",
        )
