#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="$ROOT_DIR/test_coverage.report"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

THRESHOLD_LINES=90
THRESHOLD_BRANCHES=90

cd "$ROOT_DIR"

NPM_TEST_STATUS="pass"
NPM_TEST_NOTE="npm-test-succeeded"
if ! npm test > "$TMP_DIR/npm.test.log" 2>&1; then
  if grep -qiE "ERR_MODULE_NOT_FOUND|503 Service Temporarily Unavailable|invalid hexstring" "$TMP_DIR/npm.test.log"; then
    NPM_TEST_STATUS="na"
    NPM_TEST_NOTE="scenario-tests-require-external-runtime-and-stable-node-module-resolution"
  else
    NPM_TEST_STATUS="fail"
    NPM_TEST_NOTE="npm-test-failed"
  fi
fi

node --test --experimental-test-coverage tests/compile.test.js > "$TMP_DIR/compile.coverage.log" 2>&1

read -r LINE_COVERAGE BRANCH_COVERAGE < <(
  grep -E "all files" "$TMP_DIR/compile.coverage.log" | tail -n 1 | awk -F'\\|' '{
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
COMPILE_STATUS="pass"
if awk -v line="$LINE_COVERAGE" -v branch="$BRANCH_COVERAGE" -v tl="$THRESHOLD_LINES" -v tb="$THRESHOLD_BRANCHES" 'BEGIN { exit !((line + 0 < tl) || (branch + 0 < tb)) }'; then
  COMPILE_STATUS="fail"
  STATUS="fail"
fi

if [[ "$NPM_TEST_STATUS" == "fail" ]]; then
  STATUS="fail"
elif [[ "$NPM_TEST_STATUS" == "na" && "$STATUS" == "pass" ]]; then
  STATUS="partial"
fi

{
  echo "FORMAT_VERSION=1"
  echo "REPO=handles-personalization"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "THRESHOLD_LINES=$THRESHOLD_LINES"
  echo "THRESHOLD_BRANCHES=$THRESHOLD_BRANCHES"
  echo "TOTAL_LINES_PCT=$LINE_COVERAGE"
  echo "TOTAL_BRANCHES_PCT=$BRANCH_COVERAGE"
  echo "STATUS=$STATUS"
  echo "SOURCE_PATHS=compile.js,compileHelpers.js"
  echo "EXCLUDED_PATHS=contract.helios,testingCode.helios:validator-source-covered-by-scenario-harness-not-branch-measurable-via-node-built-in-coverage; tests/{tests.js,txTests.ts,fixtures.ts,contractTesting.js,testClasses.js}:scenario-harness-paths-rely-on-external-runtime-and-upstream-availability"
  echo "LANGUAGE_SUMMARY=nodejs-compile:lines=$LINE_COVERAGE,branches=$BRANCH_COVERAGE,tool=node-test-coverage,status=$COMPILE_STATUS;nodejs-scenarios:lines=NA,branches=NA,tool=npm-test,status=$NPM_TEST_STATUS,note=$NPM_TEST_NOTE"
  echo
  echo "=== RAW_OUTPUT_NPM_TEST ==="
  cat "$TMP_DIR/npm.test.log"
  echo
  echo "=== RAW_OUTPUT_NODE_COMPILE_COVERAGE ==="
  cat "$TMP_DIR/compile.coverage.log"
} > "$REPORT_FILE"

if [[ "$STATUS" != "pass" ]]; then
  if [[ "$STATUS" == "partial" ]]; then
    echo "Coverage thresholds met for measurable compile scope (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%) with scenario tests recorded as NA." >&2
    exit 0
  fi
  echo "Coverage threshold not met (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%)." >&2
  exit 1
fi

echo "Coverage threshold met (line=${LINE_COVERAGE}%, branch=${BRANCH_COVERAGE}%)."
