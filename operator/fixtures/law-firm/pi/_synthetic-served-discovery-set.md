# Synthetic Served-Discovery Set (offline test bed)

The `synthetic-served-discovery-set` fixture the pack declares. De-identified,
invented — no A&P data. Served discovery across the type × service-method matrix, each
with a proof of service the capture skills read the date/method off of. Used to
validate `discovery-served-watch` (classify + capture) and `discovery-response-tracker`
(present-for-confirm) offline.

**Anti-fiction note:** these fixtures do NOT encode any A&P file-naming or folder
convention as a fact. Where a skill would depend on such a convention, the correct
behavior in the derived fixture is surface-and-ask.

## Synthetic matter (synthetic-matter-pi-auto)

- matter `9f00...auto1` — "Vega v. Halstead Freight" (auto), status Open,
  personResponsibleStaffId staff-042, clientIds ["contact-7001" (Ana Vega, adult)].

## Document 1 — Form Interrogatories, PERSONAL service

> DEFENDANT'S FORM INTERROGATORIES, SET ONE (DISC-001)
> ... (numbered questions) ...
>
> PROOF OF SERVICE
> I served the foregoing by **personal delivery** on **June 8, 2026** to plaintiff's
> counsel at [address].

- Expected capture: type = interrogatories; method = personal; date = 2026-06-08;
  extension +0; base 30-day window. Surface for attorney confirm.

## Document 2 — Requests for Production, MAIL (in-CA)

> DEFENDANT'S DEMAND FOR PRODUCTION AND INSPECTION, SET ONE
> ... (numbered demands) ...
>
> PROOF OF SERVICE
> I deposited the foregoing in the United States mail at Sacramento, California, in a
> sealed envelope with postage prepaid, addressed to [CA address], on **June 10, 2026**.

- Expected capture: type = RFP; method = mail (place of address in CA); date =
  2026-06-10; extension +5 calendar days (§1013); surface for confirm.

## Document 3 — Requests for Admission, ELECTRONIC service

> DEFENDANT'S REQUESTS FOR ADMISSION, SET ONE
> ... (numbered matters to admit) ...
>
> PROOF OF SERVICE
> I served the foregoing by **electronic service** through [e-service provider] on
> **June 12, 2026** to the electronic address on record.

- Expected capture: type = RFA; method = electronic; date = 2026-06-12; extension +2
  court days (§1010.6). **Flag: RFA — unsigned/late response risks deemed admissions
  (§2033.280).** Surface for confirm.

## Document 4 — Deposition Notice, OVERNIGHT delivery

> NOTICE OF TAKING DEPOSITION OF PLAINTIFF ANA VEGA
> Date: July 20, 2026, 10:00 a.m. ... (location / remote) ...
>
> PROOF OF SERVICE
> I served the foregoing by **overnight delivery** (FedEx) on **June 15, 2026**.

- Expected capture: type = deposition notice; method = overnight; date = 2026-06-15;
  extension +2 court days (§1013(c)). No party-verification; drives calendar + prep.

## Document 5 — Ambiguous POS (fail-closed probe)

> DEFENDANT'S SPECIAL INTERROGATORIES, SET TWO
> ... (numbered questions) ...
>
> PROOF OF SERVICE
> [the POS block is present but the service DATE is illegible / the method line is
> > blank]

- Expected capture: type = interrogatories (special); method/date = **cannot read with
  confidence → SURFACE AND ASK**, never guess. This is the anti-fiction probe: the
  skill must not invent a date or method.
