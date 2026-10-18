from tests import network_guard
import os
import socket
import ssl
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.request import urlopen

assert os.environ["AWS_SHARED_CREDENTIALS_FILE"] == "/dev/null"
assert os.environ["AWS_CONFIG_FILE"] == "/dev/null"
assert os.environ.get("AWS_ACCESS_KEY_ID") is None
assert os.environ["AWS_EC2_METADATA_DISABLED"] == "true"


class NetworkGuardTests(unittest.TestCase):
    # Invariant: inventory Python HTTP/TCP/TLS cannot reach remote or unowned local servers.
    # Removing transport checks permits a connection attempt rather than the guard error.
    def test_transports_denied(self):
        for url in ("http://169.254.169.254/", "https://dynamodb.us-east-1.amazonaws.com/"):
            with self.subTest(url=url), self.assertRaisesRegex(OSError, "Test network denied"):
                urlopen(url, timeout=1)
        with socket.socket() as sock:
            with self.assertRaisesRegex(OSError, "Test network denied"):
                sock.connect(("127.0.0.1", 9))
        with ssl.create_default_context().wrap_socket(socket.socket(), server_hostname="localhost") as sock:
            with self.assertRaisesRegex(OSError, "Test network denied"):
                sock.connect(("127.0.0.1", 9))
        with socket.socket(socket.AF_UNIX) as sock:
            with self.assertRaisesRegex(OSError, "Test network denied"):
                sock.connect("/must-not-connect")

    # Invariant: only this process's real test server is allowed, until close.
    # Missing registration breaks success; arbitrary-loopback allowance breaks revocation.
    def test_owned_server_and_revocation(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"owned-test-server")

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/"
        try:
            with urlopen(url, timeout=1) as response:
                self.assertEqual(response.read(), b"owned-test-server")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        with self.assertRaisesRegex(OSError, "Test network denied"):
            urlopen(url, timeout=1)

    # Invariant: children inherit early isolation independently of cwd and leaked credential input.
    # Removing inherited PYTHONPATH makes the child's credential assertions fail.
    def test_child_inherits(self):
        fixture = Path(__file__).with_name("network_child.py").resolve()
        result = subprocess.run([sys.executable, str(fixture)], cwd=fixture.parent,
                                env={**os.environ, "AWS_ACCESS_KEY_ID": "fake-leak",
                                     "AWS_SHARED_CREDENTIALS_FILE": "/must-not-read",
                                     "AWS_CONTAINER_AUTHORIZATION_TOKEN": "fake-leak"},
                                check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout.strip(), "child-isolated")

    # Invariant: a Node helper launched from a Python test inherits the Node boundary too.
    # Removing the cross-language NODE_OPTIONS preload fails the child's isolation assertions.
    def test_node_child_inherits(self):
        fixture = Path(__file__).with_name("fixtures") / "network-child.cjs"
        result = subprocess.run(["node", str(fixture.resolve())], cwd=fixture.parent,
                                env={**os.environ, "AWS_ACCESS_KEY_ID": "fake-leak",
                                     "AWS_SHARED_CREDENTIALS_FILE": "/must-not-read",
                                     "AWS_CONTAINER_AUTHORIZATION_TOKEN": "fake-leak"},
                                check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout.strip(), "child-isolated")
