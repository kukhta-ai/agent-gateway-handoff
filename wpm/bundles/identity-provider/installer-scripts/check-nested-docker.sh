#!/usr/bin/env bash
# check-nested-docker.sh — decide the authentik OWNERSHIP MODE for THIS host (identity-provider · GLA-074).
#
# authentik ships as a multi-container Compose stack (server + worker + PostgreSQL [+ Redis]) and needs a
# WORKING container storage driver + persistent volumes. Inside the hermes-1 GLA container, nested Docker has a
# BROKEN storage driver (`FAIL: unknown driver 'overlayfs'`) — a Compose stack will fail partway at overlayfs.
# This probe decides whether a Managed in-container standup is even attemptable here, so the setup step never
# starts an install that cannot succeed (authentik-service-standup.md §1/§8.1, install-backlog task -4 AC#4 / -5 AC#8).
#
# OUTPUT (stdout, last line, machine-readable):
#   NESTED_DOCKER_OK       — a Compose stack CAN run here → Managed-in-container is viable (a non-hermes-1 target).
#   NESTED_DOCKER_BROKEN   — the storage driver is broken / Docker unusable here → do NOT attempt Managed; drive
#                            adopt-at-host (Local-External) or Remote-External instead.
# EXIT: 0 if OK, 1 if BROKEN/unusable (so a caller can branch on the exit code too).
#
# This is a DETECTION probe — it changes nothing (it does not pull images or create containers).

set -u

emit() { echo "$1"; }

# 1) Is a docker CLI present and a daemon reachable at all?
if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI not found — no in-container Docker here." >&2
  emit "NESTED_DOCKER_BROKEN"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker daemon not reachable (docker info failed) — cannot run a Compose stack here." >&2
  emit "NESTED_DOCKER_BROKEN"
  exit 1
fi

# 2) Inspect the storage driver. overlay2 on a working backing fs is fine; the broken nested case reports an
#    unusable/unknown driver (e.g. 'overlayfs') or errors. Read it from `docker info`.
DRIVER="$(docker info --format '{{.Driver}}' 2>/dev/null || echo '')"
echo "docker storage driver: '${DRIVER:-<none>}'" >&2

case "$DRIVER" in
  overlay2|btrfs|zfs|fuse-overlayfs)
    # A known-good driver. Best-effort confirm the daemon can actually create a layer (a tiny no-pull check):
    # `docker info` already succeeded and reports a usable driver — treat as OK. (We deliberately do NOT pull an
    # image here; that is the setup step's job once the mode is chosen.)
    emit "NESTED_DOCKER_OK"
    exit 0
    ;;
  overlayfs|vfs|"")
    # 'overlayfs' (the broken nested-LXD report) / vfs (no real layering) / empty → not viable for a real stack.
    echo "storage driver '${DRIVER:-<none>}' cannot back a reliable Compose stack here (the hermes-1 nested-Docker case)." >&2
    emit "NESTED_DOCKER_BROKEN"
    exit 1
    ;;
  *)
    # An unrecognized driver — be conservative: do not claim Managed is viable on an unknown driver.
    echo "unrecognized storage driver '${DRIVER}' — treating Managed-in-container as NOT proven; prefer adopt/remote." >&2
    emit "NESTED_DOCKER_BROKEN"
    exit 1
    ;;
esac
