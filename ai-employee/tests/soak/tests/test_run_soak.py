"""Tests for ai-employee/tests/soak/run_soak.py.

Coverage:

  - linear_regression: pure-Python LSQ fit on contrived inputs
  - fit_metrics: derives one LinearFit per metric across samples
  - evaluate_gate: compares slope against threshold per metric
  - run_soak: full loop with injected fake source + fake runner
  - Memory leak detection: fake source with growing values triggers
    the gate
  - No-growth bounded run passes the gate
  - All scenarios passed → overall_passed=True
  - Any scenario failed → overall_passed=False
  - render_markdown_report shape includes summary + per-metric table

Uses fake MetricSource + ScenarioRunner so tests don't require psutil,
network, or wrangler.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))

from run_soak import (  # noqa: E402
    DEFAULT_THRESHOLDS,
    LinearFit,
    MetricSample,
    ScenarioOutcome,
    SoakConfig,
    evaluate_gate,
    fit_metrics,
    linear_regression,
    render_markdown_report,
    run_soak,
)


class TestLinearRegression:
    def test_perfect_linear_fit(self):
        # y = 2x + 1
        samples = [(0, 1.0), (1, 3.0), (2, 5.0), (3, 7.0)]
        slope, intercept = linear_regression(samples)
        assert slope == pytest.approx(2.0)
        assert intercept == pytest.approx(1.0)

    def test_zero_slope_for_constant_values(self):
        samples = [(0, 5.0), (1, 5.0), (2, 5.0), (3, 5.0)]
        slope, intercept = linear_regression(samples)
        assert slope == pytest.approx(0.0)
        assert intercept == pytest.approx(5.0)

    def test_single_sample_returns_intercept(self):
        slope, intercept = linear_regression([(5, 42.0)])
        assert slope == 0.0
        assert intercept == 42.0

    def test_empty_returns_zero(self):
        slope, intercept = linear_regression([])
        assert slope == 0.0
        assert intercept == 0.0


class TestFitMetrics:
    def test_one_metric_one_fit(self):
        samples = [
            MetricSample(0, 1000.0, {"honcho_rss_mb": 100.0}),
            MetricSample(1, 1001.0, {"honcho_rss_mb": 105.0}),
            MetricSample(2, 1002.0, {"honcho_rss_mb": 110.0}),
        ]
        fits = fit_metrics(samples)
        assert len(fits) == 1
        assert fits[0].metric_name == "honcho_rss_mb"
        assert fits[0].slope_per_loop == pytest.approx(5.0)
        assert fits[0].samples == 3

    def test_multiple_metrics_independent_fits(self):
        samples = [
            MetricSample(0, 1000.0, {"a": 0.0, "b": 0.0}),
            MetricSample(1, 1001.0, {"a": 1.0, "b": 2.0}),
            MetricSample(2, 1002.0, {"a": 2.0, "b": 4.0}),
        ]
        fits = fit_metrics(samples)
        fits_by_name = {f.metric_name: f for f in fits}
        assert fits_by_name["a"].slope_per_loop == pytest.approx(1.0)
        assert fits_by_name["b"].slope_per_loop == pytest.approx(2.0)

    def test_empty_samples_returns_empty(self):
        assert fit_metrics([]) == []


class TestEvaluateGate:
    def test_no_threshold_no_failure(self):
        fits = [LinearFit("metric_x", 100.0, 0.0, 3)]
        assert evaluate_gate(fits, {}) == []

    def test_under_threshold_passes(self):
        fits = [LinearFit("memory", 3.0, 0.0, 5)]
        assert evaluate_gate(fits, {"memory": 5.0}) == []

    def test_over_threshold_fails(self):
        fits = [LinearFit("memory", 10.0, 0.0, 5)]
        failures = evaluate_gate(fits, {"memory": 5.0})
        assert len(failures) == 1
        assert "memory" in failures[0]
        assert "10.000" in failures[0]
        assert "5.000" in failures[0]

    def test_multiple_metrics_multiple_failures(self):
        fits = [
            LinearFit("memory", 10.0, 0.0, 5),
            LinearFit("disk", 100.0, 0.0, 5),
            LinearFit("cpu", 1.0, 0.0, 5),  # below threshold
        ]
        failures = evaluate_gate(
            fits, {"memory": 5.0, "disk": 50.0, "cpu": 2.0}
        )
        assert len(failures) == 2


class FakeMetricSource:
    """Returns the next pre-scripted value vector on each call.

    Lets the test prescribe exactly what growth pattern the runner sees.
    """

    def __init__(self, scripted: list[dict[str, float]]):
        self._scripted = list(scripted)
        self._calls = 0

    def __call__(self) -> dict[str, float]:
        if self._calls < len(self._scripted):
            value = self._scripted[self._calls]
        else:
            value = self._scripted[-1]
        self._calls += 1
        return value


class FakeScenarioRunner:
    """Returns scripted scenario outcomes. Defaults to all-pass."""

    def __init__(self, outcomes: list[ScenarioOutcome] | None = None):
        self._outcomes = list(outcomes) if outcomes else []
        self._calls = 0

    def __call__(self, scenario_id: str) -> ScenarioOutcome:
        if self._calls < len(self._outcomes):
            outcome = self._outcomes[self._calls]
        else:
            outcome = ScenarioOutcome(
                scenario_id=scenario_id,
                passed=True,
                duration_seconds=0.0,
            )
        self._calls += 1
        return outcome


class FakeClock:
    def __init__(self, start=1000.0):
        self.now = start

    def __call__(self):
        self.now += 0.1
        return self.now


class TestRunSoak:
    def test_bounded_growth_passes_gate(self):
        config = SoakConfig(
            scenario_ids=["a", "b", "c"],
            loops=3,
            slope_thresholds={"honcho_rss_mb": 5.0},
        )
        source = FakeMetricSource([
            {"honcho_rss_mb": 100.0},
            {"honcho_rss_mb": 102.0},
            {"honcho_rss_mb": 104.0},
            {"honcho_rss_mb": 106.0},
        ])
        runner = FakeScenarioRunner()
        report = run_soak(
            config=config,
            metric_source=source,
            scenario_runner=runner,
            now_fn=FakeClock(),
        )
        assert report.overall_passed is True
        assert report.loops_completed == 3
        assert report.scenarios_executed == 9
        assert report.scenarios_failed == 0
        assert not report.gate_failures

    def test_memory_leak_fails_gate(self):
        config = SoakConfig(
            scenario_ids=["a"],
            loops=3,
            slope_thresholds={"honcho_rss_mb": 5.0},
        )
        # 10 MB per loop = leak (above 5 MB threshold)
        source = FakeMetricSource([
            {"honcho_rss_mb": 100.0},
            {"honcho_rss_mb": 110.0},
            {"honcho_rss_mb": 120.0},
            {"honcho_rss_mb": 130.0},
        ])
        runner = FakeScenarioRunner()
        report = run_soak(
            config=config,
            metric_source=source,
            scenario_runner=runner,
            now_fn=FakeClock(),
        )
        assert report.overall_passed is False
        assert len(report.gate_failures) == 1
        assert "honcho_rss_mb" in report.gate_failures[0]

    def test_scenario_failure_fails_overall(self):
        config = SoakConfig(
            scenario_ids=["a", "b"],
            loops=1,
        )
        source = FakeMetricSource([{"honcho_rss_mb": 100.0}])
        runner = FakeScenarioRunner(outcomes=[
            ScenarioOutcome("a", passed=True, duration_seconds=0.1),
            ScenarioOutcome("b", passed=False, duration_seconds=0.1, error="boom"),
        ])
        report = run_soak(
            config=config,
            metric_source=source,
            scenario_runner=runner,
            now_fn=FakeClock(),
        )
        assert report.scenarios_failed == 1
        assert report.overall_passed is False

    def test_loops_and_samples_count(self):
        config = SoakConfig(
            scenario_ids=["a"],
            loops=5,
        )
        source = FakeMetricSource([{"x": 0.0}] * 10)
        runner = FakeScenarioRunner()
        report = run_soak(
            config=config,
            metric_source=source,
            scenario_runner=runner,
            now_fn=FakeClock(),
        )
        # One sample per loop + one final sample = 6 samples for 5 loops.
        assert len(report.samples) == 6
        assert report.loops_completed == 5
        assert report.scenarios_executed == 5


class TestRenderReport:
    def test_report_has_summary_and_metrics_table(self):
        config = SoakConfig(
            scenario_ids=["a"],
            loops=2,
            slope_thresholds={"memory": 5.0},
        )
        source = FakeMetricSource([
            {"memory": 100.0},
            {"memory": 102.0},
            {"memory": 104.0},
        ])
        runner = FakeScenarioRunner()
        report = run_soak(
            config=config,
            metric_source=source,
            scenario_runner=runner,
            now_fn=FakeClock(),
        )
        text = render_markdown_report(report, mode_label="3h-compressed")
        assert "# Soak report (3h-compressed)" in text
        assert "**PASS**" in text
        assert "Loops completed: 2" in text
        assert "memory" in text
        assert "| Metric |" in text

    def test_report_shows_fail_when_gate_breached(self):
        config = SoakConfig(
            scenario_ids=["a"],
            loops=2,
            slope_thresholds={"memory": 1.0},
        )
        source = FakeMetricSource([
            {"memory": 100.0},
            {"memory": 110.0},
            {"memory": 120.0},
        ])
        runner = FakeScenarioRunner()
        report = run_soak(
            config=config,
            metric_source=source,
            scenario_runner=runner,
            now_fn=FakeClock(),
        )
        text = render_markdown_report(report, mode_label="3h")
        assert "**FAIL**" in text
        assert "Gate failures" in text


class TestDefaults:
    def test_default_thresholds_have_documented_metrics(self):
        assert "honcho_rss_mb" in DEFAULT_THRESHOLDS
        assert "postgres_disk_mb" in DEFAULT_THRESHOLDS
        assert "redis_aof_mb" in DEFAULT_THRESHOLDS
