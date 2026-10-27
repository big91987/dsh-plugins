#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
accept_root=$(mktemp -d "${TMPDIR:-/tmp}/dsh-session-coordination.XXXXXX")
server_pid=

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$accept_root"
}
trap cleanup EXIT INT TERM

cd "$repository_root"
node scripts/test.mjs plugins/dsh-session-coordination/tests
pnpm --filter dsh-session-coordination typecheck
pnpm --filter dsh-session-coordination build

DSH_HOME="$accept_root" node "$repository_root/node_modules/@deepseek-ai/dsh/lib/bin.js" web --dump-config >/dev/null
DSH_HOME="$accept_root" node "$repository_root/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web add "$repository_root/plugins/dsh-session-coordination"
config=$(DSH_HOME="$accept_root" node "$repository_root/node_modules/@deepseek-ai/dsh/lib/bin.js" web --dump-config)
printf '%s\n' "$config" | grep -Fq 'name: dsh-session-coordination'
if printf '%s\n' "$config" | grep -Fq 'name: dsh-worktree'; then
  echo 'unexpected dsh-worktree dependency in isolated profile' >&2
  exit 1
fi

DSH_HOME="$accept_root" node "$repository_root/node_modules/@deepseek-ai/dsh/lib/bin.js" web --host 127.0.0.1 --port 31881 >"$accept_root/server.log" 2>&1 &
server_pid=$!
attempt=0
while ! grep -Fq 'dsh web: http://127.0.0.1:31881' "$accept_root/server.log"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    printf '%s\n' 'Isolated DSH did not start; inspect the private acceptance log.' >&2
    exit 1
  fi
  sleep 0.1
done

kill "$server_pid"
wait "$server_pid" 2>/dev/null || true
server_pid=
printf '%s\n' 'dsh-session-coordination acceptance passed'
