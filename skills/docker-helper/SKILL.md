---
name: docker-helper
version: 0.1.0
description: Docker inspection shortcuts — ps, images, disk usage, logs tail (read-only)
author: ZHYun
tags: [docker, containers]
risk: low
triggers: [docker, container, 容器, 镜像]
commands:
  - name: ps
    description: List running containers
    command: docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    risk: low
  - name: images
    description: List local images
    command: docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
    risk: low
  - name: disk
    description: Show docker disk usage summary
    command: docker system df
    risk: low
---

# docker-helper

Read-only Docker inspection commands. The placeholder syntax `{{.Names}}` is
docker's own template format — the Tau `{args}` placeholder uses SINGLE braces
and never collides with it.

## Notes

- `docker system df` is safe: it reports sizes only.
- Cleanup commands (`system prune`, `rm`, `rmi`) are intentionally absent.
  Propose them through `tau ask` so the safety reviewer and the confirmation
  UI see them first.
