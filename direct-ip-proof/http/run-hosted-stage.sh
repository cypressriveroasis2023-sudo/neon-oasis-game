#!/usr/bin/env bash
# PROPOSED hosted-only execution; do not start Docker/PostgreSQL locally.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'GitHub-hosted execution only' >&2; exit 2; }
[[ "${DIRECT_IP_PROOF_POSTGRES:-}" == 1 ]] || { echo 'Missing hosted PostgreSQL approval gate' >&2; exit 2; }
[[ "${DIRECT_IP_PROOF_HTTP:-}" == 1 ]] || { echo 'Missing hosted HTTP approval gate' >&2; exit 2; }
cd "$(dirname "$0")/.."
image='postgrest/postgrest:v14.5@sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9'
container='direct-ip-proof-postgrest'
# All database names, addresses, keys and roles are fixed public fixture values.
# Never consume an ambient SUPABASE_URL, token, DB URL, production secret or input.
node http/prepare-fixture.mjs
started=0
cleanup() {
  if [[ "$started" == 1 ]]; then
    docker logs "$container" > http/postgrest-container.generated.log 2>&1 || true
    docker rm -f "$container" >/dev/null || true
  fi
}
trap cleanup EXIT
# Official image pinned to its reviewed immutable multi-platform index digest.
# Also record the resolved digest and actual executable version as runtime evidence.
docker pull "$image"
docker image inspect "$image" --format '{{json .RepoDigests}}' > http/postgrest-image-digests.generated.json
docker run --rm --network none "$image" --version > http/postgrest-version.generated.txt
# This service talks only to the ephemeral PostgreSQL service on the runner's
# loopback port. Server HTTP is loopback-only; no provider endpoint is contacted.
docker run --detach --name "$container" --network host --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 --memory 512m \
  -e PGRST_DB_URI='postgresql://direct_ip_http_authenticator:synthetic-ci-only@127.0.0.1:5432/direct_ip_proof' \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_EXTRA_SEARCH_PATH='' \
  -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_DB_CONFIG=false \
  -e PGRST_DB_POOL=3 \
  -e PGRST_DB_TX_END=commit-allow-override \
  -e PGRST_JWT_SECRET='direct-ip-proof-public-ci-key-20261014-not-a-secret' \
  -e PGRST_JWT_ROLE_CLAIM_KEY='.role' \
  -e PGRST_SERVER_HOST=127.0.0.1 \
  -e PGRST_SERVER_PORT=3000 \
  -e PGRST_OPENAPI_MODE=follow-privileges \
  -e PGRST_LOG_LEVEL=info \
  "$image" > http/postgrest-container-id.generated.txt
started=1
node --import tsx http/run-postgrest-proof.mjs
