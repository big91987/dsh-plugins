#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
dsh_version="${DSH_VERSION:-0.1.0-rc.6}"
probe_home="$(mktemp -d /var/tmp/dsh-plugins-probe.XXXXXX)"

cleanup() {
  case "$probe_home" in
    /var/tmp/dsh-plugins-probe.*) rm -rf -- "$probe_home" ;;
    *) printf 'Refusing to remove unexpected probe directory: %s\n' "$probe_home" >&2 ;;
  esac
}
trap cleanup EXIT

run_dsh() {
  DSH_HOME="$probe_home" pnpm dlx "@deepseek-ai/dsh@$dsh_version" "$@"
}

cd "$repository_root"
pnpm build

run_dsh plugin --profile dsh-plugins-probe add "$repository_root/plugins/dsh-worktree"
run_dsh plugin --profile dsh-plugins-probe add "$repository_root/plugins/dsh-session-coordination"

dump="$(run_dsh --profile dsh-plugins-probe --dump-config)"
printf '%s\n' "$dump"

grep -Fq '# == dsh-worktree' <<<"$dump"
grep -Fq 'name: dsh-worktree' <<<"$dump"
grep -Fq '# == dsh-session-coordination' <<<"$dump"
grep -Fq 'name: dsh-session-coordination' <<<"$dump"

run_dsh plugin --profile dsh-plugins-probe remove dsh-session-coordination
run_dsh plugin --profile dsh-plugins-probe remove dsh-worktree
