# Discovery Served Watch — Output Format

Derived from the pack's capture/surface discipline
(`ca-served-discovery-capture-spec.md` §3–4) and the shared assembler principle that
**every value is traceable to a read** (`_shared-assembler-output-format.md`). This
skill surfaces a **captured input**; it never authors content and never emits a final
deadline. The situation determines the shape.

Every capture is keyed to `(matter, served-document, type)`.

## Shape A — Captured & surfaced for attorney confirm (rog / RFP / RFA)

```markdown
# Served Discovery — <type> — <matter descriptor> — matter <id> — YYYY-MM-DD

**Matter:** matched by case name + number — <case name>, <number>
**Type:** <interrogatories | requests for production | requests for admission>
**Service (read off the proof of service):** <date> by <method> — POS located at <page/section>, quoted below
**Response verification required?** <Yes, unless objections-only (§2030.250 / §2031.250 / §2033.240)>
**Deadline:** <the rules engine's date is to be read and confirmed> OR
<proposed, confirm — base 30 days (§2030.260 / §2031.260 / §2033.250) + <method extension, §1013 / §1010.6>; NOT final>

## Proof of service (as read)

> <the POS text located and read — the source of the date + method; nothing inferred>

## Surfaced to <responsible attorney> (confirm task)

> Served <type> captured on <case>. Service <date> by <method> (POS located).
> Confirm the type, service date, and method so the deadline is set. <RFA: flag deemed-admissions exposure.>

## Internal log (create_memo body)

> Captured served <type> on matter <id>: service <date> by <method>, read off the POS.
> Surfaced to <attorney> to confirm. Deadline owned by the rules engine / confirmed by hand; not computed here.
```

## Shape B — Deposition notice captured (calendar + prep, not a response clock)

```markdown
# Served Discovery — Deposition Notice — <matter descriptor> — matter <id> — YYYY-MM-DD

**Type:** deposition notice — **no party response-verification**; drives calendar + prep
**Read off the notice:** deponent <name/role>, date/time <...>, place/remote <...>
**Decision:** surfaced for scheduling and prep; this is not a response-verification and starts no response clock.

## Internal log (create_memo body)

> Captured a deposition notice on matter <id> (deponent <...>, <date/place>). Surfaced for calendar + prep.
```

## Shape D — Surface & ask (fail-closed: cannot read / classify / match)

```markdown
# ⚠ Served Discovery — needs a human — matter <id> — YYYY-MM-DD

**Situation:** <proof of service missing / illegible / blank / ambiguous date or method
| discovery type unclear | inbound document matches no matter / ambiguous match>
**What was readable:** <only the facts actually read — never a filled-in guess>
**Decision:** surfaced for a person. Nothing captured as fact, nothing calendared. The
service date/method/type is not guessed.
```

## Rules

1. **Shape A/B carry only captured facts** — the type and the service date + method,
   each read off the document (the POS for date/method). No value is inferred from a
   postmark, an email header, or the document body's own claims.
2. **The deadline is never final here.** Shape A shows either "engine's date to be
   read and confirmed" or a "proposed, confirm" base window with the statute cited —
   never a silently calendared or asserted-final date.
3. **An unreadable POS, an unclear type, or an unmatched matter is Shape D** — surface
   and ask; never a guessed date, method, type, or matter.
4. **No response is drafted and no request is characterized** anywhere.
5. Statutes cited come **only** from the capture spec's verified set (§2030.250 /
   §2031.250 / §2033.240; §2030.260 / §2031.260 / §2033.250; §1013 / §1010.6;
   §2033.280 for RFA). Never invent a section number.
6. The captured input and its source are always stated, so the capture is auditable.
