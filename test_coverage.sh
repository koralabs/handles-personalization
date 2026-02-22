#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="$ROOT_DIR/test_coverage.report"
TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

cd "$ROOT_DIR"
node --test --experimental-test-coverage tests/compile.test.js > "$TMP_OUTPUT" 2>&1

read -r LINE_COVERAGE BRANCH_COVERAGE < <(
  grep -E "all files" "$TMP_OUTPUT" | tail -n 1 | awk -F'\\|' '{
    line=$2; branch=$3;
    gsub(/[%[:space:]]/, "", line);
    gsub(/[%[:space:]]/, "", branch);
    print line, branch;
  }'
)

if [[ -z "${LINE_COVERAGE:-}" || -z "${BRANCH_COVERAGE:-}" ]]; then
  echo "Failed to parse coverage output." >&2
  exit 1
fi

STATUS="pass"
LANGUAGE_STATUS="pass"
if awk -v line="$LINE_COVERAGE" -v branch="$BRANCH_COVERAGE" 'BEGIN { exit !((line + 0 < 90) || (branch + 0 < 90)) }'; then
  STATUS="fail"
  LANGUAGE_STATUS="fail"
fi

{
  echo "FORMAT_VERSION=1"
  echo "REPO=handles-personalization"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "THRESHOLD_LINES=90"
  echo "THRESHOLD_BRANCHES=90"
  echo "TOTAL_LINES_PCT=$LINE_COVERAGE"
  echo "TOTAL_BRANCHES_PCT=$BRANCH_COVERAGE"
  echo "STATUS=$STATUS"
  echo "SOURCE_PATHS=compile.js,compileHelpers.js"
  echo "EXCLUDED_PATHS=NON_CRITICAL_RUNTIME_PATHS:covered_by_separate_suites"
  echo "LANGUAGE_SUMMARY=nodejs:lines=$LINE_COVERAGE,branches=$BRANCH_COVERAGE,tool=node-test-coverage,status=$LANGUAGE_STATUS"
  echo
  echo "=== RAW_OUTPUT_NODE_TEST ==="
  cat "$TMP_OUTPUT"
} > "$REPORT_FILE"

if [[ "$STATUS" != "pass" ]]; then
  echo "Coverage threshold not met (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%)." >&2
  exit 1
fi

echo "Coverage threshold met (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%)."
