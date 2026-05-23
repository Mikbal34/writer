"""Dual-stack uvicorn launcher: binds both 0.0.0.0:PORT (IPv4 — Fly
public proxy + health checks) AND :::PORT (IPv6 — Fly's internal 6PN
mesh that the Node worker uses via *.internal DNS). `uvicorn --host`
takes a single hostname, so the two listeners have to be created
manually and handed to one Server instance."""
import asyncio
import os
import socket

import uvicorn


async def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    sockets: list[socket.socket] = []
    for host, family in [("0.0.0.0", socket.AF_INET), ("::", socket.AF_INET6)]:
        s = socket.socket(family, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if family == socket.AF_INET6:
            # V6ONLY so the IPv6 listener doesn't fight the IPv4 one
            # for IPv4-mapped traffic — each socket owns its family.
            s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        s.bind((host, port))
        s.listen(128)
        sockets.append(s)

    config = uvicorn.Config("main:app", log_level="info")
    server = uvicorn.Server(config)
    await server.serve(sockets=sockets)


if __name__ == "__main__":
    asyncio.run(main())
