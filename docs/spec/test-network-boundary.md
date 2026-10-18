# Test network boundary

## Failure, cause and correction

Tests previously inherited workstation AWS credential/config sources and unrestricted transport. An incomplete DynamoDB or HTTP fake could therefore contact a real service. The upstream condition was SDK/application imports before isolation. Early runner preloading fixes that root cause; it is not a production security sandbox. No validator, contract setting, transaction builder or deployment behavior changes.

`npm test` uses `python3 run_tests.py` before the Node test command. Python installs `tests/network_guard.py` before discovery; the inventory test also installs it before its application import, and `conftest.py` handles pytest collection. Node preloads `tests/network-guard.cjs` before all test workers. There is no Jest runner.

Both guards remove AWS credential/profile/role/container sources, redirect shared files to `/dev/null`, disable metadata and select `.invalid` endpoints. HTTP/HTTPS/TCP/TLS/Unix socket transport is denied except loopback servers created by the same process, revoked on close; Node fetch is guarded too. Absolute inherited Node preload and Python `sitecustomize` paths isolate children even from different working directories. This mixed-language suite also sets Python preload from Node and Node preload from Python; explicit cross-language child cases prove both directions.

Real DynamoDB SDK regression cases prove unavailable credentials and explicit fake-credential transport denial. Node and Python cases cover raw transports, real local-server success and revocation, and child inheritance. Python inventory uses standard-library HTTP, so no extra Python SDK dependency is introduced; the application's AWS clients are JavaScript and covered by real SDK tests. Each test records its invariant and negative control; existing assertions are unchanged.

The native Aiken compiler is not a Node/Python interpreter and is outside these monkey-patched transports. Its compiler dependency checks are separate from application SDK/HTTP tests. The test guard is not an operating-system sandbox.

## Evidence and preserved ownership

- Clean primary checkout on local master9797d80, ahead5/behind1. All five local offline-signing/docs/mode commits preserved on master unchanged. Parent notified. Exact non-tracking `agent` created from fetched `origin/master`c1e2337.
- Local Node22.23.2 standalone SDK/transport guard5, Python guard4, full Node144 and Python16 passed, zero skips.
- Aikenv1.1.22 compiler downloaded from its pinned release and SHA256 verified. Full suite ran with compiler present, so no compiler tests were skipped. Generated compiler lock timestamp was saved under `tmp/` and restored; no contract or lock changes included.
- No TypeScript source inputs or TypeScript edits exist in this runner change; relevant JavaScript/Python parsing and behavior execute in full tests.
- Added PR unit workflow with Node22/Python3.12 and pinned Aiken; no browsers or transaction submission. Existing deployment-plan workflow is unchanged.
- Raw logs in ignored `tmp/{python-guard,node-guard,full}.log`. No AWS probes or deployment.

## Sequential checkpoint

Completed with green PR CI/no-deploy merges: Auth PR151 e1c459f886584295ff662d7a125edf1756358d3a; chat PR21 3c55fff6c0ca2be2479b78eae4ae164a13aa9f61; databases PR17 a05d34bc91d3733b8794080d45ff4ea44afc79fb; cloudwatch PR2 cd5b49452b5b580d7ef4b6b50e27009d05ec25b1; bot PR2 070df8df7409e7c772734b2756bfc9f1190a54a9; docs PR127 ec8496768f58ebde208b34b5760ec880d6c89e3a; HAL PR291 e336eb1fa9e4ee23d301de517e1009e4a99655ee; render PR54 84921db978ecba6c9e35f1bbc4a4f8bf7f5dd5c1. Personalization implementation/local validation complete, PR/CI/merge pending. This is the final requested repository. Common is separately owned; Merch/Mint were not edited.
