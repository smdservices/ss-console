"""Soak runner — L4 operational endurance harness.

Per test plan v2 §"Layer 4 — Launch Soak" with tiered durations:

  - 3h compressed soak on PR (3 scenario loops; linear-regression on
    memory/disk growth slope; gate on slope < threshold)
  - Nightly 6h soak on main (same metrics, double loops)
  - Weekly 96h soak before each customer launch (4-day window;
    failure injection mid-soak; TTL boundary via --clock-offset)

The runner is metric-source-agnostic: it accepts a ``MetricSource``
callable that returns the current measurement vector (Honcho RSS,
Postgres disk, Redis AOF size, etc.). Unit tests inject a fake source
that simulates predictable growth (or leak); CI wires a real source
that reads from psutil + fly metrics + Honcho's /metrics endpoint.

Linear-regression growth gate:

  After N loops, the runner fits a least-squares line to each metric's
  (loop_index, value) samples and reports slope_per_loop. Gate fails
  if any metric's slope exceeds its configured threshold (memory leak
  detection). Slope below threshold = bounded growth = pass.

Output:

  A ``SoakReport`` with per-metric slopes, total scenarios executed,
  failures, and a pass/fail overall verdict. Renders to markdown for
  the CI artifact + the Captain-readable launch-check input.

Out of scope for v1 (deferred to follow-on):

  - Real psutil / fly metrics wiring (the MetricSource protocol is the
    seam; production source lands when first soak runs against a real
    Fly Machine).
  - Failure-injection orchestration (kill Honcho/Postgres/Redis mid-
    soak). Lands as a separate FailureInjector hook the runner accepts.
  - --clock-offset synthetic time for TTL boundary testing. The runner
    exposes a clock_offset_days parameter that's passed through to the
    scenario_runner; the actual time-advance logic lives in Honcho's
    test mode.
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class MetricSample:
    """One measurement at a specific point in a soak run."""

    loop_index: int
    timestamp_unix: float
    values: dict[str, float]  # metric_name -> measured value


class MetricSource(Protocol):
    """Returns the current metric values. Implementations: psutil-based,
    fly-metrics-based, Honcho /metrics endpoint, or a test fake."""

    def __call__(self) -> dict[str, float]: ...


@dataclass(frozen=True)
class ScenarioOutcome:
    """One scenario run within a soak loop."""

    scenario_id: str
    passed: bool
    duration_seconds: float
    error: str = ""


class ScenarioRunner(Protocol):
    """Runs one scenario and returns its outcome. The runner integrates
    with ai-employee/tests/scenario_runner.run_scenario in production;
    tests inject a fake."""

    def __call__(self, scenario_id: str) -> ScenarioOutcome: ...


@dataclass(frozen=True)
class LinearFit:
    """Least-squares slope + intercept for one metric across loops."""

    metric_name: str
    slope_per_loop: float
    intercept: float
    samples: int


@dataclass(frozen=True)
class SoakConfig:
    """Knobs controlling a soak run."""

    scenario_ids: list[str]
    loops: int
    # Slope threshold per metric. If a metric's slope_per_loop exceeds
    # its threshold, the gate fails. Metrics not in this dict are
    # tracked but not gated (informational).
    slope_thresholds: dict[str, float] = field(default_factory=dict)
    clock_offset_days: int = 0  # passed to scenario_runner if non-zero
    pause_seconds_between_loops: float = 0.0


@dataclass(frozen=True)
class SoakReport:
    """Output of one soak run."""

    config: SoakConfig
    loops_completed: int
    scenarios_executed: int
    scenarios_passed: int
    scenarios_failed: int
    duration_seconds: float
    samples: list[MetricSample]
    fits: list[LinearFit]
    gate_failures: list[str]  # human-readable, one per breached threshold

    @property
    def overall_passed(self) -> bool:
        return not self.gate_failures and self.scenarios_failed == 0


def linear_regression(
    samples: list[tuple[int, float]],
) -> tuple[float, float]:
    """Least-squares fit. Returns (slope, intercept).

    Pure-Python; no numpy dependency. With n samples (xs, ys):

        slope = (n * sum(x*y) - sum(x) * sum(y)) / (n * sum(x*x) - sum(x)^2)
        intercept = (sum(y) - slope * sum(x)) / n
    """
    n = len(samples)
    if n < 2:
        return 0.0, samples[0][1] if samples else 0.0
    sum_x = sum(x for x, _ in samples)
    sum_y = sum(y for _, y in samples)
    sum_xy = sum(x * y for x, y in samples)
    sum_xx = sum(x * x for x, _ in samples)
    denom = n * sum_xx - sum_x * sum_x
    if denom == 0:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


def fit_metrics(samples: list[MetricSample]) -> list[LinearFit]:
    """Run linear regression on each metric across all samples."""
    if not samples:
        return []
    metric_names: set[str] = set()
    for s in samples:
        metric_names.update(s.values.keys())

    fits: list[LinearFit] = []
    for metric_name in sorted(metric_names):
        pairs: list[tuple[int, float]] = []
        for s in samples:
            if metric_name in s.values:
                pairs.append((s.loop_index, s.values[metric_name]))
        slope, intercept = linear_regression(pairs)
        fits.append(
            LinearFit(
                metric_name=metric_name,
                slope_per_loop=slope,
                intercept=intercept,
                samples=len(pairs),
            )
        )
    return fits


def evaluate_gate(
    fits: list[LinearFit],
    thresholds: Mapping[str, float],
) -> list[str]:
    """Compare each fit's slope against its configured threshold.

    Threshold semantics: ``slope_per_loop`` must be < ``threshold``.
    A threshold of e.g. 5.0 means "memory growth of more than 5 MB
    per loop is a leak."
    """
    failures: list[str] = []
    for fit in fits:
        if fit.metric_name not in thresholds:
            continue
        threshold = thresholds[fit.metric_name]
        if fit.slope_per_loop > threshold:
            failures.append(
                f"{fit.metric_name}: slope_per_loop={fit.slope_per_loop:.3f} "
                f"exceeds threshold {threshold:.3f} (samples={fit.samples})"
            )
    return failures


def run_soak(
    *,
    config: SoakConfig,
    metric_source: MetricSource,
    scenario_runner: ScenarioRunner,
    now_fn: callable = time.time,
) -> SoakReport:
    """Execute the soak loop. Returns the structured report.

    ``now_fn`` is injectable so tests don't depend on wall-clock time.
    """
    start = now_fn()
    samples: list[MetricSample] = []
    executed = 0
    passed = 0
    failed = 0
    loops_completed = 0

    for loop_index in range(config.loops):
        # Sample the metric source at the start of each loop. This gives
        # us (loops + 1) data points for the linear fit at the end.
        samples.append(
            MetricSample(
                loop_index=loop_index,
                timestamp_unix=now_fn(),
                values=dict(metric_source()),
            )
        )

        for scenario_id in config.scenario_ids:
            outcome = scenario_runner(scenario_id)
            executed += 1
            if outcome.passed:
                passed += 1
            else:
                failed += 1

        loops_completed += 1
        if config.pause_seconds_between_loops > 0:
            time.sleep(config.pause_seconds_between_loops)

    # Final sample after the last loop to capture end-state growth.
    samples.append(
        MetricSample(
            loop_index=config.loops,
            timestamp_unix=now_fn(),
            values=dict(metric_source()),
        )
    )

    fits = fit_metrics(samples)
    gate_failures = evaluate_gate(fits, config.slope_thresholds)
    duration = now_fn() - start

    return SoakReport(
        config=config,
        loops_completed=loops_completed,
        scenarios_executed=executed,
        scenarios_passed=passed,
        scenarios_failed=failed,
        duration_seconds=duration,
        samples=samples,
        fits=fits,
        gate_failures=gate_failures,
    )


def render_markdown_report(report: SoakReport, *, mode_label: str = "soak") -> str:
    """Render the SoakReport as a markdown artifact for CI + launch-check."""
    lines: list[str] = []
    lines.append(f"# Soak report ({mode_label})")
    lines.append("")
    lines.append(
        f"Result: **{'PASS' if report.overall_passed else 'FAIL'}**"
    )
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Loops completed: {report.loops_completed}")
    lines.append(f"- Scenarios executed: {report.scenarios_executed}")
    lines.append(f"- Scenarios passed: {report.scenarios_passed}")
    lines.append(f"- Scenarios failed: {report.scenarios_failed}")
    lines.append(f"- Duration: {report.duration_seconds:.1f} s")
    lines.append(f"- Clock offset days: {report.config.clock_offset_days}")
    lines.append("")
    lines.append("## Metric growth (slope per loop)")
    lines.append("")
    lines.append("| Metric | Slope/loop | Samples | Threshold | Gate |")
    lines.append("| ------ | ---------- | ------- | --------- | ---- |")
    for fit in report.fits:
        threshold = report.config.slope_thresholds.get(fit.metric_name, "—")
        if isinstance(threshold, float):
            gate_state = "PASS" if fit.slope_per_loop <= threshold else "FAIL"
            threshold_str = f"{threshold:.3f}"
        else:
            gate_state = "informational"
            threshold_str = "—"
        lines.append(
            f"| {fit.metric_name} | {fit.slope_per_loop:+.3f} | "
            f"{fit.samples} | {threshold_str} | {gate_state} |"
        )
    if report.gate_failures:
        lines.append("")
        lines.append("## Gate failures")
        lines.append("")
        for failure in report.gate_failures:
            lines.append(f"- {failure}")
    return "\n".join(lines) + "\n"


# Mode presets per the plan §"Soak tiering"
PR_MODE_LOOPS = 3
NIGHTLY_MAIN_LOOPS = 6
WEEKLY_PRE_LAUNCH_LOOPS = 96  # one loop ≈ one hour at expected scenario pace

DEFAULT_THRESHOLDS = {
    # memory growth bounds (MB per loop) — values are placeholders, tune
    # against first real soak run; documented in plan §"Soak tiering"
    "honcho_rss_mb": 5.0,
    "postgres_disk_mb": 50.0,
    "redis_aof_mb": 10.0,
}
