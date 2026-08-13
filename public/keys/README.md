# Evidence packet signing keys

Compliance evidence packets produced by SMDurgan, LLC carry a detached
signature over the packet manifest. This directory publishes the public half of
each signing key so that anyone holding a packet can verify it without
trusting whoever handed them the file.

That is the point of the signature: a client can give a packet to their
insurance carrier, their counsel, or an opposing party, and the recipient can
confirm the packet was produced by SMD and has not been altered since export.
Without it, the client is asking to be taken at their word about their own
evidence.

The human-readable registry of every key, current and retired, is published at
https://smd.services/trust. That page is generated from
`src/lib/trust/signing-keys.ts`, which is the authored source of truth;
`tests/trust-signing-keys.test.ts` recomputes each fingerprint from the key
committed here and fails if the two disagree. Update both together.

## Current key

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| File                      | `evidence-packet-signing-key.pem`                                  |
| URL                       | `https://smd.services/keys/evidence-packet-signing-key.pem`        |
| Algorithm                 | Ed25519                                                            |
| SHA-256 of DER public key | `64a294493be8bfed2f09c8ce83316744af0af95d19f2fc47ef48337181f98c8a` |
| Status                    | active                                                             |

## Verifying a packet

The packet manifest records a SHA-256 for every artifact, and the signature is
taken over the manifest. Verify in two steps:

```bash
# 1. the manifest covers the files
sha256sum -c manifest-checksums.txt

# 2. SMD signed that manifest
curl -sO https://smd.services/keys/evidence-packet-signing-key.pem
openssl pkeyutl -verify \
  -pubin -inkey evidence-packet-signing-key.pem \
  -rawin -in manifest.json \
  -sigfile manifest.sig
```

A `Signature Verified Successfully` result means the manifest is authentic and
unmodified. If step 1 passes and step 2 fails, the packet was altered after
export.

## What the signature does not cover

The signature attests to the packet's origin and integrity after export. It
says nothing about whether the underlying audit log is correct. Tamper evidence
_within_ the log is a separate mechanism: the audit ledger is hash chained, so
a deleted, reordered, or inserted row breaks the chain at a verifiable point.
`operator/bin/verify-audit-chain.py` walks a ledger or an exported payload and
proves the chain intact.

## Retired keys

Retired public keys stay published so packets signed under them remain
verifiable. A key is retired only if its private half is believed exposed; the
packets it signed before that date are still authentic, and the entry below
records when verification should stop being relied on.

None retired to date.
