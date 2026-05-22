"""One-off: ingest Taberi's cached OCR text WITHOUT the 62 MB PDF (which
broke the edge upload). Small ocrText-only request → admin-ingest creates
the entry + chunks + embeds. Viewer PDF attached separately later."""
import json, os, time, urllib.request

APP = os.environ["APP_URL"]
ADMIN = os.environ["ADMIN_SESSION_SECRET"]
USER = os.environ["TARGET_USER_ID"]
CACHE = "/tmp/giant_AR_Taberi_TarihuRusul.pdf.json"
TITLE = "Taberi — Tarihu Rusul"

pages = json.load(open(CACHE))
print(f"cache: {len(pages)} sayfa", flush=True)

boundary = "----taberi" + str(int(time.time()))
def field(name, value):
    return f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
body = b""
body += field("userId", USER)
body += field("title", TITLE)
body += field("mode", "single")
body += field("ocrText", json.dumps(pages))
body += f"--{boundary}--\r\n".encode()
print(f"body: {len(body)/1048576:.1f} MB", flush=True)

req = urllib.request.Request(
    f"{APP}/api/library/admin-ingest", data=body, method="POST",
    headers={"x-admin-secret": ADMIN, "Content-Type": f"multipart/form-data; boundary={boundary}"},
)
with urllib.request.urlopen(req, timeout=5 * 60) as resp:
    print("ingest →", resp.read().decode()[:200], flush=True)
