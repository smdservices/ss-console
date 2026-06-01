#!/usr/bin/env python3
"""Synthetic PI law-firm fixture generator (150 fixtures across 5 categories).

Deterministic via seeded RNG (default seed 1729). Re-running produces the
same fixture set. Hand-authored edge fixtures live in sibling `edge-*`
subdirs and are NOT touched by this generator.

Every fixture written by this script carries:
  metadata.watermark = "[SYNTHETIC FIXTURE — NOT A REAL MATTER]"
  metadata.edge_tags = []
  metadata.fixture_id = "{category-prefix}-{seq:03d}"

Categories produced (30 each):
  - intake-transcripts/    intake-NNN.json
  - matter-records/        matter-NNN.json
  - billing-entries/       billing-NNN.json
  - conflict-check-inputs/ conflict-NNN.json
  - client-communication/  client-NNN.json

Run:
  uv run --quiet --python 3.13 python3 operator/verticals/law-firm/addons/pi/fixtures/generator.py
"""

from __future__ import annotations

import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

WATERMARK = "[SYNTHETIC FIXTURE — NOT A REAL MATTER]"
HERE = Path(__file__).resolve().parent

# ---------- Synthetic registries (no real names, no real businesses) ----------

# First names + last names that don't index against any real PI client/firm we
# can identify. Mix of common + uncommon to give variety.
FIRST_NAMES = [
    "Marcus", "Yolanda", "Devon", "Priya", "Tomasz", "Cassandra", "Jorge", "Anneke",
    "Reginald", "Mei-Lin", "Thaddeus", "Esperanza", "Kazimir", "Sage", "Octavio",
    "Imani", "Niko", "Branwen", "Cyrus", "Lakshmi", "Halmar", "Sigrid", "Patel",
    "Quinlan", "Zora", "Fenwick", "Talullah", "Inigo", "Magdalena", "Otis",
]
LAST_NAMES = [
    "Holcombe", "Vasquez-Mendez", "Okafor", "Pemberton", "Ranganathan", "Steinmetz",
    "Kowalski", "Nguyen-Pham", "Brennan", "Aldecoa", "Tsosie", "Volkmann", "Lim",
    "Garibaldi", "Henneberry", "Eklund", "Onyeka", "Ashworth", "Sarmiento",
    "Brzezinski", "Whitlock", "Achebe", "Pellegrino", "Yamashita", "Aboueid",
]
# Defendant insurance carriers — real carriers exist, but we use plausible synthetic
# names that follow industry naming patterns without being any actual carrier.
SYNTHETIC_CARRIERS = [
    "Coronado Mutual Casualty", "Westmark Indemnity Group", "Pinecrest Auto Insurance",
    "Sunfield National", "Brevard Allied Insurance", "Heritage Lake Casualty",
    "Mountain Pass Mutual", "Cascade Bay Insurance",
]
# Synthetic medical providers
SYNTHETIC_PROVIDERS = [
    "Saguaro Spine and Pain Institute", "Desert Rim Orthopedics", "Verde Valley ER",
    "Copper Canyon Imaging", "Cholla Park Physical Therapy", "Tucson Mesa Family Practice",
]
# Synthetic opposing counsel firms
SYNTHETIC_OPP_FIRMS = [
    "Steinmetz, Kowalski & Pellegrino LLP", "Holcombe Defense Group",
    "Vasquez-Mendez Insurance Defense", "Eklund & Associates",
    "Brennan Litigation Partners", "Cascade Pacific Defense Counsel",
]

# PI case-type taxonomy
CASE_TYPES = [
    ("auto-highway", "highway rear-end collision at speed"),
    ("auto-intersection", "intersection T-bone collision"),
    ("auto-rear-end-residential", "low-speed rear-end in residential area"),
    ("slip-fall-commercial", "slip and fall at commercial premises"),
    ("slip-fall-residential", "slip and fall at residential property"),
    ("slip-fall-snow-ice", "ice-related fall on snow-affected walkway"),
    ("premises-negligent-security", "premises liability for negligent security"),
    ("premises-inadequate-maintenance", "premises liability for inadequate maintenance"),
    ("product-liability-consumer", "product liability — consumer goods defect"),
    ("med-mal", "medical malpractice"),
]

# Matter stages (Clio shape)
MATTER_STAGES = [
    "intake", "discovery", "pre-litigation", "litigation", "settlement-negotiation",
    "settlement-pending", "closed-recovered", "closed-no-recovery",
]

# Billing description templates (with realistic mixed quality)
BILLING_TEMPLATES_GOOD = [
    "Reviewed and analyzed medical records from {provider}. Drafted memo summarizing key findings re: causation. {hours} hrs.",
    "Phone conference with client {client} re: status of {topic}; addressed {n_questions} questions. {hours} hrs.",
    "Drafted demand letter section addressing damages exposure including {damage_type}. {hours} hrs.",
    "Reviewed defendant carrier {carrier}'s response to demand. Identified {n_issues} contestable points. {hours} hrs.",
    "Attended deposition of {witness_type} witness. Prepared cross-examination outline. {hours} hrs.",
]
BILLING_TEMPLATES_AMBIGUOUS = [
    "Worked on matter. {hours} hrs.",
    "Reviewed file. {hours} hrs.",
    "Phone call. {hours} hrs.",
    "Client communication. {hours} hrs.",
    "Document review. {hours} hrs.",
]

# Client communication tone variants
CLIENT_TONES = [
    "informed-patient", "anxious", "frustrated", "ghosted-returning",
    "fee-disputing-mild",
]

CLIENT_TONE_TEMPLATES = {
    "informed-patient": (
        "Hi {atty},\n\nJust checking in for an update on my case. I know these things "
        "take time. Last we spoke you mentioned the carrier was reviewing the demand. "
        "Any news? No rush, just wanted to stay in the loop.\n\nThanks,\n{client}"
    ),
    "anxious": (
        "Hi {atty}, I haven't heard anything in {weeks} weeks and I'm getting really worried. "
        "Is something wrong with my case? Did the carrier reject the demand? "
        "Please let me know what's going on. I can't sleep thinking about this.\n\n{client}"
    ),
    "frustrated": (
        "{atty},\n\nIt's been {weeks} weeks since we filed. I left two voicemails last week. "
        "I'm starting to feel like nobody is working on my case. I'd appreciate a call "
        "back within 24 hours.\n\n{client}"
    ),
    "ghosted-returning": (
        "Hi {atty}, I know I haven't responded to your last three emails. Things have been "
        "hectic on my end. I'm ready to engage again. What do you need from me to move "
        "forward?\n\n{client}"
    ),
    "fee-disputing-mild": (
        "{atty}, I got the invoice. I see there's an entry for {hours} hours on {date} for "
        "\"document review\" — can you tell me what specifically was reviewed? I want to "
        "make sure I understand what I'm being billed for.\n\nThanks,\n{client}"
    ),
}


def fresh_name(rng: random.Random) -> str:
    return f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"


def fresh_email(name: str, rng: random.Random) -> str:
    handle = name.lower().replace(" ", ".").replace("-", "")
    domain = rng.choice(["proton.me", "outlook.com", "gmail.com", "fastmail.com"])
    return f"{handle}@{domain}"


def fresh_date(rng: random.Random, days_back: int = 365) -> str:
    delta = rng.randint(0, days_back)
    return (date(2026, 5, 19) - timedelta(days=delta)).isoformat()


def write_fixture(subdir: str, fixture_id: str, category: str, case_type: str, content: dict, edge_tags: list[str] | None = None) -> None:
    out_path = HERE / subdir / f"{fixture_id}.json"
    doc = {
        "metadata": {
            "watermark": WATERMARK,
            "category": category,
            "case_type": case_type,
            "fixture_id": fixture_id,
            "edge_tags": edge_tags or [],
        },
        "content": content,
    }
    out_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")


def gen_intake_transcripts(rng: random.Random, count: int = 30) -> None:
    """Synthetic intake-call transcripts. Each is a short multi-turn dialogue
    capturing what an intake coordinator hears from a prospective PI client."""
    for i in range(1, count + 1):
        case_type, blurb = rng.choice(CASE_TYPES)
        client = fresh_name(rng)
        incident_date = fresh_date(rng, days_back=90)
        dialogue = [
            {"speaker": "intake", "text": f"Hi {client.split()[0]}, this is the intake line at SMD's partner law firm. I understand you'd like to talk about a {blurb.split(' — ')[0] if ' — ' in blurb else blurb}. Is now still a good time?"},
            {"speaker": "client", "text": f"Yes, thanks for calling back. So on {incident_date} I was {rng.choice(['driving home from work', 'walking into the grocery store', 'at a house party', 'leaving the gym', 'picking up my kids from school'])} when {blurb} happened."},
            {"speaker": "intake", "text": "I'm sorry to hear that. Can you tell me what injuries you've experienced, and whether you've gotten medical treatment?"},
            {"speaker": "client", "text": f"I've been having {rng.choice(['neck and back pain', 'a shoulder injury', 'knee pain', 'headaches and dizziness', 'lower back pain'])}. I went to {rng.choice(SYNTHETIC_PROVIDERS)} the next day. They referred me to {rng.choice(['physical therapy', 'an orthopedist', 'an imaging center', 'a pain specialist'])}."},
            {"speaker": "intake", "text": "Did you exchange information with the other party? Do you know who their insurance is with?"},
            {"speaker": "client", "text": f"Yes, {rng.choice(SYNTHETIC_CARRIERS)}. The police were also there."},
            {"speaker": "intake", "text": "Have you spoken with the insurance company yet?"},
            {"speaker": "client", "text": rng.choice([
                "Not yet, I wanted to talk to a lawyer first.",
                "They've called twice but I haven't returned the calls.",
                "I gave them a recorded statement before I knew I shouldn't.",
                "Yes, they offered $3,500 already and I said I'd think about it.",
            ])},
            {"speaker": "intake", "text": "Got it. One more question — have you worked with another attorney on this matter, or signed anything with another firm?"},
            {"speaker": "client", "text": rng.choice(["No.", "No, you're the first.", "I talked to one other firm but didn't sign anything.", "No, I went through the bar referral service to find your firm."])},
        ]
        content = {
            "client_name": client,
            "client_phone": f"({rng.randint(200,999)}) {rng.randint(200,999)}-{rng.randint(1000,9999)}",
            "client_email": fresh_email(client, rng),
            "incident_date": incident_date,
            "case_type_self_described": blurb,
            "defendant_carrier_named": rng.choice(SYNTHETIC_CARRIERS),
            "medical_provider_mentioned": rng.choice(SYNTHETIC_PROVIDERS),
            "dialogue": dialogue,
        }
        write_fixture("intake-transcripts", f"intake-{i:03d}", "intake-transcript", case_type, content)


def gen_matter_records(rng: random.Random, count: int = 30) -> None:
    """Synthetic Clio-shape matter records."""
    for i in range(1, count + 1):
        case_type, blurb = rng.choice(CASE_TYPES)
        client = fresh_name(rng)
        opp_carrier = rng.choice(SYNTHETIC_CARRIERS)
        opp_firm = rng.choice(SYNTHETIC_OPP_FIRMS)
        stage = rng.choice(MATTER_STAGES)
        intake_date = fresh_date(rng, days_back=540)
        # case value range depends on case type
        value_low = rng.choice([15_000, 50_000, 100_000, 250_000, 500_000])
        value_high = value_low * rng.choice([2, 3, 5])
        content = {
            "display_number": f"PI-2026-{rng.randint(1000, 9999):04d}",
            "description": blurb,
            "case_type": case_type,
            "status": stage,
            "open_date": intake_date,
            "client_id": f"contact-{rng.randint(10000, 99999)}",
            "client_name": client,
            "assigned_attorney": rng.choice(["S. Garcia", "M. Tran", "K. Patel", "J. Okafor"]),
            "case_value_estimate_low_usd": value_low,
            "case_value_estimate_high_usd": value_high,
            "defendant": {
                "type": rng.choice(["individual", "business", "government-entity"]),
                "name": fresh_name(rng) if rng.random() > 0.5 else f"{rng.choice(['Westgate', 'Brookfield', 'Lakeside'])} Properties LLC",
                "carrier": opp_carrier,
                "opp_counsel_firm": opp_firm,
            },
            "key_dates": {
                "incident_date": fresh_date(rng, days_back=600),
                "sol_date": (date(2026, 5, 19) + timedelta(days=rng.randint(100, 700))).isoformat(),
                "next_court_date": (date(2026, 5, 19) + timedelta(days=rng.randint(30, 180))).isoformat() if stage in ("litigation", "settlement-pending") else None,
            },
            "custom_fields": {
                "settlement_stage": rng.choice(["pre-demand", "demand-out", "demand-rejected", "in-negotiation", "settled"]),
                "policy_limits_disclosed": rng.choice([True, False]),
            },
        }
        write_fixture("matter-records", f"matter-{i:03d}", "matter-record", case_type, content)


def gen_billing_entries(rng: random.Random, count: int = 30) -> None:
    """Time/billing entries with mix of well-coded vs. ambiguous descriptions."""
    for i in range(1, count + 1):
        case_type, _ = rng.choice(CASE_TYPES)
        is_ambiguous = rng.random() < 0.35  # ~35% ambiguous
        template = rng.choice(BILLING_TEMPLATES_AMBIGUOUS if is_ambiguous else BILLING_TEMPLATES_GOOD)
        hours = round(rng.uniform(0.1, 4.5), 1)
        client = fresh_name(rng)
        description = template.format(
            provider=rng.choice(SYNTHETIC_PROVIDERS),
            client=client,
            topic=rng.choice(["next steps", "deposition prep", "settlement strategy"]),
            n_questions=rng.randint(2, 6),
            damage_type=rng.choice(["future medical care", "lost earning capacity", "pain and suffering"]),
            carrier=rng.choice(SYNTHETIC_CARRIERS),
            n_issues=rng.randint(2, 5),
            witness_type=rng.choice(["expert", "fact", "treating physician"]),
            hours=hours,
        )
        content = {
            "matter_display_number": f"PI-2026-{rng.randint(1000, 9999):04d}",
            "entry_date": fresh_date(rng, days_back=90),
            "duration_hours": hours,
            "billable": rng.choice([True, True, True, False]),  # mostly billable
            "rate_per_hour_usd": 350,
            "amount_usd": round(hours * 350, 2),
            "description": description,
            "quality_self_assessment": "ambiguous" if is_ambiguous else "well-coded",
        }
        write_fixture("billing-entries", f"billing-{i:03d}", "billing-entry", case_type, content)


def gen_conflict_check_inputs(rng: random.Random, count: int = 30) -> None:
    """Conflict-check inputs: prospect party list + adjacent matters in firm DB.

    ~30% have positive conflicts (prospect name overlaps existing matter party);
    the rest are clean.
    """
    for i in range(1, count + 1):
        prospect = fresh_name(rng)
        existing_matter_count = rng.randint(3, 7)
        positive_conflict = rng.random() < 0.3
        existing_matters = []
        for j in range(existing_matter_count):
            mc = {
                "matter_id": f"contact-{rng.randint(10000, 99999)}",
                "client_name": fresh_name(rng),
                "opposing_party": fresh_name(rng),
                "opposing_counsel": rng.choice(SYNTHETIC_OPP_FIRMS),
            }
            existing_matters.append(mc)
        if positive_conflict:
            # Inject prospect into one of the existing matters
            idx = rng.randint(0, existing_matter_count - 1)
            inject_field = rng.choice(["client_name", "opposing_party"])
            existing_matters[idx][inject_field] = prospect
        content = {
            "prospect": {
                "name": prospect,
                "email": fresh_email(prospect, rng),
                "case_type": rng.choice(CASE_TYPES)[0],
                "incident_party_list": [prospect, fresh_name(rng)],
            },
            "existing_matters_subset": existing_matters,
            "expected_outcome": "positive-conflict" if positive_conflict else "no-conflict",
        }
        write_fixture(
            "conflict-check-inputs",
            f"conflict-{i:03d}",
            "conflict-check-input",
            "n/a",
            content,
        )


def gen_client_communication(rng: random.Random, count: int = 30) -> None:
    """Client emails across the tone spectrum."""
    for i in range(1, count + 1):
        case_type, _ = rng.choice(CASE_TYPES)
        client = fresh_name(rng)
        atty = rng.choice(["Sarah", "Marcus", "Kavita", "James"])
        tone = rng.choice(CLIENT_TONES)
        template = CLIENT_TONE_TEMPLATES[tone]
        body = template.format(
            atty=atty,
            client=client,
            weeks=rng.randint(2, 8),
            hours=round(rng.uniform(2.5, 5.5), 1),
            date=fresh_date(rng, days_back=30),
        )
        content = {
            "from": fresh_email(client, rng),
            "from_name": client,
            "to": f"{atty.lower()}@example-firm.invalid",
            "subject": rng.choice([
                f"Re: My case — quick question",
                f"Following up",
                f"Case status",
                f"Need to talk",
                f"Question about invoice",
            ]),
            "sent_date": fresh_date(rng, days_back=14),
            "body": body,
            "tone_label": tone,
            "matter_display_number": f"PI-2026-{rng.randint(1000, 9999):04d}",
        }
        write_fixture(
            "client-communication",
            f"client-{i:03d}",
            "client-communication",
            case_type,
            content,
        )


def main() -> None:
    rng = random.Random(1729)
    gen_intake_transcripts(rng, 30)
    gen_matter_records(rng, 30)
    gen_billing_entries(rng, 30)
    gen_conflict_check_inputs(rng, 30)
    gen_client_communication(rng, 30)
    print("generator: wrote 150 fixtures across 5 categories (seed=1729)")


if __name__ == "__main__":
    main()
