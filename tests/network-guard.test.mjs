import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';


// Abort module evaluation before application imports if credential isolation did not install.
assert.equal(process.env.AWS_SHARED_CREDENTIALS_FILE, '/dev/null');
assert.equal(process.env.AWS_CONFIG_FILE, '/dev/null');
assert.equal(process.env.AWS_ACCESS_KEY_ID, undefined);
assert.equal(process.env.AWS_SECRET_ACCESS_KEY, undefined);
assert.equal(process.env.AWS_SESSION_TOKEN, undefined);
assert.equal(process.env.AWS_PROFILE, undefined);
assert.equal(process.env.AWS_EC2_METADATA_DISABLED, 'true');
assert.equal(process.env.AWS_ENDPOINT_URL_DYNAMODB, 'http://aws-test.invalid');


// Invariant: no unfaked SDK client can discover workstation credentials or contact a real service.
// Catches an SDK operation escaping an incomplete test boundary fake.
// Negative control: removing credential isolation lets this resolve the workstation's default profile;
// removing the socket/HTTP deny lets the explicit fake-credential client attempt its non-test endpoint.
test('unfaked Dynamo clients fail without network', async () => {
    const unfaked = new DynamoDBClient({ region: 'us-east-1' });
    try {
        await assert.rejects(unfaked.send(new GetItemCommand({ TableName: 'unit-test-only', Key: { pk: { S: 'never-read' } } })), /Could not load credentials/);
    } finally { unfaked.destroy(); }
    const client = new DynamoDBClient({ region: 'us-east-1', endpoint: 'http://127.0.0.1:9', credentials: { accessKeyId: 'unit-test', secretAccessKey: 'unit-test' }, maxAttempts: 1 });
    try {
        await assert.rejects(client.send(new GetItemCommand({ TableName: 'unit-test-only', Key: { pk: { S: 'never-read' } } })), /Test network denied/);
    } finally { client.destroy(); }
});

// Invariant: HTTP, fetch, TLS and raw TCP cannot bypass the process-wide denial.
// Removing any corresponding guard changes the error or permits an attempted connection.
test('denies remote HTTP and unowned loopback TCP/TLS', async () => {
    const denied = error => error.code === 'TEST_NETWORK_DENIED';
    assert.throws(() => http.get('http://dynamodb.us-east-1.amazonaws.com/'), denied);
    assert.throws(() => https.request('https://dynamodb.us-east-1.amazonaws.com/'), denied);
    assert.throws(() => net.createConnection({ host: '127.0.0.1', port: 9 }), denied);
    assert.throws(() => tls.connect({ host: '127.0.0.1', port: 9 }), denied);
    await assert.rejects(fetch('https://dynamodb.us-east-1.amazonaws.com/'), denied);
});

// Invariant: Node subprocesses inherit credential and transport denial, not workstation access.
// Removing the inherited preloader makes the child's pre-network environment assertions fail.
test('inherits denial into Node subprocesses', () => {
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/network-child.cjs', import.meta.url))], { encoding: 'utf8', cwd: fileURLToPath(new URL('./fixtures/', import.meta.url)), env: { ...process.env, AWS_SHARED_CREDENTIALS_FILE: '/must-not-read', AWS_ACCESS_KEY_ID: 'fake-leak', AWS_CONTAINER_AUTHORIZATION_TOKEN: 'fake-leak' } });
    assert.equal(output.trim(), 'child-isolated');
});

// Invariant: only a loopback test server opened in this process is reachable, until it closes.
// Removing server registration denies the valid request; allowing arbitrary loopback fails the closed-port check.
test('allows owned loopback servers and revokes them on close', async () => {
    const server = http.createServer((_req, response) => response.end('owned-test-server'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/`;
    try { assert.equal(await (await fetch(url)).text(), 'owned-test-server'); }
    finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    await assert.rejects(fetch(url), error => error.code === 'TEST_NETWORK_DENIED');
});

// Invariant: a Python helper launched from a Node test inherits the Python boundary too.
// Removing the cross-language PYTHONPATH preload fails the child's environment/transport assertions.
test('inherits denial into Python helpers launched from Node', () => {
    const fixture = fileURLToPath(new URL('./network_child.py', import.meta.url));
    const output = execFileSync('python3', [fixture], { encoding: 'utf8', cwd: fileURLToPath(new URL('./fixtures/', import.meta.url)), env: { ...process.env, AWS_ACCESS_KEY_ID: 'fake-leak', AWS_SHARED_CREDENTIALS_FILE: '/must-not-read', AWS_CONTAINER_AUTHORIZATION_TOKEN: 'fake-leak' } });
    assert.equal(output.trim(), 'child-isolated');
});
