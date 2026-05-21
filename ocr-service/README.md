# Quilpen OCR Service (Surya)

GPU-backed OCR for **scanned, hard-script PDFs** (Arabic, Persian, Urdu, …).
Latin-script scans stay on Tesseract upstream and never reach this service.
Quality matches Gemini-gold; see `docs/ocr-mimari.md` for the measured
comparison and the full architecture.

## What it does

`POST /ocr` (multipart `file=` PDF, or raw PDF body) →
```json
{ "pages": [ { "page_number": 1, "text": "…" }, … ] }
```
- Renders pages with pdfium.
- **Splits two-page spreads** (landscape scans) and OCRs RIGHT page then
  LEFT (Arabic RTL), merging back into one text block per PDF page so
  `page_number` matches the page the viewer renders.
- Runs Surya (detection + recognition) batched.

`GET /health` → `{"status":"ok"}` (does not load the model).

Auth: set `OCR_SERVICE_SECRET`; callers send `x-ocr-secret`.

## Local run (CPU — slow, for smoke tests only)

```bash
python3.12 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000
# curl -F file=@some_scan.pdf http://localhost:8000/ocr
```
Note: `transformers==4.56.1` is pinned — surya 0.17.1 breaks on 5.x.

## Deploy A — RunPod / Vast pod (one-time batch)

1. Build & push the image (or point RunPod at this repo subdir):
   ```bash
   docker build -t <registry>/quilpen-ocr ocr-service
   docker push <registry>/quilpen-ocr
   ```
2. Launch a GPU pod (RTX 4090 is plenty), expose port 8000, set
   `OCR_SERVICE_SECRET`.
3. Run the corpus batch from your machine:
   ```bash
   OCR_SERVICE_URL=https://<pod-host>/ocr OCR_SERVICE_SECRET=… \
   APP_URL=https://quilpen.com ADMIN_SESSION_SECRET=… \
   TARGET_USER_ID=cmn1ulqtk00030purt66j5ow6 \
     node ../scripts/ocr-batch.mjs --only=Munkiz   # test ONE first
   # then full run; add --cleanup-first to clear the old no-file backlog
   ```
4. Stop the pod when done. Est. ~$5, a few hours for ~45k pages.

## Deploy B — Modal serverless (PRODUCTION + batch, scale-to-zero)

The recommended path: deploy once to Modal, use it for BOTH the one-time
corpus batch and ongoing production uploads (no throwaway pod). See
`modal_app.py`.

```bash
pip install modal
modal token new                                     # one-time auth
modal secret create quilpen-ocr OCR_SERVICE_SECRET=<pick-a-secret>
modal deploy ocr-service/modal_app.py               # → prints https URL
```

Use the printed `…/ocr` URL for:
- **batch:** `OCR_SERVICE_URL=<url>/ocr OCR_SERVICE_SECRET=<secret> … node scripts/ocr-batch.mjs`
- **production:** set `SURYA_OCR_URL=<url>/ocr` (+ `OCR_SERVICE_SECRET`) on
  the Railway **python-service**; the tiered router (`pdf_extractor.py`)
  then sends hard-script / low-confidence scans here and keeps Tesseract
  for Latin.

Scales to zero when idle ($0), ~$0.09/book in use, cold-start ~10–30 s
(fine — ingest is async).

## Notes

- `ocr_core.py` is import-safe without a GPU (predictors load lazily on the
  first `/ocr`), so `main:app` boots instantly for health checks.
- Spread split heuristic: `width > height * 1.15`. Tune in `ocr_core.py`
  if a corpus has single landscape pages.
