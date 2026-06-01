"""Initial OAuth setup — run once per customer to authorize the SMD application.

Run inside the customer's Fly container:

  /opt/hermes/.venv/bin/python -m operator_lawpay.setup --customer-id smd

Prints the authorization URL, then waits for the operator to paste the auth
code from the redirect URL. Exchanges the code for an initial token pair
and stores it on the persistent volume.

Required env vars: LAWPAY_CLIENT_ID, LAWPAY_CLIENT_SECRET, LAWPAY_REDIRECT_URI,
LAWPAY_ENV (prod | sandbox; default prod).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from .oauth import OAuthClient, TokenStore


async def _run(customer_id: str, token_store_path: Path) -> int:
    required = ("LAWPAY_CLIENT_ID", "LAWPAY_CLIENT_SECRET", "LAWPAY_REDIRECT_URI")
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"FATAL: missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 2

    oauth = OAuthClient(
        client_id=os.environ["LAWPAY_CLIENT_ID"],
        client_secret=os.environ["LAWPAY_CLIENT_SECRET"],
        redirect_uri=os.environ["LAWPAY_REDIRECT_URI"],
        env=os.environ.get("LAWPAY_ENV", "prod"),
        token_store=TokenStore(token_store_path, customer_id),
    )

    print()
    print(f"Customer: {customer_id}")
    print(f"Environment: {oauth.base_url}")
    print(f"Token store: {oauth.token_store.path}")
    print()
    print("Step 1: Customer visits this URL and authorizes the SMD application:")
    print()
    print(f"  {oauth.authorize_url}")
    print()
    print("Step 2: After authorizing, LawPay redirects to:")
    print(f"  {oauth.redirect_uri}?code=AUTH_CODE")
    print()
    print("Step 3: Paste the AUTH_CODE value here:")
    print()
    code = input("auth code: ").strip()
    if not code:
        print("FATAL: no auth code provided", file=sys.stderr)
        return 2

    try:
        tokens = await oauth.exchange_auth_code(code)
    except Exception as e:  # noqa: BLE001
        print(f"FATAL: token exchange failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    print()
    print(f"OK: tokens stored at {oauth.token_store.path}")
    print(f"     access_token expires at epoch {tokens.expires_at:.0f}")
    print()
    print("Test the connection by running the MCP server and listing tools, or:")
    print(f"  python -c \"import asyncio; from operator_lawpay.oauth import OAuthClient, TokenStore; from pathlib import Path; print(asyncio.run(OAuthClient(client_id='${{LAWPAY_CLIENT_ID}}', client_secret='${{LAWPAY_CLIENT_SECRET}}', redirect_uri='${{LAWPAY_REDIRECT_URI}}', env='{os.environ.get('LAWPAY_ENV', 'prod')}', token_store=TokenStore(Path('{token_store_path}'), '{customer_id}')).get_valid_tokens()))\"")
    await oauth.aclose()
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--customer-id", required=True)
    ap.add_argument("--token-store-path", default="/opt/data/lawpay")
    args = ap.parse_args()
    sys.exit(asyncio.run(_run(args.customer_id, Path(args.token_store_path))))


if __name__ == "__main__":
    main()
