FROM python:3.11-slim

# System deps — poppler for PyMuPDF, build tools for lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching
COPY python-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service source
COPY python-service/ ./

ENV PYTHONUNBUFFERED=1

# Railway injects $PORT; default to 8000 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
