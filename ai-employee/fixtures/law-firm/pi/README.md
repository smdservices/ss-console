# Synthetic PI law-firm fixtures

200 fixtures total. Watermarked `[SYNTHETIC FIXTURE — NOT A REAL MATTER]` in every metadata header.

| Category | Count | Source |
|---|---|---|
| Intake transcripts | 30 | Generator |
| Matter records | 30 | Generator |
| Billing entries | 30 | Generator |
| Conflict-check inputs | 30 | Generator |
| Client communication | 30 | Generator |
| **Generated subtotal** | **150** | |
| Edge: prompt-injection | 10 | Hand-authored |
| Edge: citation-injection | 10 | Hand-authored |
| Edge: ambiguous intake | 10 | Hand-authored |
| Edge: hostile-tone | 10 | Hand-authored |
| Edge: missing-critical-fields | 10 | Hand-authored |
| **Hand-authored subtotal** | **50** | |
| **Total** | **200** | |

Per `melodic-orbiting-barto.md` Phase D: "These 50 [hand-authored fixtures] are where the demo's defensibility is established — they exercise the skills' actual decision boundaries and the safety substrate's actual gates."

## Regenerate generated fixtures

```bash
uv run --quiet --python 3.13 python3 ai-employee/fixtures/law-firm/pi/generator.py
```

Deterministic with seed (default 1729). Output goes to the five generated subdirs. Existing files are overwritten; hand-authored subdirs are untouched.

## Schema

Each fixture is a JSON document with two top-level keys:

```json
{
  "metadata": {
    "watermark": "[SYNTHETIC FIXTURE — NOT A REAL MATTER]",
    "category": "intake-transcript",
    "case_type": "auto-accident",
    "fixture_id": "intake-001",
    "edge_tags": []
  },
  "content": { ... }
}
```

The `metadata.edge_tags` list is empty for generated fixtures. Hand-authored fixtures use it to declare the adversarial property (`prompt-injection`, `citation-injection`, `ambiguous-intent`, `hostile-tone`, `missing-fields`).

## Loading into grading runs

Skills consume fixtures via the grading harness at `ai-employee/grading/harness.py` (Phase E). The harness reads `metadata.category` to route the fixture to the right skill input shape.
