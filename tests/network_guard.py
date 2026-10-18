"""Install before application imports; not a production security sandbox."""
import os
import re
import socket
from pathlib import Path

for name in list(os.environ):
    if re.match(r"^AWS_(ACCESS_KEY|SECRET|SESSION|SECURITY_TOKEN|PROFILE$|DEFAULT_PROFILE$|ROLE_|WEB_IDENTITY|CONTAINER_(CREDENTIALS|AUTHORIZATION))", name):
        del os.environ[name]
os.environ.update({
    "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
    "AWS_CONFIG_FILE": "/dev/null",
    "AWS_EC2_METADATA_DISABLED": "true",
    "AWS_REGION": "us-east-1",
    "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_ENDPOINT_URL": "http://aws-test.invalid",
    "AWS_ENDPOINT_URL_DYNAMODB": "http://aws-test.invalid",
    "AWS_MAX_ATTEMPTS": "1",
})
# Python children load sitecustomize before their entrypoint, regardless of cwd.
preload = str(Path(__file__).resolve().parent)
paths = os.environ.get("PYTHONPATH", "").split(os.pathsep)
if preload not in paths:
    os.environ["PYTHONPATH"] = os.pathsep.join([preload, *filter(None, paths)])
# Node helpers launched by Python must inherit the other half of this mixed-language boundary.
node_preload = "--require=" + str(Path(__file__).with_name("network-guard.cjs").resolve())
if node_preload not in os.environ.get("NODE_OPTIONS", "").split():
    os.environ["NODE_OPTIONS"] = (os.environ.get("NODE_OPTIONS", "") + " " + node_preload).strip()


class TestNetworkDeniedError(OSError):
    """A test attempted transport outside its own listening sockets."""


if not getattr(socket, "_test_network_guard", False):
    servers = {}
    original_listen = socket.socket.listen
    original_close = socket.socket.close
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_getaddrinfo = socket.getaddrinfo

    def check(address):
        if not isinstance(address, tuple) or len(address) < 2:
            raise TestNetworkDeniedError("Test network denied: Unix socket")
        host, port = address[:2]
        if host not in ("localhost", "127.0.0.1", "::1") or int(port) not in servers.values():
            raise TestNetworkDeniedError(f"Test network denied: {host}:{port}")

    def listen(self, backlog=128):
        result = original_listen(self, backlog)
        address = self.getsockname()
        if isinstance(address, tuple):
            servers[self] = address[1]
        return result

    def close(self):
        servers.pop(self, None)
        return original_close(self)

    def connect(self, address):
        check(address)
        return original_connect(self, address)

    def connect_ex(self, address):
        check(address)
        return original_connect_ex(self, address)

    def getaddrinfo(host, port, *args, **kwargs):
        check((host, port))
        return original_getaddrinfo("127.0.0.1" if host == "localhost" else host, port, *args, **kwargs)

    def deny_datagram(self, *args, **kwargs):
        raise TestNetworkDeniedError("Test network denied: datagram")

    socket.socket.listen = listen
    socket.socket.close = close
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.socket.sendto = deny_datagram
    socket.getaddrinfo = getaddrinfo
    socket._test_network_guard = True
    socket._test_network_denied_error = TestNetworkDeniedError
else:
    TestNetworkDeniedError = socket._test_network_denied_error
