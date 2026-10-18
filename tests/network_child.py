import os
import socket

assert os.environ["AWS_SHARED_CREDENTIALS_FILE"] == "/dev/null"
assert os.environ["AWS_CONFIG_FILE"] == "/dev/null"
assert "AWS_ACCESS_KEY_ID" not in os.environ
assert "AWS_CONTAINER_AUTHORIZATION_TOKEN" not in os.environ
try:
    socket.create_connection(("127.0.0.1", 9))
except OSError as error:
    assert "Test network denied" in str(error), error
else:
    raise AssertionError("child escaped network guard")
print("child-isolated")
