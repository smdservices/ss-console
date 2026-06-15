# Selector test — matter-document-review

Asserts Hermes' skill selector picks `matter-document-review` when an attorney asks to read/review/highlight a matter's documents, and does **not** misroute to a status/digest skill (which reports matter state) or to `matter-memo-on-update` (webhook-only).

## Synthetic query

> "Read the medical records on the Reyes matter and pull me the treatment timeline."

## Expected selection

`matter-document-review`

## Boundary (should NOT select this skill)

> "What's the status of the Reyes matter?" → `matter-status-responder` (state, not document content).

> "Draft the demand letter." → no skill drafts work product; if routed here, this skill **declines and surfaces** (the content ceiling), it does not draft.

## Result

Pending — verify in the next law-wedge selector simulation that "review/read/highlight the documents" queries select `matter-document-review` while "status/what's happening" queries stay with the status skills. The `description` is scoped to "reads a matter's documents and surfaces … never drafts" to claim the document-surfacing space without stealing status queries.
