#!/usr/bin/env bash
# clash-verge-rev one-shot full test runner (WSL orchestrator)
# - Linux: workspace crates
# - Windows (via cmd.exe): vitest + scripts + tsc + src-tauri
#
# Usage:
#   bash scripts/run-all-tests.sh
#   bash scripts/run-all-tests.sh --skip-tauri
#   bash scripts/run-all-tests.sh --linux-only
#   bash scripts/run-all-tests.sh --windows-only

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_ROOT='D:\nexus-wsl\clash-verge-rev'
LOGDIR="${LOGDIR:-/mnt/d/nexus-wsl/test-logs}"
mkdir -p "$LOGDIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
SUMMARY="$LOGDIR/summary-wsl-$STAMP.txt"
FAIL=0
SKIP_TAURI=0
LINUX_ONLY=0
WINDOWS_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tauri) SKIP_TAURI=1 ;;
    --linux-only) LINUX_ONLY=1 ;;
    --windows-only) WINDOWS_ONLY=1 ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
  esac
  shift
done

echo "==== clash-verge-rev full tests (WSL) ===="
echo "ROOT=$ROOT"
echo "LOGDIR=$LOGDIR"
{
  echo "clash-verge-rev WSL full tests $STAMP"
  echo "ROOT=$ROOT"
} >"$SUMMARY"

run_linux_crates() {
  echo
  echo "[L] Cargo workspace crates (Linux) ..."
  local log="$LOGDIR/crates-linux-$STAMP.txt"
  export PATH="${HOME}/.cargo/bin:${PATH}"
  if ! command -v cargo >/dev/null 2>&1; then
    echo "  SKIP crates (no cargo)"
    echo "CRATES_LINUX=SKIP" >>"$SUMMARY"
    return 0
  fi
  # Prefer native Linux tree if present and looks complete; else current ROOT
  local treeroot="$ROOT"
  if [[ -d /home/r/nexus-wsl/clash-verge-rev/crates ]]; then
    treeroot=/home/r/nexus-wsl/clash-verge-rev
  fi
  (
    cd "$treeroot"
    cargo test -p clash-verge-draft -p clash-verge-limiter -p clash-verge-signal \
      -p clash-verge-logging -p clash-verge-i18n
  ) >"$log" 2>&1 || {
    echo "  FAIL crates  log=$log"
    echo "CRATES_LINUX=FAIL log=$log" >>"$SUMMARY"
    FAIL=$((FAIL + 1))
    return 0
  }
  echo "  OK   crates  log=$log"
  echo "CRATES_LINUX=OK log=$log" >>"$SUMMARY"
}

run_windows_bat() {
  echo
  echo "[W] Windows suite via run-all-tests.bat ..."
  local extra=()
  if [[ "$SKIP_TAURI" == "1" ]]; then
    extra+=(--skip-tauri)
  fi
  # Invoke the bat on the Windows path
  local bat='D:\nexus-wsl\clash-verge-rev\scripts\run-all-tests.bat'
  if ! command -v cmd.exe >/dev/null 2>&1; then
    echo "  SKIP windows suite (no cmd.exe)"
    echo "WINDOWS=SKIP reason=no-cmd" >>"$SUMMARY"
    return 0
  fi
  set +e
  cmd.exe /c "$bat ${extra[*]}" 
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "  FAIL windows suite rc=$rc"
    echo "WINDOWS=FAIL rc=$rc" >>"$SUMMARY"
    FAIL=$((FAIL + 1))
  else
    echo "  OK   windows suite"
    echo "WINDOWS=OK" >>"$SUMMARY"
  fi
}

if [[ "$WINDOWS_ONLY" != "1" ]]; then
  run_linux_crates
fi
if [[ "$LINUX_ONLY" != "1" ]]; then
  run_windows_bat
fi

echo
echo "==== SUMMARY ===="
cat "$SUMMARY"
echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "ALL GREEN  failures=0"
  echo "RESULT=ALL_GREEN" >>"$SUMMARY"
  echo "summary: $SUMMARY"
  exit 0
else
  echo "HAS FAILURES  count=$FAIL"
  echo "RESULT=FAIL count=$FAIL" >>"$SUMMARY"
  echo "summary: $SUMMARY"
  exit 1
fi
