"""
Embedding service using Google Gemini Embedding API.
Generates text embeddings via the generativelanguage REST API.
"""

import httpx

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
BATCH_SIZE = 20  # Max texts per single API call


async def generate_embeddings(
    texts: list[str],
    model: str = "models/text-embedding-004",
    api_key: str = "",
) -> list[list[float]]:
    """
    Generate embeddings for a list of texts using Google Gemini Embedding API.

    Args:
        texts: List of strings to embed.
        model: Embedding model name (default: models/text-embedding-004).
        api_key: Google AI API key.

    Returns:
        List of embedding vectors (list of floats) in the same order as input texts.
    """
    if not texts:
        return []

    all_embeddings: list[list[float]] = []

    # Process in batches
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        batch_embeddings = await _embed_batch(batch, model, api_key)
        all_embeddings.extend(batch_embeddings)

    return all_embeddings


async def _embed_batch(
    texts: list[str],
    model: str,
    api_key: str,
) -> list[list[float]]:
    """
    Embed a single batch of texts using the batchEmbedContents endpoint.
    """
    url = f"{GEMINI_API_BASE}/{model}:batchEmbedContents"

    requests_body = []
    for text in texts:
        requests_body.append({
            "model": model,
            "content": {
                "parts": [{"text": text}],
            },
        })

    payload = {"requests": requests_body}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            json=payload,
            params={"key": api_key},
            headers={"Content-Type": "application/json"},
        )

        if response.status_code != 200:
            error_detail = response.text
            raise RuntimeError(
                f"Gemini embedding API returned {response.status_code}: {error_detail}"
            )

        data = response.json()

    embeddings = []
    for emb in data.get("embeddings", []):
        embeddings.append(emb["values"])

    return embeddings
