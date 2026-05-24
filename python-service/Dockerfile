FROM python:3.11-slim

# System deps — build tools for lxml + tesseract for OCR fallback on
# scanned PDFs. Languages: English (default for academic PDFs),
# Turkish (kullanıcı dili), Arabic (kitabı tabanlı kaynaklar).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    tesseract-ocr \
    # ── Core academic OCR coverage (Tesseract is the cheap CPU path;
    #    Surya only runs when Tesseract output looks suspect). Top-30
    #    languages bias toward European + Cyrillic + Greek academic
    #    corpora. Hard scripts (Arabic-family, CJK, Devanagari) go
    #    straight to Surya, no Tesseract pack needed.
    tesseract-ocr-eng tesseract-ocr-tur tesseract-ocr-ara \
    # Latin Western Europe
    tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa \
    tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-nld \
    tesseract-ocr-cat \
    # Latin Nordic
    tesseract-ocr-swe tesseract-ocr-dan tesseract-ocr-nor \
    tesseract-ocr-fin tesseract-ocr-isl \
    # Latin Central / Eastern Europe
    tesseract-ocr-pol tesseract-ocr-ces tesseract-ocr-slk \
    tesseract-ocr-hun tesseract-ocr-ron tesseract-ocr-hrv \
    tesseract-ocr-slv tesseract-ocr-lit tesseract-ocr-lav \
    tesseract-ocr-est tesseract-ocr-sqi \
    # Latin classical
    tesseract-ocr-lat \
    # Cyrillic
    tesseract-ocr-rus tesseract-ocr-ukr tesseract-ocr-bul \
    tesseract-ocr-srp tesseract-ocr-mkd \
    # Greek
    tesseract-ocr-ell \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching. Paths are local to
# this directory (Fly build context = python-service/); Railway, when
# still building this monorepo, sets its build context to python-service
# the same way.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Embedding lives on Voyage AI now (see src/lib/library-pipeline.ts).
# The python service no longer hosts BGE-M3 — image shrank from
# ~3.5 GB to ~700 MB, cold start dropped from ~30-60 s to ~3-5 s.

# Copy the service source
COPY . ./

ENV PYTHONUNBUFFERED=1

# Dual-stack launcher (see serve.py): one process, two listeners —
# IPv4 (Fly public proxy + health) AND IPv6 (Fly internal 6PN mesh the
# Node worker uses). Single --host on uvicorn picks only one family.
CMD ["python", "serve.py"]
