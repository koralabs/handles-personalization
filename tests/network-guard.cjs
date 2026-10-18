'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const path = require('node:path');

// Install before application/SDK imports, in every Jest worker and Node test child.
for (const name of Object.keys(process.env)) {
    if (/^AWS_(ACCESS_KEY|SECRET|SESSION|SECURITY_TOKEN|PROFILE$|DEFAULT_PROFILE$|ROLE_|WEB_IDENTITY|CONTAINER_(CREDENTIALS|AUTHORIZATION))/.test(name)) delete process.env[name];
}
process.env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
process.env.AWS_CONFIG_FILE = '/dev/null';
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ENDPOINT_URL = 'http://aws-test.invalid';
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://aws-test.invalid';
process.env.AWS_MAX_ATTEMPTS = '1';
const preload = `--require=${path.resolve(__filename)}`;
if (!(process.env.NODE_OPTIONS || '').split(/\s+/).includes(preload)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${preload}`.trim();

// This mixed-language suite also launches Python helpers from Node tests.
const pythonPreload = path.resolve(__dirname);
if (!(process.env.PYTHONPATH || '').split(path.delimiter).includes(pythonPreload)) process.env.PYTHONPATH = [pythonPreload, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);

const installed = Symbol.for('minting.test.networkGuard');
if (!net[installed]) {
    const ports = new Set();
    class TestNetworkDeniedError extends Error {
        constructor(host, port) {
            super(`Test network denied: ${host}:${port}; only this process's loopback test servers are allowed`);
            this.code = 'TEST_NETWORK_DENIED';
        }
    }
    const check = (host, port) => {
        const normalized = String(host || 'localhost').replace(/^\[|\]$/g, '');
        if (!['localhost', '127.0.0.1', '::1'].includes(normalized) || !ports.has(Number(port))) throw new TestNetworkDeniedError(normalized, port);
    };
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) {
        this.prependOnceListener('listening', () => {
            const address = this.address();
            if (address && typeof address !== 'string') {
                ports.add(address.port);
                this.once('close', () => ports.delete(address.port));
            }
        });
        return listen.apply(this, args);
    };
    const close = net.Server.prototype.close;
    net.Server.prototype.close = function (...args) {
        const address = this.address();
        if (address && typeof address !== 'string') ports.delete(address.port);
        return close.apply(this, args);
    };
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
        let options = Array.isArray(args[0]) ? args[0][0] : args[0];
        if (typeof options !== 'object') options = { port: options, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
        if (options.path) throw new TestNetworkDeniedError('unix-socket', options.path);
        check(options.host || options.hostname, options.port);
        // A custom DNS resolver must not turn an allowed localhost name into a remote address.
        if ((options.host || options.hostname) === 'localhost') options.host = '127.0.0.1';
        return connect.apply(this, args);
    };
    const requestCheck = (args, defaultPort) => {
        const first = args[0];
        const options = typeof first === 'string' || first instanceof URL ? new URL(first) : first;
        check(options.hostname || options.host, options.port || defaultPort);
    };
    for (const [module, port] of [[http, 80], [https, 443]]) {
        for (const name of ['request', 'get']) {
            const original = module[name];
            module[name] = function (...args) { requestCheck(args, port); return original.apply(this, args); };
        }
    }
    const tlsConnect = tls.connect;
    tls.connect = function (...args) {
        const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
        check(options.host || options.hostname, options.port || 443);
        return tlsConnect.apply(this, args);
    };
    net[installed] = { check };
    require('node:module').syncBuiltinESMExports();
}
// Jest has a fresh global realm per suite, but shares the process's built-in socket modules.
const fetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    try { net[installed].check(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80)); }
    catch (error) { return Promise.reject(error); }
    return fetch(input, init);
};
