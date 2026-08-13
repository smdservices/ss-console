#!/usr/bin/env python3
"""rehearse-card.py — say the stand-up script to a seat, as the firm would.

WHY THIS EXISTS (2026-08-12). `initiation-card.yaml` is the script the firm is
told to speak after connect, and every command carries an `expected` and a
`falsifier`. Both seats read `rehearsal: pending` on all 18 commands — the card's
own rule is that a pending command is not spoken at the firm, so on paper nothing
was sayable. The first rehearsal was run by hand out of a scratchpad, which is
how a one-off stays a one-off.

WHAT IT DOES. Sends each unlocked command VERBATIM from an address the seat's own
config names as an admin, waits for the reply, and writes a transcript.

WHAT IT DOES NOT DO — and this is deliberate. **It does not judge.** The first
hand rehearsal was scored by the same agent that wrote the messages, and that
judgment was wrong at least once: a "failure" turned out to be a mis-designed
test, caught by accident. An automated grader here would industrialise exactly
that error. So the transcript pairs each reply with the command's own `expected`
and `falsifier` and stops, leaving a human or a second reader to decide. The
tool's job is to make the evidence cheap and complete, not to reach a verdict.

SILENCE IS NEVER A PASS. A command that draws no reply is written as NO REPLY
with its timeout, because "the seat said nothing" and "the seat answered well"
must never look alike in the record.

USAGE
    infisical run --env=prod --path=/ss -- \\
        operator/bin/rehearse-card.py <slug> --as <admin@address> [--out FILE]

    --only N        run just command N (1-based, as printed by --list)
    --list          print the commands and exit; sends nothing
    --timeout SECS  per-command wait (default 420)

Exit codes: 0 = every attempted command drew a reply; 1 = at least one did not;
2 = the seat/card/config could not be read, or the sender is not an authored
admin (fail closed — rehearsing as someone the seat does not trust measures the
wrong thing).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CUSTOMERS = REPO_ROOT / "operator" / "customers"
API_BASE = "https://api.agentmail.to/v0"


def _die(msg: str, code: int = 2) -> None:
    print(f"FATAL: {msg}", file=sys.stderr)
    raise SystemExit(code)


def load(slug: str) -> tuple[dict, dict]:
    card_path = CUSTOMERS / slug / "initiation-card.yaml"
    cfg_path = CUSTOMERS / slug / "customer.yaml"
    if not card_path.is_file():
        _die(f"no initiation-card.yaml at {card_path}")
    if not cfg_path.is_file():
        _die(f"no customer.yaml at {cfg_path}")
    return (
        yaml.safe_load(card_path.read_text()) or {},
        yaml.safe_load(cfg_path.read_text()) or {},
    )


def seat_inbox(cfg: dict) -> str:
    """The seat's own inbox, from its authored Email connector."""
    conns = cfg.get("connectors") or {}
    email = conns.get("Email") if isinstance(conns, dict) else None
    if not isinstance(email, dict) or not email.get("enabled"):
        _die(
            "this seat authors no enabled Email connector, so there is no channel "
            "to speak the card on — nothing to rehearse"
        )
    url = str(email.get("webhook_url", ""))
    m = re.search(r"hermes-([a-z0-9-]+)\.fly\.dev", url)
    if not m:
        _die("could not derive the seat inbox from the Email connector's webhook_url")
    return f"{m.group(1)}@agentmail.to"


def unlocked_commands(card: dict) -> list[dict]:
    """Every command the firm could actually be told to say.

    Locked stages are skipped: the card gates them on a real-world event (the
    principal's own drafting test), so rehearsing them would assert a readiness
    the firm has not granted.
    """
    out: list[dict] = []
    for stage in card.get("stages") or []:
        if stage.get("locked"):
            continue
        for cmd in stage.get("commands") or []:
            out.append({"stage": stage.get("id", "?"), **cmd})
    return out


def api(method: str, path: str, key: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API_BASE + path, data=data, method=method, headers=headers)
    try:
        # The URL is always the constant API_BASE (https://api.agentmail.to/v0)
        # concatenated with a path this module builds; no caller supplies a
        # scheme or host, so the file:// concern the rule guards does not arise.
        # Same suppression and reasoning as operator/bin/mint-agentmail-keys.py.
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"raw": e.read().decode()[:400]}


def strip_quote_trail(body: str) -> str:
    """Drop the quoted original so the record holds the Operator's own words."""
    for marker in ("\nOn Mon,", "\nOn Tue,", "\nOn Wed,", "\nOn Thu,", "\nOn Fri,", "\nOn Sat,", "\nOn Sun,", "\n> "):
        if marker in body:
            body = body.split(marker)[0]
    return body.strip()


def ask(sender: str, seat: str, subject: str, text: str, key: str, timeout: int) -> str | None:
    st, _ = api(
        "POST", f"/inboxes/{urllib.parse.quote(sender)}/messages/send", key, {"to": [seat], "subject": subject, "text": text}
    )
    if st != 200:
        return None
    deadline = time.time() + timeout
    while time.time() < deadline:
        s2, res = api("GET", f"/inboxes/{urllib.parse.quote(sender)}/messages?limit=12", key)
        if s2 == 200:
            for m in res.get("messages") or []:
                if seat in str(m.get("from", "")) and subject[:38] in str(m.get("subject", "")):
                    s3, full = api(
                        "GET",
                        f"/inboxes/{urllib.parse.quote(sender)}/messages/{urllib.parse.quote(m['message_id'])}",
                        key,
                    )
                    return strip_quote_trail(full.get("text") or "")
        time.sleep(10)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("slug")
    ap.add_argument("--as", dest="sender", help="address to speak as; must be on scope.admins")
    ap.add_argument("--out", default=None)
    ap.add_argument("--only", type=int, default=None)
    ap.add_argument("--list", action="store_true", dest="just_list")
    ap.add_argument("--timeout", type=int, default=420)
    args = ap.parse_args()

    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,31}", args.slug):
        _die(f"invalid slug {args.slug!r}")

    card, cfg = load(args.slug)
    commands = unlocked_commands(card)

    if args.just_list:
        for i, c in enumerate(commands, 1):
            say = " ".join(str(c.get("say", "")).split())
            flag = " [admin]" if c.get("admin_only") else ""
            print(f"{i:>2}. [{c['stage']}] {c.get('backed_by')}{flag}\n    {say}")
        print(f"\n{len(commands)} unlocked command(s). Nothing sent.")
        return 0

    if not args.sender:
        _die("--as is required (the address to rehearse as)")

    # Fail closed on an unauthored sender: the card's admin_only commands resolve
    # authority from scope.admins, so rehearsing as anyone else silently measures
    # the refusal path and would read as a product defect.
    admins = {str(a).strip().lower() for a in ((cfg.get("scope") or {}).get("admins") or [])}
    if args.sender.strip().lower() not in admins:
        _die(
            f"{args.sender} is not on this seat's scope.admins, so admin-only commands "
            f"would be refused for the sender rather than answered. Authored admins: "
            f"{', '.join(sorted(admins)) or '(none)'}"
        )

    key = os.environ.get("AGENTMAIL_API_KEY")
    if not key:
        _die("AGENTMAIL_API_KEY unset — run under `infisical run --env=prod --path=/ss`")

    seat = seat_inbox(cfg)
    chosen = [commands[args.only - 1]] if args.only else commands
    if args.only and not (1 <= args.only <= len(commands)):
        _die(f"--only must be 1..{len(commands)}")

    out_path = Path(args.out) if args.out else Path(f"card-transcript-{args.slug}.txt")
    silent = 0
    with out_path.open("w") as fh:
        fh.write(f"REHEARSAL TRANSCRIPT — {args.slug} — spoken as {args.sender}\n")
        fh.write(
            "\nThis file is EVIDENCE, not a verdict. Each reply is paired with the "
            "card's own expected and falsifier so a reader who did not run the "
            "rehearsal can judge it. Nothing here has been graded.\n"
        )
        for i, c in enumerate(chosen, 1):
            n = args.only or i
            say = " ".join(str(c.get("say", "")).split())
            subject = f"Card {n} - {c.get('backed_by', 'command')}"
            print(f"[{n}/{len(commands)}] {say[:70]}")
            reply = ask(args.sender, seat, subject, say, key, args.timeout)
            fh.write(f"\n\n{'=' * 72}\n### Command {n} [{c['stage']}] backed_by: {c.get('backed_by')}\n")
            fh.write(f"SAID: {say}\n\nEXPECTED: {' '.join(str(c.get('expected', '')).split())}\n")
            fh.write(f"\nFALSIFIER: {' '.join(str(c.get('falsifier', '')).split())}\n\n")
            if reply is None:
                silent += 1
                fh.write(f"*** NO REPLY within {args.timeout}s ***\n")
                print("    NO REPLY")
            else:
                fh.write(f"REPLY:\n{reply}\n")
            fh.flush()

    print(f"\nTranscript: {out_path}")
    print(f"{len(chosen) - silent}/{len(chosen)} answered; {silent} silent.")
    print("Nothing has been graded — read each reply against its expected and falsifier.")
    return 1 if silent else 0


if __name__ == "__main__":
    sys.exit(main())
