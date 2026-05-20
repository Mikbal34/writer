"""
Embedding service using Google Gemini Embedding API.
Generates text embeddings via the generativelanguage REST API.
"""

import asyncio

import httpx

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
BATCH_SIZE = 20  # Max texts per single API call

# pgvector column dimension. gemini-embedding-001 defaults to 3072
# but accepts outputDimensionality, so we match our existing
# vector(768) schema without re-migrating.
DEFAULT_OUTPUT_DIM = 768

# Gemini's batchEmbedContents enforces a per-minute request/token
# rate limit. A library rebuild fires thousands of batches back to
# back and trips it (429 RESOURCE_EXHAUSTED), which previously
# failed the whole entry. The limit is transient — a short wait
# clears it — so we retry with exponential backoff instead of
# bubbling the error up. A small inter-batch pause also keeps a
# single large book from bursting past the ceiling.
MAX_RETRIES = 5
RETRY_BASE_SECONDS = 4.0
INTER_BATCH_PAUSE_SECONDS = 0.5


async def generate_embeddings(
    texts: list[str],
    model: str = "models/gemini-embedding-001",
    api_key: str = "",
    output_dim: int = DEFAULT_OUTPUT_DIM,
) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using Google Gemini Embedding API.

    Args:
        texts: List of strings to embed.
        model: Embedding model name (default: models/gemini-embedding-001).
        api_key: Google AI API key.
        output_dim: Truncate embeddings to this dimension (default: 768).

    Returns:
        List of embedding vectors (list of floats) in the same order as input texts.
    """
    if not texts:
        return []

    all_embeddings: list[list[float]] = []

    # Process in batches
    total = len(texts)
    for i in range(0, total, BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        batch_embeddings = await _embed_batch(batch, model, api_key, output_dim)
        all_embeddings.extend(batch_embeddings)
        # Breathe between batches so a large book doesn't burst past
        # the per-minute ceiling (skip the pause after the last one).
        if i + BATCH_SIZE < total:
            await asyncio.sleep(INTER_BATCH_PAUSE_SECONDS)

    return all_embeddings


async def _embed_batch(
    texts: list[str],
    model: str,
    api_key: str,
    output_dim: int,
) -> list[list[float]]:
    """
    Embed a single batch of texts using the batchEmbedContents endpoint.

    Retries on 429 (RESOURCE_EXHAUSTED) and transient 5xx with
    exponential backoff — the Gemini rate limit is per-minute, so a
    short wait clears it. Only a non-retryable error or exhausting
    all attempts raises.
    """
    url = f"{GEMINI_API_BASE}/{model}:batchEmbedContents"

    requests_body = []
    for text in texts:
        requests_body.append({
            "model": model,
            "content": {
                "parts": [{"text": text}],
            },
            "outputDimensionality": output_dim,
        })

    payload = {"requests": requests_body}

    last_error = ""
    for attempt in range(MAX_RETRIES + 1):
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                json=payload,
                params={"key": api_key},
                headers={"Content-Type": "application/json"},
            )

        if response.status_code == 200:
            data = response.json()
            return [emb["values"] for emb in data.get("embeddings", [])]

        last_error = (
            f"Gemini embedding API returned {response.status_code}: {response.text}"
        )

        # Retry only on rate-limit / transient server errors.
        retryable = response.status_code == 429 or response.status_code >= 500
        if not retryable or attempt == MAX_RETRIES:
            raise RuntimeError(last_error)

        # Exponential backoff with a little jitter. 4s, 8s, 16s, 32s…
        wait = RETRY_BASE_SECONDS * (2 ** attempt)
        await asyncio.sleep(wait)

    # Unreachable, but keeps type-checkers happy.
    raise RuntimeError(last_error)
