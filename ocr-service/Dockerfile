# Surya OCR service — GPU image. Base already ships a CUDA build of torch,
# so `pip install -r requirements.txt` keeps it (surya pins no torch version)
# and only adds surya + the pinned transformers + FastAPI deps.
FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime

WORKDIR /app

# Surya renders nothing itself, but pdfium/opencv want a couple of libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ocr_core.py main.py ./

# Pre-download Surya weights at build time so the first request isn't a
# multi-minute cold download. (Comment out if your platform caches a volume.)
RUN python -c "from ocr_core import _get_predictors; _get_predictors()" || true

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
