"""
Contract-test fixtures. READ-ONLY against live Zoho Books.

Reuses the repo-root zoho.py client. Requires these env vars (export via the
PowerShell block before running):
    ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN

These tests NEVER create, modify, or delete a live record (user constraint).
"""
import importlib.util
import os
import sys

import pytest

# Repo root = two levels up from tests/contracts/
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Pack Masters org id (matches Global Constraints in the plan).
PM = "661445520"


def _load_zoho():
    """Import zoho.py from the repo root by path (it is git-ignored, not a package)."""
    spec = importlib.util.spec_from_file_location("zoho", os.path.join(ROOT, "zoho.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def zoho():
    missing = [
        v
        for v in ("ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN")
        if not os.environ.get(v)
    ]
    if missing:
        pytest.skip(f"Zoho creds not in env: {', '.join(missing)}")
    return _load_zoho()
