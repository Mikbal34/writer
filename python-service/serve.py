"""Uvicorn launcher with N worker processes.

History: On Fly we needed dual-stack v4/v6 sockets (custom socket
binding). On Azure + Docker compose, the python container is reached
only via the internal bridge network from the web/worker containers,
so 0.0.0.0 + standard uvicorn workers is plenty.

Why workers > 1: PyMuPDF/fitz operations in extract_text_by_page hold
the GIL, so multi-cilt uploads serialized on a single uvicorn process
even though FastAPI sync routes have a threadpool. N workers = N
truly-parallel /process-url handlers, each handling its own cilt with
its own parallel-chunked Surya fan-out.
"""
import os
import uvicorn


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    workers = int(os.environ.get("UVICORN_WORKERS", "4"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        workers=workers,
        log_level="info",
    )


if __name__ == "__main__":
    main()
