#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
probe_home="$(mktemp -d "${TMPDIR:-/tmp}/dsh-plugins-probe.XXXXXX")"

cleanup() {
  case "$probe_home" in
    "${TMPDIR:-/tmp}"/dsh-plugins-probe.*) rm -rf -- "$probe_home" ;;
    *) printf 'Refusing to remove unexpected probe directory: %s\n' "$probe_home" >&2 ;;
  esac
}
trap cleanup EXIT

run_dsh() {
  DSH_HOME="$probe_home" node "$repository_root/node_modules/@deepseek-ai/dsh/lib/bin.js" "$@"
}

cd "$repository_root"
pnpm build

run_dsh web --dump-config >/dev/null
plugins=(dsh-worktree dsh-session-coordination dsh-compact-img dsh-project-task-board dsh-browser-preview)
for plugin in "${plugins[@]}"; do
  run_dsh plugin --profile web add "$repository_root/plugins/$plugin"
done

dump="$(run_dsh web --dump-config)"
for plugin in "${plugins[@]}"; do
  grep -Fq "# == $plugin" <<<"$dump"
  grep -Fq "name: $plugin" <<<"$dump"
done
# Do not print composed config: an existing profile may contain credentials.
printf '%s\n' 'five-plugin configuration probe passed'

for plugin in "${plugins[@]}"; do
  run_dsh plugin --profile web remove "$plugin"
done
