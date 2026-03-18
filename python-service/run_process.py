"""
Lightweight standalone server for the /process endpoint.
Avoids importing modules that require Python 3.10+ syntax.
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.process import router as process_router
from routers.embed import router as embed_router

app = FastAPI(title="Writer Agent Process Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(process_router)
app.include_router(embed_router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "writer-agent-process"}


if __name__ == "__main__":
    uvicorn.run("run_process:app", host="0.0.0.0", port=8001, reload=True)
