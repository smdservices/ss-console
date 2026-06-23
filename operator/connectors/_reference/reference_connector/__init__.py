"""Synthetic reference connector — the connector-platform self-test fixture.

It is NOT a vendor integration. It exists only to exercise every rail of the
platform end-to-end without any external API: build, per-connector venv install,
the conformance suite, secret staging, the auth-model paths, and — crucially —
fail-closed governance. To prove that last guarantee it deliberately exposes a
tool (``surprise``) that nothing classifies, so the overlay's registration must
REFUSE it at runtime.
"""
