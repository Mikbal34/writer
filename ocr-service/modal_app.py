"""
Modal deployment of the Surya OCR service — serverless GPU, scale-to-zero.

This is the PRODUCTION OCR endpoint AND what the one-time corpus batch runs
against (no throwaway pod): deploy once, use for both.

  pip install modal
  modal token new                                  # one-time auth
  modal secret create quilpen-ocr OCR_SERVICE_SECRET=<pick-a-secret>
  modal deploy ocr-service/modal_app.py            # → prints the https URL

The printed URL (…/ocr) goes into:
  • the batch:   OCR_SERVICE_URL=<url>/ocr  node scripts/ocr-batch.mjs …
  • production:  set SURYA_OCR_URL=<url>/ocr on the Railway python-service

Idle cost is $0 (scales to zero after `scaledown_window`). First request
after idle pays a cold start (~10-30 s) to load the model from the cache
volume; ingest is async so this doesn't hurt UX.

NOTE: Modal's API shifts between versions. This targets the modern
`add_local_python_source` + `@modal.asgi_app()` style; if `modal deploy`
complains, the fix is usually a one-line decorator/arg rename — tell me the
error and I'll adjust.
"""

import modal

app = modal.App("quilpen-ocr")

# Model weights are cached on a persistent Volume so cold starts don't
# re-download ~1.3 GB every time.
model_cache = modal.Volume.from_name("quilpen-ocr-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "surya-ocr==0.17.1",
        "transformers==4.56.1",
        "pypdfium2>=4.30.0",
        "pillow>=10.0.0",
        "fastapi>=0.115.0",
        "python-multipart>=0.0.9",
    )
    # Route Surya/HF model caches onto the mounted Volume.
    .env({"XDG_CACHE_HOME": "/cache", "HF_HOME": "/cache/huggingface"})
    # Ship the service code into the image.
    .add_local_python_source("ocr_core", "main")
)


@app.function(
    image=image,
    gpu="L4",  # plenty for Surya; bump to "A10G"/"A100" for more throughput
    volumes={"/cache": model_cache},
    scaledown_window=300,        # stay warm 5 min after last request
    timeout=60 * 60,             # a big multi-volume book can take minutes
    secrets=[modal.Secret.from_name("quilpen-ocr")],
    max_containers=4,            # cap parallel GPUs (cost guardrail)
)
@modal.asgi_app()
def fastapi_app():
    # main.py reads OCR_SERVICE_SECRET from env (provided by the Modal
    # secret) and exposes /ocr + /health. ocr_core loads the Surya model
    # lazily on the first /ocr call, then reuses it while the container
    # stays warm.
    from main import app as web_app

    return web_app
