"""
Embedding service using BGE-M3 (BAAI/bge-m3) — self-hosted, open-source
(MIT), multilingual. Replaces the Google Gemini API: no per-call cost, no
vendor rate-limit / quota blocks, gold quality on Arabic/Turkish academic
text. Runs on CPU (the dense query/embed path is short text, ~ms-100s ms);
GPU is only used for the one-time bulk backfill.

Dense output is 1024-dim, L2-normalized — matching the pgvector
vector(1024) schema and the `<=>` (cosine) retrieval operator.
"""

import asyncio
from functools import lru_cache

_MODEL_NAME = "BAAI/bge-m3"
_EMBED_DIM = 1024


@lru_cache(maxsize=1)
def _model():
    # sentence-transformers picks CUDA automatically when present, else CPU.
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(_MODEL_NAME)


def preload() -> None:
    """Force the BGE-M3 weights into RAM. Called from main.py at FastAPI
    startup so each python-service machine has the model loaded BEFORE
    Fly marks it healthy and routes traffic — otherwise the very first
    /embed on a newly-booted machine spends ~30-60s loading and trips
    the Node worker's 2-min embed timeout."""
    _model()


def _encode(texts: list[str]) -> list[list[float]]:
    model = _model()
    vecs = model.encode(
        texts,
        normalize_embeddings=True,  # unit-length → cosine == dot product
        batch_size=32,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    return vecs.tolist()


async def generate_embeddings(
    texts: list[str],
    model: str = _MODEL_NAME,  # accepted for call-site compatibility; ignored
    api_key: str = "",  # accepted for call-site compatibility; ignored
    output_dim: int = _EMBED_DIM,
) -> list[list[float]]:
    """Embed a list of texts with BGE-M3. Returns 1024-dim unit vectors
    in input order. CPU encode is offloaded to a worker thread so the
    async event loop isn't blocked."""
    if not texts:
        return []
    return await asyncio.to_thread(_encode, texts)
