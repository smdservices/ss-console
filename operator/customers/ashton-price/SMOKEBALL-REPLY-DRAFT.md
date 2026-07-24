# Reply to Smokeball — partner review (James Rozos), 2026-06-30

> Scott → partnersupport@smokeball.com. Re: SMD Operator app review.
> Posture: drop 2 (fees/read, billingconfiguration/read — no lane in a
> contingency PI practice), keep 4 (layouts, expenses, bankaccounts,
> bankaccountbalances — all in the contracted litigation lifecycle).

---

Hi James,

Thanks for the review and the clear guidance. Here's how the app uses each of the six:

Removing two. fees/read and billingconfiguration/read were carried over from a general law-firm template. Ashton & Price is a contingency personal-injury practice with no hourly accounts-receivable workflow, and settlement fee math is produced natively in Smokeball rather than by our app. We have no use for either, so we've removed both and re-saved.

Keeping four, each tied to the litigation lifecycle we support for the firm:

- layouts/read reads the matter's structured field data (date of loss, venue, carrier, case number) to prepare California Judicial Council forms such as CM-010, SUM-100, and MC-350. This is part of our litigation support buildout; the read lands with that work, and I'm glad to walk you through the intended usage or demonstrate it at that point.
- expenses/read reads advanced case costs, which the app compiles as inputs to the settlement disbursement. Smokeball produces the statement; we assemble and chase the inputs.
- bankaccounts/read and bankaccountbalances/read provide read-only confirmation that settlement funds have landed in trust before disbursement coordination begins. The app performs no fund movement of any kind.

Happy to demonstrate live staging calls for expenses, bankaccounts, and bankaccountbalances whenever that's useful.

Let me know if you'd like anything further, and thanks for helping move this along.

Best,
Scott
