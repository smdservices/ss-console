# Complaint context — note (not used as harness context; informational only)

No Alvarez-matter complaint fixture exists in seed_data.py's build_documents() —
only "complaint-chen" does, which belongs to the unrelated premises-chen matter
(Chen v. Sunrise Plaza), not mva-alvarez. Per WS2's authored fallback ("if none
exists for alvarez, note it and use the TCR + incident record as the factual
base"): matter/traffic-collision-report.md and matter/incident-facts.md serve as
the factual base instead. Both are already included in WS2's context because the
matrix passes the whole matter/ directory — no separate complaint file is needed
for this fallback to take effect.
