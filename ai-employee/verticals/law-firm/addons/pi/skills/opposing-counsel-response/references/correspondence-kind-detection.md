# Correspondence Kind Detection Rubric

The skill detects the inbound correspondence kind from the inbound message body, subject, and metadata. Detection is mechanical: keyword matching, structural pattern matching, and metadata inspection. The skill does NOT use generative inference; the detection rubric is the contract.

## Supported kinds

The skill supports exactly three kinds:

1. `settlement_counter_offer` an inbound message proposing a settlement amount, a payment timing, or release terms in response to a prior demand or in opening of settlement discussion.
2. `motion_correspondence` an inbound message related to a motion: a meet-and-confer letter regarding a motion, a proposed order, a notice of motion, a brief in support, or a letter regarding the matter's procedural posture.
3. `scheduling_correspondence` an inbound message proposing dates: a deposition notice, a proposed stipulation regarding deadlines, a request for a continuance, a court-conference scheduling letter, or a letter regarding hearing availability.

Inbound messages outside these three kinds are out of scope. Examples of out-of-scope inbound: discovery requests (handled by `law-pi-discovery-response`), demand letters from the firm to opposing counsel (outbound, not inbound), client communications, court orders served by the court (not opposing counsel).

## Detection signals

The skill scans the inbound for three signal classes, in order:

### Signal class 1: Subject-line patterns

The subject line is the strongest signal. Subject-line patterns by kind:

| Pattern                         | Resolves to                 | Confidence                  |
| ------------------------------- | --------------------------- | --------------------------- | --------------------------- | --------------------------- | ---- |
| `(?i)settlement (counter        | offer                       | proposal                    | response)`                  | `settlement_counter_offer`  | 0.85 |
| `(?i)counter-offer`             | `settlement_counter_offer`  | 0.85                        |
| `(?i)re: demand for settlement` | `settlement_counter_offer`  | 0.80                        |
| `(?i)motion (for                | to)`                        | `motion_correspondence`     | 0.85                        |
| `(?i)meet and confer`           | `motion_correspondence`     | 0.75                        |
| `(?i)proposed order`            | `motion_correspondence`     | 0.85                        |
| `(?i)notice of motion`          | `motion_correspondence`     | 0.90                        |
| `(?i)deposition (notice         | schedule                    | of)`                        | `scheduling_correspondence` | 0.85                        |
| `(?i)scheduling`                | `scheduling_correspondence` | 0.75                        |
| `(?i)continuance`               | `scheduling_correspondence` | 0.80                        |
| `(?i)proposed stipulation`      | `scheduling_correspondence` | 0.75                        |
| `(?i)stipulation (re            | regarding) (deadline        | extension                   | continuance)`               | `scheduling_correspondence` | 0.85 |
| `(?i)hearing (date              | availability)`              | `scheduling_correspondence` | 0.80                        |

If multiple subject patterns match, the highest-confidence match wins. Subject-line confidence is capped at 0.90; the skill always corroborates with the body.

### Signal class 2: Body keyword patterns

The body scan looks for keyword patterns. Each pattern is a regex match against the inbound body text; each hit contributes a fractional confidence increment.

For `settlement_counter_offer`:

- A dollar-amount string `\$\d[\d,]{3,}` adjacent (within 20 words) to a settlement-context word (`settle`, `settlement`, `offer`, `counter`, `release`, `accept`, `pay`, `tender`): +0.30
- The phrase `(?i)full and final settlement`: +0.25
- The phrase `(?i)mutual release`: +0.20
- The phrase `(?i)counter-offer` or `counter offer` in the body: +0.20
- The phrase `(?i)without prejudice` adjacent to a settlement-context word: +0.10

For `motion_correspondence`:

- The phrase `(?i)motion (for|to) (summary judgment|dismiss|compel|strike|in limine|protective order)`: +0.40
- A docket-number string `(?i)(case|docket|no\.?)\s+[\w-]+\s+\d+`: +0.10
- The phrase `(?i)meet and confer`: +0.30
- A citation-shaped string (case name with reporter cite): +0.30 (note: this is a strong signal for motion correspondence even though the skill will not author citations)
- The phrase `(?i)hearing on the motion`: +0.20
- The phrase `(?i)proposed order`: +0.30

For `scheduling_correspondence`:

- A date string `\d{1,2}/\d{1,2}/\d{2,4}` or `\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b` adjacent (within 15 words) to a scheduling-context word (`deposition`, `hearing`, `mediation`, `conference`, `available`, `propose`, `scheduling`): +0.30
- The phrase `(?i)continuance` or `(?i)extension of time`: +0.30
- The phrase `(?i)deposition of`: +0.30
- The phrase `(?i)stipulation regarding (deadline|continuance|extension|date)`: +0.30
- The phrase `(?i)please confirm (your|the) availability`: +0.20

### Signal class 3: Document attachment patterns

EmailThread messages may have attachments. Attachment-based signals:

- An attached PDF with filename matching `(?i)proposed[_ -]order`: +0.20 to `motion_correspondence`
- An attached PDF with filename matching `(?i)(brief|memorandum)[_ -](in (support|opposition))?`: +0.20 to `motion_correspondence`
- An attached PDF with filename matching `(?i)(notice|deposition)[_ -](of|notice)`: +0.20 to `scheduling_correspondence`
- An attached PDF with filename matching `(?i)proposed[_ -]stipulation`: +0.20 to `scheduling_correspondence`
- An attached PDF with filename matching `(?i)(release|settlement[_ -]agreement)`: +0.20 to `settlement_counter_offer`

## Confidence aggregation

The skill computes per-kind confidence by:

1. Take the highest-confidence subject-line match as the starting score.
2. Add body-keyword-pattern hits to the matching kind, capped at +0.40 total.
3. Add attachment-pattern hits to the matching kind, capped at +0.20 total.
4. Confidence is clamped to [0.0, 1.0].

A kind resolves when its confidence reaches >= 0.80 AND no other kind has confidence >= 0.50 (single-kind resolution).

Two kinds resolve as `MIXED` when both confidences reach >= 0.50 (multi-kind resolution; the skill processes both in one consolidated draft).

When no kind reaches 0.50, the skill refuses with `kind_unresolvable`.

## Override path

The partner may pass `--kind <kind>` at invocation to bypass detection. Override values: `settlement_counter_offer`, `motion_correspondence`, `scheduling_correspondence`, or `mixed:<kind1>+<kind2>` for the mixed path. The override is recorded in the sourcing note as `kind_resolution_method: override`.

## Why the rubric is mechanical

Generative-inference detection is convenient but unaccountable. A mechanical detection rubric:

1. Produces consistent results across invocations (replay-stability is required for fixture-based testing).
2. Records the per-signal evidence in the sourcing note (the partner can see why the skill chose a kind).
3. Is auditable in the customer's compliance evidence packet.
4. Cannot be manipulated by adversarial inbound content beyond the partner-visible signal set.

The skill's defense in depth is the override path. When the rubric is wrong, the partner overrides at invocation; the rubric does not need to be retrained.
