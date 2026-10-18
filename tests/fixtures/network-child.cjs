'use strict';
const assert = require('node:assert/strict');
assert.equal(process.env.AWS_SHARED_CREDENTIALS_FILE, '/dev/null');
assert.equal(process.env.AWS_CONFIG_FILE, '/dev/null');
assert.equal(process.env.AWS_ACCESS_KEY_ID, undefined);
assert.equal(process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN, undefined);
assert.throws(() => require('node:net').createConnection({ host: '127.0.0.1', port: 9 }), error => error.code === 'TEST_NETWORK_DENIED');
console.log('child-isolated');
