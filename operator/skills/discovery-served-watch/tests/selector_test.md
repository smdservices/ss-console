# Selector Test — discovery-served-watch

Blind cross-skill selector simulation: does Hermes pick this skill when a discovery
document has just been served, and NOT for its near-neighbors?

## Synthetic query

> "A set of interrogatories was just served on the Reyes matter — classify it and capture the service date."

## Expected selection

`discovery-served-watch` — the query is about a **newly served** discovery document
that needs to be **classified** and to have its **service date + method read off the
proof of service** and surfaced. That detection-and-capture step is this skill's sole
job.

## Boundary (should NOT select this skill)

- "What's the deadline to respond to the interrogatories served on Reyes, and chase
  the late responses on the discovery we served?" → `discovery-response-tracker` (it
  presents/tracks/chases the **response deadline** across matters; this skill only
  **catches the served document and captures the input** the tracker/engine then
  uses).
- "Start the client verification for the Reyes interrogatory responses." →
  `client-verification-tracker` (the verification-signature chase, not the served-doc
  capture).
- "Stage the served requests into the matter folder for BriefPoint to draft from." →
  `discovery-response-staging`.
- "Assemble the separate statement for the motion to compel." →
  `separate-statement-assembler`.
- "Log who changed the Reyes matter." → `matter-memo-on-update`.

The near-neighbor risk is `discovery-response-tracker` (both touch the discovery
response deadline). The distinguisher: this skill fires on the **arrival of a served
document** — it classifies the type and reads the POS to **capture the input**; the
response-tracker owns the **deadline itself** (presenting it for confirm, tracking it,
chasing late/thin responses). Capture the input here; track and chase there.

## Result

Pending first blind cross-skill selector simulation on the assembled pack. The
served-document-arrival + POS-read framing is what distinguishes it from the
response-deadline tracker; the boundary queries above route to their owners with no
observed misroute in authoring review. Re-run and record the verified date when the
pack's selector suite is executed.
