"""
One-off BGE-M3 backfill on Modal GPU. Embeds every LibraryChunk whose
embedding is still NULL (the 157k migrated from Railway) to 1024-dim
normalized vectors and writes them back to Neon.

Same model (BAAI/bge-m3, normalize_embeddings=True) and same embed-text
rule (contextualPrefix + content) as the runtime python-service /embed,
so the backfilled corpus and future query/chunk embeddings share one
vector space.

Resumable: each pass fetches the next batch WHERE embedding IS NULL, so
re-running continues. Run:
  modal run scripts/modal_bge_backfill.py
Secret `quilpen-neon` must hold DATABASE_URL (the Neon connection string).
"""
import modal

app = modal.App("quilpen-bge-backfill")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "sentence-transformers==3.3.1",
        "torch",
        "psycopg[binary]==3.2.3",
    )
    # Bake the model into the image so cold start doesn't re-download 2GB.
    .run_commands(
        "python -c \"from sentence_transformers import SentenceTransformer; "
        "SentenceTransformer('BAAI/bge-m3')\""
    )
)


@app.function(
    image=image,
    gpu="L4",
    timeout=7200,
    secrets=[modal.Secret.from_name("quilpen-neon")],
)
def backfill(fetch_size: int = 2000):
    import os
    import time
    import psycopg
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer("BAAI/bge-m3", device="cuda")
    conn = psycopg.connect(os.environ["DATABASE_URL"])

    def embed_text(content: str, prefix) -> str:
        return f"{prefix.strip()}\n\n{content}" if prefix else content

    total = 0
    t0 = time.time()
    while True:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT id, content, "contextualPrefix" FROM "LibraryChunk" '
                "WHERE embedding IS NULL ORDER BY id LIMIT %s",
                (fetch_size,),
            )
            rows = cur.fetchall()
        if not rows:
            break

        texts = [embed_text(c, p) for (_id, c, p) in rows]
        vecs = model.encode(
            texts, normalize_embeddings=True, batch_size=64,
            convert_to_numpy=True, show_progress_bar=False,
        )
        # One multi-row UPDATE per batch (UPDATE ... FROM VALUES) instead of
        # per-chunk executemany — the per-row round-trip Modal→Neon was the
        # bottleneck that hit the 1h timeout (GPU embed is fast; the writes
        # weren't). ~40 statements for 78k rows instead of 78k.
        args: list = []
        placeholders: list[str] = []
        for (_id, _c, _p), v in zip(rows, vecs):
            placeholders.append("(%s,%s)")
            args.append(_id)
            args.append("[" + ",".join(f"{x:.6f}" for x in v) + "]")
        sql_update = (
            'UPDATE "LibraryChunk" AS t SET embedding = d.emb::vector '
            f'FROM (VALUES {",".join(placeholders)}) AS d(id, emb) '
            "WHERE t.id = d.id"
        )
        with conn.cursor() as cur:
            cur.execute(sql_update, args)
        conn.commit()
        total += len(rows)
        rate = total / max(time.time() - t0, 1e-6)
        print(f"backfilled {total} (+{len(rows)})  ~{rate:.0f}/s")

    conn.close()
    print(f"DONE: {total} chunks in {time.time() - t0:.0f}s")
    return total


@app.local_entrypoint()
def main():
    n = backfill.remote()
    print(f"backfill returned {n}")
