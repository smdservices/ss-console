# `smd` Customer-Zero Fixture

Synthetic fixture for `bin/tests/test_decommission.py` (issue #820).

This directory contains a minimal `customer.yaml` shaped like a real
per-customer config so the decommission pipeline has something to
operate on in tests. It is NOT a real customer:

- Never read by `bin/provision-customer.sh`
- Never gets a Fly app, R2 bucket, Vectorize index, or D1 database
- Lives under `bin/fixtures/` (not `customers/`) so it cannot be
  accidentally provisioned

The test copies this fixture into a tmp `customers/` root before each
run so the tombstone step can rename the directory without touching the
checked-in fixture.
