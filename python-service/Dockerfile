FROM python:3.11-slim

# System deps — build tools for lxml + tesseract for OCR fallback on
# scanned PDFs. Languages: English (default for academic PDFs),
# Turkish (kullanıcı dili), Arabic (kitabı tabanlı kaynaklar).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-tur \
    tesseract-ocr-ara \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching. Paths are local to
# this directory (Fly build context = python-service/); Railway, when
# still building this monorepo, sets its build context to python-service
# the same way.
COPY requirements.txt ./
# Install CPU-only torch FIRST so sentence-transformers reuses it. The
# full torch wheel ships CUDA libs (~2GB) we don't need; including them
# pushes the image past Fly's 8 GB rootfs limit.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch
RUN pip install --no-cache-dir -r requirements.txt

# Bake the BGE-M3 model into the image (~2.3 GB). First /embed call at
# runtime would otherwise download it from HuggingFace, blowing past the
# Node worker's 2-min embed timeout. Build is slower but cold start is
# fast forever — the model lives in the image's HF cache.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"

# Copy the service source
COPY . ./

ENV PYTHONUNBUFFERED=1

# Dual-stack launcher (see serve.py): one process, two listeners —
# IPv4 (Fly public proxy + health) AND IPv6 (Fly internal 6PN mesh the
# Node worker uses). Single --host on uvicorn picks only one family.
CMD ["python", "serve.py"]
