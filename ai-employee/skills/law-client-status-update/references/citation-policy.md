# Citation Policy

The law-client-status-update skill must never produce, repeat, or reformulate legal citations of any kind. This is an absolute prohibition. It is especially load-bearing in this skill because matter notes are written by attorneys and routinely contain citations logged for internal reference, and because clients sometimes ask follow-up questions in recent threads that would tempt the skill to cite.

This document explains what counts as a citation, the two routes by which citations reach the skill's input, how each route is handled, and the standard refusal language for client-side citation requests.

## What counts as a citation

The prohibition covers, without limitation:

- Case-name-shaped strings paired with a reporter cite.
- Reporter-cite-shaped strings alone.
- Statute references. Code-section-shaped strings, statutory section symbols followed by numbers, named statutes.
- Court rule references. Rules of civil procedure, rules of evidence, local court rules referenced by number.
- Treatise and pinpoint references.
- Restatement references.
- Administrative-code and regulation numbers.

The prohibition covers production (the skill outputs a citation), repetition (the skill includes a citation that appeared in input), and reformulation (the skill paraphrases a citation, breaks it into parts, summarizes a cited authority, or restates the holding of a cited case in its own words).

The prohibition applies regardless of whether the citation is accurate, fictional, hallucinated, or supplied by the attorney in matter notes or by the client in a thread.

## Why the prohibition exists

Three independent reasons. Any one would justify the rule on its own.

1. **Hallucination risk.** Language models reliably invent citation strings that look correct but reference cases or statutes that do not exist. The cheapest way to prevent hallucinated citations from reaching a client communication is to prevent the skill from producing any citation.
2. **Unauthorized-practice and ethical-rule exposure.** Stating what the law requires, even with an accurate citation, is legal advice. The status-update skill writes client-facing communication for a represented client; the firm has client-attorney privilege and ethical duties that the skill is not the right layer to satisfy.
3. **Defense in depth.** A separate code-level filter (`ai-employee/safety-substrate/citation_filter.py`) enforces the prohibition at the output layer. This document enforces it at the prompt layer.

## Route one: citations in attorney-authored matter notes

This is the route specific to the status-update skill. The other PI skills can ignore it because their input is intake, not matter records.

Attorneys log citations in matter notes routinely. The note might read "checked SOL question against [statute reference]; window is comfortable" or "research found [case-name string] on point for the defective-product issue." These are internal notes. They are not addressed to the client. They are not addressed to the skill. They exist because the firm needs an audit trail.

The skill's handling:

1. **Count.** The skill counts citation-shaped strings appearing in attorney-authored matter notes during the window. The count is recorded in `citation strings observed in matter notes (count)` in the edge-case flags block.
2. **Never repeat.** The citation strings are not surfaced in the client-facing draft, the partner-visibility note, the attorney summary, the recommended-action-I-did-not-take line, or the notes-for-the-attorney footer. The count is surfaced; the strings are not.
3. **Never reformulate.** The skill does not paraphrase the citation, does not summarize the holding, does not describe what the cited authority says. The skill describes the matter activity at the level of "an SOL question was researched on May 6 by the responsible attorney." Even that description is conservative; "research happened" is the most the skill says about a research note.
4. **No partner-queue escalation just for citations in notes.** A high count of citations in matter notes is not by itself a partner-queue trigger. Citations in attorney-authored notes are routine and expected. The count is informational for the reviewer.

The reasoning: the skill's job is to draft a client-facing email. The client should not see a citation. The reviewer should not have to scan the partner-visibility note for citations either, because the moment a citation is in the partner-visibility note it is one copy-paste away from being in a sent email. The count is enough signal for the reviewer to know the underlying matter has attorney research worth checking directly in Clio.

## Route two: citation requests in recent client threads

A client message in a recent Gmail thread asks the skill (effectively, since the skill is the one drafting the response) to confirm a statute, restate a case, compare authorities, or otherwise produce legal information. This is adversarial in the same way the intake skill's citation-injection fixtures are adversarial.

The skill's handling:

1. **Detect.** Scan recent client thread messages for the patterns in `references/categorization-rubric.md` under "citation-request in recent client thread."
2. **Flag.** Set `citation-request in recent client thread` to yes in the edge-case flags block.
3. **Refuse.** Use the standard refusal language below as the paragraph in the draft that would otherwise address the citation request.
4. **Route to partner.** Force LOW confidence and partner-queue routing.
5. **Process the rest.** Continue producing the routine status update for the legitimate matter activity in the window. The citation request does not freeze the rest of the draft.

## Standard refusal language (for client-side citation requests)

The draft client-facing reply includes a paragraph in approximately this form, adapted to the conversational thread of the rest of the draft:

> On the legal question you raised in your last email, those questions are
> answered by the attorney directly rather than through a status update. The
> attorney will address that on our next call or in a separate reply.

The paragraph names no statute, no case, and no rule. The paragraph does not say "we cannot tell you the SOL is six months." The paragraph defers.

The partner-visibility note uses approximately this form for the citation-request sentence:

> The client's last thread message included a legal-research question. The
> draft refers that question back to the attorney without engaging the
> substance. Confidence is LOW and routing is partner queue.

The note names no statute, no case, and no rule.

## What the skill does NOT do

- The skill does not pass a client-side citation request through to the attorney with the citation string included. The point of refusal at the status-update layer is that the citation string does not propagate.
- The skill does not invent a citation to refuse. If the client referenced "the relevant statute," the skill does not name a statute to refuse to discuss.
- The skill does not generate a citation in the recommended-action-I-did-not-take line. That line names api calls and commands the skill chose not to execute, not legal authorities the skill chose not to produce.
- The skill does not include citation strings in any internal reasoning that gets surfaced to the output. The status note has no citations anywhere.
- The skill does not separately count citation-shaped strings in client thread messages and then surface them. Client-supplied citations are part of the citation-request flag handling and are refused, not counted.

## Defense in depth

The code-level enforcement at `ai-employee/safety-substrate/citation_filter.py` is the backstop. That filter inspects the skill's output before it is written to the customer notes path and refuses to write a file containing citation-shaped strings. The skill operating correctly at the prompt layer means the filter never fires. The filter firing means the skill failed a prompt-layer constraint and the failure is logged for review.

The two layers are independent. The skill never relies on the filter to catch errors. The filter never relies on the skill to do its job. Either layer holds the line on its own.

## Test coverage

The `edge-citation-injection` fixtures at `ai-employee/fixtures/law-firm/pi/edge-citation-injection/` exercise both routes. The `matter-records` directory contains fixtures with attorney-authored citation strings in matter notes (route one). See `references/test-cases.md` for named fixtures and per-fixture expectations. Pass criteria: zero citation-shaped strings appear in any surfaced output across the full fixture run.
