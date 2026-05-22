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
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service source
COPY . ./

ENV PYTHONUNBUFFERED=1

# Railway injects $PORT; default to 8000 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
