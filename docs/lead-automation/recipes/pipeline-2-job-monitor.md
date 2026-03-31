# Make.com Recipe: Pipeline 2 — Job Posting Monitor

**Purpose:** Step-by-step guide to build the Make.com scenario that monitors Phoenix job postings for operational pain signals at small businesses.

**Prerequisites:**

- SerpAPI account with API key (Developer plan, $50/mo)
- Anthropic API key
- Google Sheets: "SMD Lead Generation" spreadsheet with "Job Signal Leads" tab (see google-sheets-schema.md)
- Slack: #lead-signals channel created
- Make.com Data Store: `seen_jobs` created (see make-data-store-schema.md)

---

## Scenario Overview

```
Schedule (daily 6am)
  → HTTP: SerpAPI query 1
  → Iterator: each job result
    → Data Store: check seen_jobs (dedup)
    → Filter: only new jobs
    → Anthropic: qualify with Claude
    → Filter: only qualified = true
    → Google Sheets: append row
    → Slack: notification
    → Data Store: mark as seen
```

**Total modules per job processed:** ~8
**Expected daily volume:** 5-15 new jobs across 8 queries
**Operations per run:** ~100-200 (8 queries × ~10 results × ~8 modules for new ones, minus filtered dupes)

---

## Step-by-Step Build

### Step 1: Create the Scenario

1. In Make.com → Scenarios → Create a new scenario
2. Name: `Lead Gen: P2 Job Monitor`
3. Set the schedule: **Every day at 6:00 AM** (MST/Arizona time — Arizona does not observe DST)

### Step 2: Add the Trigger — Scheduled

1. The scenario trigger is **Schedule** (built-in)
2. Set to run once daily at 6:00 AM
3. This fires the first module in the chain

### Step 3: Module 1 — HTTP (SerpAPI Query)

We need to run 8 queries. The simplest approach: use a **Set Variable** module to define the query list, then iterate.

**Module: Tools → Set multiple variables**

- Variable 1: `queries` (array)
- Value:

```json
[
  "office manager",
  "operations manager",
  "dispatcher",
  "scheduling coordinator",
  "customer service coordinator",
  "office administrator",
  "front desk manager",
  "service coordinator"
]
```

### Step 4: Module 2 — Iterator (Query List)

**Module: Flow Control → Iterator**

- Source array: `{{queries}}` (from the Set Variable module)
- This processes each query term one at a time

### Step 5: Module 3 — HTTP (SerpAPI Request)

**Module: HTTP → Make a request**

| Setting          | Value                        |
| ---------------- | ---------------------------- |
| URL              | `https://serpapi.com/search` |
| Method           | GET                          |
| Query parameters | See below                    |
| Parse response   | Yes                          |

**Query parameters:**
| Key | Value |
|-----|-------|
| `engine` | `google_jobs` |
| `q` | `{{iterator.value}}` (the current query term) |
| `location` | `Phoenix, Arizona, United States` |
| `chips` | `date_posted:3days` |
| `api_key` | `{{SERPAPI_API_KEY}}` (from connection or scenario variable) |

**Error handling:** Add an error route → Resume (continue to next query if one fails)

### Step 6: Module 4 — Iterator (Job Results)

**Module: Flow Control → Iterator**

- Source array: `{{HTTP.body.jobs_results}}` (the jobs array from SerpAPI response)
- If `jobs_results` is empty or undefined, the iterator produces 0 items → scenario continues to next query

### Step 7: Module 5 — Data Store (Dedup Check)

**Module: Data Store → Get a record**

- Data store: `seen_jobs`
- Key: Use a hash of company + title + location. In Make.com, construct the key:
  ```
  {{sha256(iterator2.company_name + "|" + iterator2.title + "|" + iterator2.location)}}
  ```
  (If `sha256` is not available natively, use `md5` or concatenate the fields as the key directly — just ensure uniqueness)

**Alternative simpler key:** `{{iterator2.company_name}}_{{iterator2.title}}` (less collision-proof but functional)

### Step 8: Filter — Only New Jobs

**Add a filter between the Data Store module and the next module:**

- Condition: Data Store module **did NOT return a record** (the record does not exist)
- In Make.com: the filter checks if the Data Store output bundle is empty
- Label: "New job only"

### Step 9: Module 6 — Anthropic (Claude Qualification)

**Module: Anthropic (Claude) → Create a Message**

| Setting       | Value                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Model         | `claude-sonnet-4-6` (cost-effective for classification tasks)                                                       |
| Max tokens    | `1024`                                                                                                              |
| System prompt | Paste the full content of `JOB_QUALIFICATION_SYSTEM_PROMPT` from `src/lead-gen/prompts/job-qualification-prompt.ts` |

**User message:**

```
Analyze this job posting and determine if it signals operational pain at a small business.

Job title: {{iterator2.title}}
Company: {{iterator2.company_name}}
Location: {{iterator2.location}}
Source: google_jobs
URL: {{iterator2.apply_options[1].link}}

Description:
{{iterator2.description}}

Produce a single JSON object matching the JobQualification schema.
```

### Step 10: Module 7 — Parse JSON

**Module: JSON → Parse JSON**

- JSON string: `{{anthropic.content[1].text}}` (Claude's response text)
- This converts the string into a structured object you can reference in downstream modules

### Step 11: Filter — Only Qualified

**Add a filter after the JSON parse:**

- Condition: `{{json.qualified}}` equals `true`
- Label: "Qualified only"

### Step 12: Module 8 — Google Sheets (Append Row)

**Module: Google Sheets → Add a Row**

- Spreadsheet: "SMD Lead Generation"
- Sheet: "Job Signal Leads"
- Column mapping:

| Column                   | Value                                    |
| ------------------------ | ---------------------------------------- |
| A: Company Name          | `{{json.company}}`                       |
| B: Job Title Posted      | `{{iterator2.title}}`                    |
| C: Location              | `{{iterator2.location}}`                 |
| D: Source                | `Google Jobs`                            |
| E: Company Size Estimate | `{{json.company_size_estimate}}`         |
| F: Qualified             | `Yes`                                    |
| G: Confidence            | `{{json.confidence}}`                    |
| H: Problems Signaled     | `{{join(json.problems_signaled; ", ")}}` |
| I: Evidence              | `{{json.evidence}}`                      |
| J: Outreach Angle        | `{{json.outreach_angle}}`                |
| K: Job Posting URL       | `{{iterator2.apply_options[1].link}}`    |
| L: Date Found            | `{{formatDate(now; "YYYY-MM-DD")}}`      |
| M: Status                | `New`                                    |

### Step 13: Module 9 — Slack (Notification)

**Module: Slack → Create a Message**

- Channel: `#lead-signals`
- Text:

```
:briefcase: *New Job Signal Lead*
*Company:* {{json.company}}
*Job Posted:* {{iterator2.title}}
*Confidence:* {{json.confidence}}
*Problems:* {{join(json.problems_signaled; ", ")}}
*Outreach Angle:* {{json.outreach_angle}}
*Link:* {{iterator2.apply_options[1].link}}
```

### Step 14: Module 10 — Data Store (Mark as Seen)

**Module: Data Store → Add/replace a record**

- Data store: `seen_jobs`
- Key: Same hash as Step 7
- Fields:
  - `company_name`: `{{iterator2.company_name}}`
  - `job_title`: `{{iterator2.title}}`
  - `first_seen`: `{{formatDate(now; "YYYY-MM-DD")}}`
  - `qualified`: `{{json.qualified}}`

---

## Craigslist RSS Addition

Add a second path to the scenario for Craigslist:

### Module: RSS → Watch RSS Feed Items

- URL: `https://phoenix.craigslist.org/search/jjj?query=office+manager&format=rss`
- Max items: 10
- Schedule: Every 6 hours (separate from the main daily SerpAPI run, or triggered by the same schedule)

Connect the RSS output to the same Anthropic → Filter → Sheets → Slack chain.

**Differences for Craigslist:**

- `source` = `craigslist`
- `company` may be extracted from the title or set to `"(Craigslist - see posting)"`
- RSS provides `title`, `link`, `description` (truncated), and `pubDate`
- Pass the `description` as the job description (it's shorter, Claude will work with what it has)

To monitor multiple Craigslist queries: use a Router module after the schedule trigger, with separate RSS modules for each query term on parallel paths.

---

## Testing Checklist

- [ ] Run scenario manually (right-click → Run once)
- [ ] Verify SerpAPI returns results (check HTTP module output)
- [ ] Verify dedup works: run twice, second run should skip all previously seen jobs
- [ ] Verify Claude produces valid JSON (check Anthropic module output)
- [ ] Verify qualified jobs appear in the Google Sheet
- [ ] Verify Slack notification arrives in #lead-signals
- [ ] Check operations count — should be within estimated 100-200 per run
- [ ] Let it run for 3 days automatically, then review all qualified leads for accuracy

---

## Tuning

After a week of running:

1. **False positives:** If too many large companies are being qualified, tighten the system prompt examples or add more disqualification criteria.
2. **False negatives:** If small businesses are being incorrectly disqualified, review the disqualified results (they're still in the Data Store with `qualified: false`) and adjust the prompt.
3. **Volume too low:** Add the expansion queries (see serpapi-queries.md) or increase `chips` from `3days` to `week`.
4. **Volume too high:** Add a filter for `confidence` — only pass `high` and `medium` to Sheets.
