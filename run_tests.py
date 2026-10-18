"""Canonical guarded unittest entrypoint."""
from tests import network_guard
import sys
import unittest

suite = unittest.defaultTestLoader.discover(".")
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
