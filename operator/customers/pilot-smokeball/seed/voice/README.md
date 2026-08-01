# Demo voice corpus — Brannock & Ferreira LLP (fictional) — REHEARSAL ONLY

Staging voice assets for the work-product drafting lane on this rehearsal seat.

## The corpus

- `01-*.md` through `13-*.md` — the fictional demonstration corpus (13
  documents, two signatories, five audience classes).

## The spec that ships (ADR 0083)

- `spec/work_product.voice.md` — **the artifact to install.** A derived spec
  carrying zero sentences from the corpus, produced by the highest-scoring of
  four independently-proposed representations in the 2026-08-01 offline
  bake-off. It goes into the seat's vault object as the `work_product` class's
  `voice` body, where the applier installs it root-owned and the drafting lane
  reads it before composing.

  Scored 93.7 against a verbatim-exemplar control at 85.8 and a no-spec floor
  at 46.2, three of three blind judges answering yes to "would a partner
  recognize this." Leak check: zero findings against all 13 documents. Two
  independent instruments rank it both best and cleanest
  (`vfy_01KYZMNX6Z6AN0QE8HKNX8VZPA`).

## The two superseded artifacts, kept as evidence

Neither should be installed on any seat. They stay because the leak check is
calibrated against them and because they are the empirical case for why a
compiler exists rather than an instruction.

- `voice-profile.md` — the exemplar-based profile. Built around 38 verbatim
  sentences lifted from the corpus. **85 leak findings.** Superseded by the
  Captain's no-verbatim ruling, 2026-08-01.
- `drafting-voice-spec.md` — a production-rule spec authored by an agent told
  to characterize rather than copy, which embedded verbatim shapes anyway: its
  line 55 is byte-identical to `01-demand-mva-duarte.md` line 58. **14 leak
  findings.** This file is the reason the leak check is a compiler and not a
  paragraph in a prompt.

## What the 2026-07-28 prove-out showed, and what it did not

Seven of eight traits register-modulate, zero corpus leakage into drafted
documents, voiced output 24% shorter at budget parity
(`venturecrane/engagements` `ashton-price/prove-out/EVIDENCE.md`). That measured
the EXEMPLAR spec. The 2026-08-01 bake-off measured the representation itself
and found the exemplars were the weaker half of it.

## Never seed this voice onto a client seat

A client seat's voice is derived from that firm's own writing, read in place
through the authorized connector, and approved by them before it applies. This
corpus exists so the chain can be exercised without borrowing any real firm's
writing.

**Installation is via the vault object `vaults/pilot-smokeball/output-classes.json`,
authored through the portal** — not the retired `voice/samples/` prefix, which
belonged to the sample-transform mechanism ADR 0083 removed. Seeding there today
primes nothing, because the spec loader resolves from the root-owned manifest.
See `operator/grading/drafting-lane-rehearsal.md` setup step 2.
