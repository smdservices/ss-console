#!/usr/bin/env python3
"""Safety substrate invariant runner (Phase A.5 gate).

Discovers `test_*.py` files under the fixtures dir, imports each, invokes
its `run() -> (bool, str)` callable, collects pass/fail. In `--strict`
mode (default in bootstrap.sh), any failure exits non-zero and blocks
agent startup.

The five irreducible invariants (per docs/strategy/ai-employee-functional-
shape-2026-05-13.md and the plan at ~/.claude/plans/melodic-orbiting-barto.md):

  1. No destructive action without explicit current-turn confirmation
  2. No outbound external send without confirmation
  3. No contract / commitment execution autonomously
  4. "Don't act" / "stop" instructions are sticky across compaction
  5. Trust-ceiling enforced in code, not in prompt

Called from bootstrap.sh on container start. Re-runs on every Hermes SHA
bump (because the container rebuilds with new test files).
"""

import argparse
import importlib.util
import sys
from pathlib import Path


def load_test(test_path: Path):
    """Load a test_*.py file and return its run() callable, or None on import error."""
    spec = importlib.util.spec_from_file_location(test_path.stem, test_path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as e:  # noqa: BLE001
        print(f"  IMPORT FAIL {test_path.name}: {type(e).__name__}: {e}", file=sys.stderr)
        return None
    return getattr(module, "run", None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--customer", required=True)
    ap.add_argument("--fixtures", type=Path, required=True)
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero on any failure (default in bootstrap)")
    args = ap.parse_args()

    tests_dir: Path = args.fixtures
    if not tests_dir.exists():
        msg = f"safety-substrate tests dir not found at {tests_dir}"
        if args.strict:
            print(f"FAIL: {msg}", file=sys.stderr)
            return 1
        print(f"WARN: {msg}", file=sys.stderr)
        return 0

    test_files = sorted(p for p in tests_dir.glob("test_*.py") if p.is_file())
    if not test_files:
        msg = f"no safety-substrate tests found under {tests_dir}"
        if args.strict:
            print(f"FAIL (strict): {msg}", file=sys.stderr)
            return 1
        print(f"WARN: {msg}", file=sys.stderr)
        return 0

    failures: list[str] = []
    passes: list[str] = []
    for tf in test_files:
        run_fn = load_test(tf)
        if run_fn is None:
            failures.append(f"{tf.name}: import failed or no run() callable")
            continue
        try:
            ok, message = run_fn()
        except Exception as e:  # noqa: BLE001
            failures.append(f"{tf.name}: raised {type(e).__name__}: {e}")
            continue
        if ok:
            print(f"  PASS {tf.name}: {message}")
            passes.append(tf.name)
        else:
            print(f"  FAIL {tf.name}: {message}", file=sys.stderr)
            failures.append(f"{tf.name}: {message}")

    print(
        f"\nsubstrate result for customer={args.customer}: "
        f"{len(passes)} pass, {len(failures)} fail (of {len(test_files)} tests)"
    )

    if failures:
        print("\nFAILURES:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1 if args.strict else 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
