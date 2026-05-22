# Draft Output Format

Two outputs per skill invocation:

1. **The draft itself** created via `Email.create_draft` into the supervising partner's drafts folder. Per ADR 0005 this is the only external surface. The partner reviews, fills in TBDs, edits, and clicks send from their own mail client.
2. **The matter-internal sourcing note** written at `~/.hermes/customer_notes/{customer_slug}/pi-opposing-counsel-response-YYYY-MM-DD-<matter-id>.md`. Records what populated each section. Read by the dashboard's "what Marcus used to write this" sourcing block. Never sent.

Section order is fixed. The partner scans the draft top-to-bottom; section order is the scan order.

## Draft section order

```
1. Header block (firm letterhead, case caption, response-due-date)
2. Subject line ("Re: <inbound subject>" or "<correspondence kind label> regarding <case caption>, <case number>")
3. Recitation lead-in (one paragraph identifying the inbound, received date, and the response posture)
4. Inbound-claim recital (verbatim quotes of every factual claim in the inbound, with sentence-level pointers)
5. Tone-classification label (one line, from the firm's memory-rule vocabulary)
6. Prior-correspondence record (chronological table sourced from EmailThread)
7. Substantive response (TBD marker, partner authors; shape varies by correspondence kind)
8. Closing case-strategy paragraph (TBD marker, partner authors)
9. Partner sign-off block (from customer.yaml)
```

## Section templates

### 1. Header block

```
<Firm letterhead from customer.yaml>

<Today's date in "Month D, YYYY" format>

<Opposing counsel name from matter.custom_fields.opposing_counsel_name, or TBD>
<Opposing counsel firm from matter.custom_fields.opposing_counsel_firm, or TBD>
<Opposing counsel mailing address from matter.custom_fields, or TBD>

Re: <Case caption from matter.custom_fields.case_caption>
Case Number: <Case number from matter.custom_fields.case_number, or TBD>
Our Client: <Client name from matter.client_name>
Response Due: <Response due date in "Month D, YYYY" format, or TBD>
```

Every angle-bracketed value renders from a sourced field or as a TBD marker. The skill does not author addresses, names, or case numbers it cannot source.

### 2. Subject line

For `Email.create_draft`, `DraftInput.subject` is:

```
Re: <inbound message subject>
```

If the inbound has a parseable subject. Otherwise:

```
<correspondence kind label> regarding <case caption>, <case number>
```

Where `<correspondence kind label>` is one of "Settlement correspondence", "Motion correspondence", or "Scheduling correspondence". Where any component is absent, that component renders as `TBD`; the partner edits the subject line on review.

### 3. Recitation lead-in

One paragraph, two to four sentences. Sourced from matter attributes and the parsed inbound metadata.

```
<Plaintiff or Defendant designation> <client name>, by and through undersigned counsel, responds to opposing counsel's <correspondence kind in noun form> of <inbound received date in "Month D, YYYY"> regarding <inbound subject or correspondence kind topic>. The factual claims in the inbound message are quoted in the section below; the response posture is set out under separate cover.
```

If the received date cannot be sourced, the date clause renders as `[TBD: inbound received date - partner confirms]`. The skill does not invent a date.

### 4. Inbound-claim recital

The section quotes every factual claim from the inbound message verbatim. Each claim is wrapped in quotation marks and attributed with a sentence-level pointer.

```
## Inbound factual claims (verbatim quotes from opposing counsel's letter of <received date>)

Inbound, paragraph 1: "<verbatim text of the claim>"

Inbound, paragraph 2: "<verbatim text of the next claim>"

Inbound, paragraph N: "<verbatim text of further claims>"
```

The skill identifies factual claims by sentence structure (declarative sentences containing dates, dollar amounts, named documents, named persons, named courts, named dockets, named deadlines). Open-ended argument prose from the inbound is not "factual claim" in this sense; it appears in the response body only when it carries one of the inbound-pattern factual elements.

For settlement counter-offers, the recital quotes the offer amount (verbatim, including the dollar amount), the proposed payment timing, the proposed release terms, and any conditions.

For motion correspondence, the recital quotes the motion title, the relief sought, the filing date, and any factual statements about the matter's procedural posture (e.g., "discovery in this matter closes on July 31, 2026").

For scheduling correspondence, the recital quotes the proposed dates, the proposed venues, the affected deadlines, and any conditional proposals.

### 5. Tone-classification label

One line. Sourced from the firm's memory-rule vocabulary. No prose elaboration.

```
Inbound tone classification (memory-rule sourced): `<label>`
```

Where `<label>` is one of `routine`, `contested`, `hostile`, `procedural`, `urgent`, or any other label defined in `customer.yaml.memory_rules.correspondence_tone_categories`. The skill emits one label, not a list.

### 6. Prior-correspondence record

Chronological table sourced from EmailThread message IDs. Table shape:

```
## Prior correspondence on this thread

<one-line scope note: which thread the table draws from, e.g., "Sourced from settlement thread settlement_thread_42">

| Date       | Direction | Sender                  | Subject                                       | Synopsis                          |
| ---------- | --------- | ----------------------- | --------------------------------------------- | --------------------------------- |
| 2026-04-18 | Outbound  | Sarah Holcomb           | Demand for settlement, Holloway v. Kerr       | <verbatim synopsis if recorded>   |
| 2026-04-25 | Inbound   | Theodora Whitfield      | Re: Demand for settlement, Holloway v. Kerr   | <verbatim synopsis if recorded>   |
| 2026-05-12 | Inbound   | Theodora Whitfield      | Settlement counter-offer, Holloway v. Kerr    | <verbatim synopsis if recorded>   |
```

The Date column renders as `YYYY-MM-DD`. The Direction column is `Outbound` (sent by the firm) or `Inbound` (sent by opposing counsel). The Sender column is the message's sender name. The Subject column is the message's subject line verbatim. The Synopsis column is the message's `synopsis` field from EmailThread if present, or `[no synopsis recorded]` if absent. The skill never authors a synopsis.

If the relevant thread is empty (no prior correspondence on this matter for this correspondence kind), the section renders as:

```
## Prior correspondence on this thread

The matter file contains no prior <settlement | motion | scheduling> correspondence as of <today's date in "Month D, YYYY">. The inbound of <received date> appears to be the first correspondence on this thread.
```

### 7. Substantive response

Shape varies by correspondence kind. Each kind has a fixed TBD-marker pattern.

#### 7a. Settlement counter-offer

```
## Substantive response

`[TBD: substantive settlement-counter response - partner authors. The skill emits no number, no acceptance, no rejection, no counter-counter, and no negotiation framing. Settlement authority is partner work per the firm's authority matrix. The inbound's offer amount is quoted verbatim above; the prior settlement-history table above provides the chronological context; the partner authors the response posture.]`
```

#### 7b. Motion correspondence

```
## Substantive response

`[TBD: substantive motion response - partner authors. The skill emits no concession, no opposition framing, no procedural posture, and no characterization of the motion's merits. Legal-argument authoring is partner work. The inbound's motion title, relief sought, and procedural-posture claims are quoted verbatim above; the prior motion-correspondence table above provides the chronological context; the partner authors the response.]`
```

#### 7c. Scheduling correspondence

```
## Substantive response

`[TBD: substantive scheduling response - partner authors. The skill emits no agreement, no refusal, no alternative date, and no conditional acceptance. Scheduling commitments are partner work per the firm's calendar-authority matrix. The inbound's proposed dates, venues, and conditional proposals are quoted verbatim above; the prior scheduling table above provides the chronological context; the partner authors the response.]`
```

### 8. Closing case-strategy paragraph

Always a TBD marker. The skill never authors this section.

```
[TBD: closing paragraph - partner authors per firm template. The skill emits no language about settlement posture, motion-to-compel risk, sanctions exposure, meet-and-confer obligations, or any forward-looking case-strategy language.]
```

### 9. Partner sign-off block

Pulled verbatim from `customer.yaml`:

```
<Partner first name and last name>
<Partner title (e.g., "Managing Partner")>
<Firm name>
<Firm address>
<Firm phone>
<Partner direct email>
```

The skill never authors a sign-off line, a "Sincerely," "Respectfully," or any closing salutation. The partner's signature block is what their voice samples capture, and that block is what the skill renders.

## Matter-internal sourcing note format

Output path: `~/.hermes/customer_notes/{customer_slug}/pi-opposing-counsel-response-YYYY-MM-DD-<matter-id>.md`.

Structure:

```markdown
# PI Opposing Counsel Response Sourcing Note: <matter-id>

**Matter:** <matter ID and client name>
**Correspondence kind:** <settlement_counter_offer | motion_correspondence | scheduling_correspondence>
**Inbound message ID:** <message_id>
**Inbound received date:** <YYYY-MM-DD>
**Inbound factual-claim count:** <count>
**Prior-correspondence row count:** <count>
**Drafted:** <ISO-8601 timestamp>
**Draft reference:** <DraftRef.id from Email.create_draft, or "dry-run" if --dry-run>
**Voice-gate score:** <score and pass/fail>
**Fabrication-filter result:** <clean | flag | block, plus any violations>

## Readiness classification

| Axis                         | Value     | Evidence                                                       |
| ---------------------------- | --------- | -------------------------------------------------------------- |
| Matter scope                 | IN_SCOPE  | matter_type=auto-accident, in PI registry                      |
| Matter status                | ACTIVE    | matter.status=open                                             |
| Inbound kind resolvability   | RESOLVED  | settlement_counter_offer (confidence 0.94)                     |
| Tone vocabulary              | READY     | customer.yaml.memory_rules.correspondence_tone_categories pres |
| Voice envelope readiness     | READY     | 35 Layer 2 samples (above the 30 threshold)                    |
| Citation risk in source data | CLEAN     | No citation-shaped strings in skill-read custom_fields         |
| Dollar-amount risk           | QUOTED_OK | Dollar amounts in inbound recital only (verbatim-quote exempt) |

## Sourcing index

| Section               | Field                 | Sourced from                                           | TBD? |
| --------------------- | --------------------- | ------------------------------------------------------ | ---- |
| Header                | opposing_counsel_name | matter.custom_fields.opposing_counsel_name             | no   |
| Header                | opposing_counsel_firm | matter.custom_fields.opposing_counsel_firm             | no   |
| Header                | case_caption          | matter.custom_fields.case_caption                      | no   |
| Header                | case_number           | matter.custom_fields.case_number                       | no   |
| Header                | response_due_date     | computed from inbound metadata + firm rule             | no   |
| Recitation            | client_name           | matter.client_name                                     | no   |
| Recitation            | received_date         | EmailThread message_id metadata                        | no   |
| Inbound-claim recital | claim[1]              | EmailThread message_id (paragraph 1 verbatim)          | no   |
| Inbound-claim recital | claim[N]              | EmailThread message_id (paragraph N verbatim)          | no   |
| Tone classification   | label                 | memory_rule "correspondence_tone_categories"           | no   |
| Prior correspondence  | row[1]                | EmailThread message_id (prior message)                 | no   |
| Substantive response  | (none)                | client_facing_fields.<kind>\_substantive_response=none | TBD  |
| Closing               | (none)                | client_facing_fields.case_strategy_language=none       | TBD  |

## Could not source

- (item-level list of any field that fell back to TBD)

## Refusal events

- (none)

## Citation refusal events

- (none)

## Dollar-amount refusal events

- (none; all dollar amounts in the draft are inside the verbatim-quoted inbound recital or verbatim-quoted prior-correspondence table)

## Voice-gate detail

- Sentence-length p50: <p50> words. p95: <p95> words. (Within envelope.)
- Banned-pattern hits: <count>.
- Layer 2 similarity: <score> (threshold <threshold>). Pass.

## Adapter calls made

- PracticeManagement.get_matter("<matter_id>") 1 call
- EmailThread.get_message("<inbound_message_id>") 1 call
- EmailThread.list_messages_for_matter({matter_id: "<matter_id>", thread_tag: "<correspondence kind>"}) 1 call
- EmailThread.get_message(...) per prior-correspondence row N calls
- Email.create_draft(...) 1 call
```

Every adapter call is recorded. The dashboard's "what Marcus used to write this" sourcing block reads the sourcing index. Compliance evidence packets export the sourcing note alongside the draft.

## Format rules summary

1. **No prose outside the named sections.** The agent does not write paragraphs of analysis or self-justification. The note is scannable.
2. **Every section header appears even when its content is empty.** Empty sections read "Empty." or "(none)" rather than being omitted.
3. **Tables use the standard markdown pipe-and-hyphen syntax.** The hyphens are ASCII hyphens, not em dashes or en dashes.
4. **No em dashes anywhere.** Use commas and periods. The hyphen character is fine in compound words.
5. **TBD markers are bracketed and one-line.** `[TBD: <section> - partner authors]`. The partner scans for `[TBD:` to find their authoring queue.
6. **Verbatim inbound text is preserved exactly.** The recital quotes the inbound text from the source message without reformatting, rewording, or paraphrase. Length differences across claims are not normalized.
7. **No dollar amounts outside the verbatim-quote envelope.** Dollar amounts appear in the inbound-claim recital (verbatim) and inside the verbatim-quoted prior-correspondence table only. Substantive-response sections render as TBD, full stop.
