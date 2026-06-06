# deadline-and-sol-tracker algorithm

Source of truth for surfacing critical dates without ever computing one.

## The authored-only rule

Every date this skill surfaces is read from Clio — an authored calendar entry or a task `due_at`. The skill performs exactly one kind of arithmetic: comparing an authored date to today, to assign a bucket. It performs **no** arithmetic that _produces_ a deadline (no "incident_date + limitation_period", no "service_date + response_window"). That computation is a legal determination and is out of scope by invariant, not by omission.

## Buckets

```
today = run date (passed in; no wall-clock in scripts)
for each authored_date d on an open matter:
    if d < today and matter open:  bucket = overdue
    elif d <= today + near_window: bucket = imminent     # firm-authored near window, e.g. 7d
    elif d <= today + scan_window: bucket = upcoming      # firm-authored scan window, e.g. 30d
    else:                          omit (outside scan)
```

`near_window` and `scan_window` are firm-authored (from `customer.yaml` where set; otherwise sensible defaults that the surface header states explicitly).

## Source labels

Each date carries the label the human gave it: `court-date`, `filing-deadline`, `sol`, `response-window`, `task-deadline`. The label is read, never inferred. A bare calendar entry with no deadline semantics is surfaced as a plain calendar date, not promoted to a deadline.

## Missing-where-expected

```
if firm_policy.expects_sol(matter.practice_area) and no authored sol on matter:
    surface "no authored deadline on file — needs human attention"
```

This is the only place the skill speaks about a date that does not exist, and it speaks by **pointing at the gap**, never by filling it. `firm_policy.expects_sol(...)` is firm-authored configuration; absent that configuration, the skill does not guess which matters "should" have an SOL.

## Why the line is absolute

A computed limitation date that is wrong is a malpractice-grade error, and a computed date that is _right_ still launders a legal judgment through an automated surface. Either way the firm would come to rely on a number the system is not competent to produce. So the skill produces no such number — it is a mirror for authored dates and a flag for missing ones, nothing more.
