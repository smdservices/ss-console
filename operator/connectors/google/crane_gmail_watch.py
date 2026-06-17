"""crane_gmail_watch — register or renew a Gmail push-notification subscription.

Calls users.watch() on the DWD-impersonated mailbox so Gmail publishes inbox
events to a Google Cloud Pub/Sub topic. The topic delivers a push notification
to the Machine's /webhooks/gmail endpoint, which fires the email-reply skill
immediately — no polling delay.

Gmail watch subscriptions expire after 7 days. Run at boot (bootstrap.sh) and
weekly via the watch-renew cron skill to keep the subscription live.

Usage:
    crane_gmail_watch.py [--token PATH] [--topic TOPIC] [--label LABEL]

    --token   Path to Google credential JSON (default: GOOGLE_TOKEN_PATH env
              or /tmp/google_token.json).
    --topic   GCP Pub/Sub topic resource name
              (default: GMAIL_PUBSUB_TOPIC env var).
              Format: projects/{project}/topics/{name}.
    --label   Gmail label IDs to watch, comma-separated
              (default: INBOX).

Output: JSON to stdout on success, e.g.
    {"historyId": "12345", "expiration": "1750000000000"}

Exit 1 on any error; the supervisor (bootstrap.sh / cron skill) should log and
alert rather than silently ignoring a failed watch renewal.
"""

import argparse
import json
import os
import sys

from _google_auth import add_token_arg, service

DEFAULT_LABEL = "INBOX"


def main() -> int:
    ap = argparse.ArgumentParser(description="Register or renew a Gmail push-notification watch.")
    add_token_arg(ap)
    ap.add_argument(
        "--topic",
        default=os.environ.get("GMAIL_PUBSUB_TOPIC"),
        help="GCP Pub/Sub topic resource name (projects/{project}/topics/{name}). "
             "Falls back to GMAIL_PUBSUB_TOPIC env var.",
    )
    ap.add_argument(
        "--label",
        default=DEFAULT_LABEL,
        help="Comma-separated Gmail label IDs to watch (default: INBOX).",
    )
    args = ap.parse_args()

    if not args.topic:
        print(
            "crane_gmail_watch: --topic or GMAIL_PUBSUB_TOPIC is required",
            file=sys.stderr,
        )
        return 1

    label_ids = [lbl.strip() for lbl in args.label.split(",") if lbl.strip()]
    if not label_ids:
        print("crane_gmail_watch: at least one label is required", file=sys.stderr)
        return 1

    try:
        svc = service("gmail", "v1", args.token)
        result = (
            svc.users()
            .watch(
                userId="me",
                body={"labelIds": label_ids, "topicName": args.topic},
            )
            .execute()
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"crane_gmail_watch: watch() failed — {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
