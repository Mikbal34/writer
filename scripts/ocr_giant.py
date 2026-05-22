"""
One-off OCR for the over-1-hour giant books that hit Modal's function
timeout as a single request. Splits each PDF into ~PART-page parts locally,
OCRs each part via the existing /ocr (each part < 1 h → no timeout), offsets
page numbers to global, concatenates, and ingests as ONE entry with the
original full PDF kept for the viewer.

  OCR_SERVICE_URL=https://…/ocr OCR_SERVICE_SECRET=… \
  APP_URL=https://quilpen.com ADMIN_SESSION_SECRET=… \
  TARGET_USER_ID=cmn1ulqtk00030purt66j5ow6 \
    /tmp/ocrtest/venv/bin/python scripts/ocr_giant.py
"""
import io, json, os, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
import pypdfium2 as pdfium

OCR_URL = os.environ["OCR_SERVICE_URL"]
OCR_SECRET = os.environ.get("OCR_SERVICE_SECRET", "")
APP = os.environ["APP_URL"]
ADMIN = os.environ["ADMIN_SESSION_SECRET"]
USER = os.environ["TARGET_USER_ID"]
PART = 500
PART_CONCURRENCY = 3

BASE = "/Users/ikbalkoc/Desktop/klasik_eserler/_TUMU_TOPLU_YUKLEME/"
GIANTS = [
    # Ihya already OCR'd + ingested (re-embedding separately); only Taberi left.
    ("Taberi — Tarihu Rusul", "AR_Taberi_TarihuRusul.pdf"),
]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def ocr_part(part_bytes):
    """POST a part PDF to /ocr, handle Modal 303 poll, return [{page_number,text}]."""
    opener = urllib.request.build_opener(_NoRedirect)
    post_h = {"Content-Type": "application/pdf"}
    poll_h = {}
    if OCR_SECRET:
        post_h["x-ocr-secret"] = OCR_SECRET
        poll_h["x-ocr-secret"] = OCR_SECRET
    next_url = None
    transient = 0
    for _ in range(3000):
        try:
            if next_url is None:
                req = urllib.request.Request(OCR_URL, data=part_bytes, method="POST", headers=post_h)
            else:
                req = urllib.request.Request(next_url, method="GET", headers=poll_h)
            with opener.open(req, timeout=20 * 60) as resp:
                return json.loads(resp.read().decode("utf-8")).get("pages", [])
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307):
                next_url = e.headers.get("Location")
                time.sleep(8)
                continue
            if e.code in (429, 500, 502, 503) and transient < 6:
                transient += 1
                time.sleep(min(60, 5 * 2 ** transient))
                continue
            raise
        except urllib.error.URLError:
            if transient < 6:
                transient += 1
                time.sleep(min(60, 5 * 2 ** transient))
                continue
            raise
    raise RuntimeError("poll exhausted")


def make_part(raw, start, end):
    src = pdfium.PdfDocument(raw)
    part = pdfium.PdfDocument.new()
    part.import_pages(src, list(range(start, end)))
    buf = io.BytesIO()
    part.save(buf)
    return buf.getvalue()


def ingest(title, filename, full_pdf, pages):
    """admin-ingest single: original PDF (viewer) + ocrText (chunks)."""
    boundary = "----giant" + str(int(time.time()))
    def field(name, value):
        return f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    body = b""
    body += field("userId", USER)
    body += field("title", title)
    body += field("mode", "single")
    body += field("ocrText", json.dumps(pages))
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
             f'Content-Type: application/pdf\r\n\r\n').encode() + full_pdf + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{APP}/api/library/admin-ingest", data=body, method="POST",
        headers={"x-admin-secret": ADMIN, "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=5 * 60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    for title, fn in GIANTS:
        raw = open(BASE + fn, "rb").read()
        n = len(pdfium.PdfDocument(raw))
        cache = f"/tmp/giant_{fn}.json"
        # Recover OCR from disk if a previous run got the text but failed at
        # ingest — don't pay to re-OCR.
        if os.path.exists(cache):
            all_pages = json.load(open(cache))
            print(f"\n=== {title}: cache'ten {len(all_pages)} sayfa (OCR atlandı) ===", flush=True)
            r = ingest(title, fn, raw, all_pages)
            print(f"  → ingest: entry {r.get('entryId','?')[:8]}", flush=True)
            continue
        ranges = [(s, min(s + PART, n)) for s in range(0, n, PART)]
        print(f"\n=== {title}: {n}sf → {len(ranges)} parça ===", flush=True)

        # Split sequentially in the main thread — pdfium is NOT thread-safe,
        # so build all part-bytes first, then OCR them concurrently (HTTP only).
        parts = [(s, make_part(raw, s, e)) for (s, e) in ranges]

        results = {}
        def work(item):
            idx, (s, part_bytes) = item
            pages = ocr_part(part_bytes)
            # offset page numbers to global (part page 1 → global s+1)
            return idx, s, [{"page_number": s + p["page_number"], "text": p.get("text", "")} for p in pages]

        with ThreadPoolExecutor(max_workers=PART_CONCURRENCY) as ex:
            for idx, s, pages in ex.map(work, list(enumerate(parts))):
                results[idx] = pages
                print(f"  parça {idx+1}/{len(parts)} (s.{s+1}–) → {len(pages)} sayfa", flush=True)

        all_pages = []
        for idx in sorted(results):
            all_pages.extend(results[idx])
        # Persist OCR before ingest so an ingest failure doesn't waste the OCR.
        json.dump(all_pages, open(cache, "w"))
        print(f"  OCR diske kaydedildi: {cache}", flush=True)
        r = ingest(title, fn, raw, all_pages)
        print(f"  → ingest: entry {r.get('entryId','?')[:8]} ({len(all_pages)} sayfa)", flush=True)
    print("\nGIANTS DONE", flush=True)


if __name__ == "__main__":
    main()
