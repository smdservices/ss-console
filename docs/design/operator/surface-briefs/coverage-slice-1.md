# Surface Brief — Coverage slice 1 (blueprint §4 gaps, part A)

Cites: [05-console-blueprint.md](../05-console-blueprint.md) (LOCKED 2026-07-14)
§4 coverage contract + §8 slice 1.
Status: built 2026-07-14. Read-only additions to three existing shared viewers;
no new pages, no new doors, no interaction mechanics.

## What this slice closes

Three of the five §4 coverage gaps, each rendered where the blueprint's chapter
mapping already puts it:

| §4 gap                             | Where it now renders                                            | Data                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbound roster (who it writes to) | Scope viewer, new "Who it writes to for the firm" group         | `scope_json.outbound_roster` (ADR 0075), class labels via closed map                                                                                       |
| Entitlements as one honest view    | Work surface, new "What it may do on its own" authority block   | active persona `entitlements.exposure` (sparse; unauthored never renders as a row — fail-closed stays invisible, stated once by the fixed footer sentence) |
| Persona identity + voice posture   | Hero "who it is" lines: Sounds / Writes from / Also operates as | persona `tone` (humanized), `send_as`, other active personas (ADR 0011)                                                                                    |

Occasions served (§3): #1 agreement (the config reads more completely) and
#2 confirmation ("will it act alone?" now has one page answering globally).

## Deliberately out (remain open §4 rows)

- **Schedule** — plane `config_unprojected`; needs the projection extension
  first (its own slice, next).
- **Voice library/samples** — persona tone is the authored voice POSTURE;
  the library stays a later slice (registry `voice` unchanged).

## Vocabulary note

The authority block's ceiling sentences ("Handles it on its own / Asks first /
Prepares it for a person / Never") extend the locked tier-sentence register.
Block heading "What it may do on its own". These join the blueprint §6 table
at the vocabulary pass (slice 3) for guard enforcement.

## Registry

`entitlements` flips `planned(3)` → `has_viewer` at the work resolver. `scope`
note gains the outbound group; `voice` unchanged (posture ≠ library).
