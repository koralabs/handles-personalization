#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="$ROOT_DIR/test_coverage.report"
TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

cd "$ROOT_DIR"
node --test --experimental-test-coverage tests/compile.test.js > "$TMP_OUTPUT" 2>&1
cat "$TMP_OUTPUT" > "$REPORT_FILE"

read -r LINE_COVERAGE BRANCH_COVERAGE < <(
  grep -E "all files" "$TMP_OUTPUT" | tail -n 1 | awk -F'\\|' '{
    line=$2; branch=$3;
    gsub(/[%[:space:]]/, "", line);
    gsub(/[%[:space:]]/, "", branch);
    print line, branch;
  }'
)

if [[ -z "${LINE_COVERAGE:-}" || -z "${BRANCH_COVERAGE:-}" ]]; then
  echo "Failed to parse coverage output." | tee -a "$REPORT_FILE"
  exit 1
fi

awk -v line="$LINE_COVERAGE" -v branch="$BRANCH_COVERAGE" 'BEGIN {
  if (line + 0 < 90 || branch + 0 < 90) exit 1;
}' || {
  echo "Coverage threshold not met (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%)." | tee -a "$REPORT_FILE"
  exit 1
}

echo "Coverage threshold met (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%)." | tee -a "$REPORT_FILE"
