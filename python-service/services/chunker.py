"""
Text chunking service.
Splits page-level text into overlapping chunks that respect
sentence and paragraph boundaries.
"""

import re


def chunk_by_page(
    pages: list[dict],
    chunk_size: int = 1000,
    overlap: int = 200,
) -> list[dict]:
    """
    Split extracted page texts into overlapping chunks.

    Args:
        pages: List of dicts with 'page_number' and 'content' keys
               (as returned by pdf_extractor.extract_text_by_page).
        chunk_size: Target chunk size in characters.
        overlap: Number of overlapping characters between consecutive chunks.

    Returns:
        List of dicts with keys: page_number, chunk_index, content.
    """
    all_chunks = []

    for page in pages:
        page_number = page["page_number"]
        # Strip NUL bytes that some PDFs contain — Postgres UTF-8 columns
        # reject them and the whole chunk insert fails.
        text = (page["content"] or "").replace("\x00", "")

        if not text.strip():
            continue

        page_chunks = _split_text(text, chunk_size, overlap)

        for idx, chunk_text in enumerate(page_chunks):
            # Double-check after the split — _split_text returns substrings
            # of the input but belt + braces against any stray NULs.
            cleaned = chunk_text.replace("\x00", "")
            if not cleaned.strip():
                continue
            all_chunks.append({
                "page_number": page_number,
                "chunk_index": idx,
                "content": cleaned,
            })

    return all_chunks


def _split_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """
    Split text into chunks of approximately chunk_size characters,
    with overlap characters of overlap between consecutive chunks.
    Splits respect sentence and paragraph boundaries where possible.
    """
    if len(text) <= chunk_size:
        return [text]

    sentences = _split_into_sentences(text)
    chunks = []
    current_chunk: list[str] = []
    current_length = 0

    for sentence in sentences:
        sentence_len = len(sentence)

        # If a single sentence exceeds chunk_size, force-split it
        if sentence_len > chunk_size:
            # Flush current chunk first
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_length = 0

            # Hard split the long sentence
            for i in range(0, sentence_len, chunk_size - overlap):
                fragment = sentence[i : i + chunk_size]
                chunks.append(fragment)
            continue

        # If adding this sentence would exceed chunk_size, flush
        if current_length + sentence_len + 1 > chunk_size and current_chunk:
            chunk_text = " ".join(current_chunk)
            chunks.append(chunk_text)

            # Build overlap from the tail of the current chunk
            overlap_text = _build_overlap(current_chunk, overlap)
            current_chunk = [overlap_text] if overlap_text else []
            current_length = len(overlap_text) if overlap_text else 0

        current_chunk.append(sentence)
        current_length += sentence_len + 1  # +1 for space

    # Don't forget the last chunk
    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks


def _split_into_sentences(text: str) -> list[str]:
    """
    Split text into sentences, respecting paragraph boundaries.
    Uses a regex-based approach that handles common abbreviations.
    """
    # First split on paragraph boundaries
    paragraphs = re.split(r"\n\s*\n", text)
    sentences = []

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Split on sentence-ending punctuation followed by space or end
        # Handles: . ! ? and their combinations with quotes/parens
        parts = re.split(
            r'(?<=[.!?])\s+(?=[A-Z\u00C0-\u024F\u0400-\u04FF"\'\(])',
            para,
        )

        for part in parts:
            part = part.strip()
            if part:
                sentences.append(part)

    return sentences


def _build_overlap(chunks: list[str], target_overlap: int) -> str:
    """
    Build an overlap string from the tail of a list of sentences,
    aiming for approximately target_overlap characters.
    """
    if not chunks or target_overlap <= 0:
        return ""

    result_parts = []
    total = 0

    for sentence in reversed(chunks):
        if total + len(sentence) > target_overlap and result_parts:
            break
        result_parts.insert(0, sentence)
        total += len(sentence) + 1

    return " ".join(result_parts)
