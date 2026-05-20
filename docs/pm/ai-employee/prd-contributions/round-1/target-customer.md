# PRD Review Contribution — Target Customer

**Role:** Target Customer — 20-year PI Litigation Partner, Phoenix
**Date:** 2026-05-19
**Round:** 1

---

## Who I Am

I'm a personal injury plaintiff attorney. Been doing this for 20 years. I've tried cases to verdict and I've settled hundreds more. My firm handles auto accidents, premises liability, some products. We don't do medmal anymore — the economics stopped working for us around 2018. I have two paralegals I'd walk through fire for, an office manager named Debra who keeps the lights on, and one associate who's been with me for four years and is going to make a very good lawyer. We run Filevine. DocuSign for retainers. LawPay. Outlook. That's the stack.

My office manager Debra set this meeting up. She's been after me for six months about AI. I told her we'd take the meeting. I'll hear them out. I've been practicing long enough to know that most technology vendors are selling me something I don't need, solving a problem I've already solved, or both. But I've also been around long enough to know when something real is happening. So I'm going in with open eyes.

I watched what happened to the lawyers in Mata v. Avianca. I've been following it. I've seen the Wyoming case this year. That's not hypothetical risk to me — that's something that could happen to a partner I know, or to me.

---

## My Current Pain

Let me tell you what my day actually looks like.

I come in Monday and there are 22 emails I didn't deal with Friday. Twelve of them are client status requests — "what's happening with my case." I know what's happening with their case. Writing the email explaining it takes me four minutes. Forty-eight minutes total for status updates. That's a billable hour I'm writing into the wind on contingency work.

The other ten are a mix: an intake lead from the contact form, an adjuster who wants a call, a defense counsel who has a question about a deposition date, a LawPay notification, three DocuSign reminders I need to forward to my paralegal Maria, and two things that are actually important and require me to think.

Maria is managing 90 open matters. She's good. But she spends a meaningful chunk of her week chasing signatures and chasing records. Chasing. That's the word. She sends a reminder. She waits. She sends another one. She logs it. She sends another one. That's her morning, half the time. If you could take the chasing off her plate, she'd spend that time doing things that actually require Maria.

Debra handles intake screening but she's not a paralegal — she's an office manager, and intake has gotten more complicated than it was five years ago. We're getting more leads from the web. Some of them are real cases. A lot of them aren't. Right now she does a first cut, I do a second cut, and we lose about a day on cases we were never going to take.

Billing reconciliation is a mess. I'm not going to sugarcoat it. I know time is being lost and I know some expenses aren't getting captured. I'm not on top of it. Nobody is on top of it as much as they should be.

That's my current pain. It's real, it's mundane, and it's expensive.

---

## First Reactions

When Debra showed me the summary of what this product does, my first reaction was: that's a lot of claims for one product. My second reaction was: some of those are actually the things that eat my firm.

**What excites me:** The signing-chase piece. If this product can actually close out stalled DocuSign loops without Maria having to spend 40 minutes a week on reminder emails that should be automated — I'm interested. The intake triage sounds useful. The status update drafting sounds useful. The morning digest, if it's actually calibrated and not just noise, sounds like something I could use.

The memory piece is genuinely interesting to me. Not because I've thought about "AI memory" as a concept, but because I've thought about institutional knowledge. My firm knows things. Maria knows how we handle insurance adjusters. Debra knows how we screen intakes. My associate knows my settlement thresholds. That knowledge lives in people's heads. When a person leaves, it walks out the door. If this product can capture and hold some of that, I'm listening.

**What confuses me:** "One identity, every surface." I keep reading that phrase and I'm not sure I know what it means in practice. What I want to know is: what does Monday morning look like? What do I actually do differently? The PRD gives me architecture. I need operations.

Also — you're telling me I can name this thing. "Marcus." Why would I name it something? It's going to be drafting my client communications. Is it going to sign those communications as Marcus? Because if anything from this product is going in front of a client with a name attached that isn't mine, that's a problem. I need someone to explain this to me clearly. (I re-read it. I think I understand — it's an internal identity only, and externally everything comes from me. But it took me three passes to understand that, and I'm a skeptical reader. This needs to be explained in plain English in the first 60 seconds of any meeting.)

**What scares me:** I'm a plaintiff's attorney. My clients are injured people. They're anxious. They call. They email. They want to know someone is paying attention to their case. **If one of my clients ever figures out that the email they got from me was drafted by software, I'm in a conversation I don't want to have.** That's not a bar complaint risk — it's a trust collapse. I've built client relationships over 20 years. That's the thing I care most about protecting.

I'm also worried about the things I can't see. What is this thing reading in my email? I need to know exactly what it can see. Not in a general sense. Exactly.

---

## Feature Reactions

**The 5-7 skills in v1.** Inbox triage, morning digest, signing coordinator, intake triage, conflict check, status update drafting — yes, those are the right things to build. I'd use all of them. The medical records chronology generator is genuinely useful for a PI firm. The settlement statement assembler takes something that takes Maria two hours and turns it into something she reviews in 15 minutes. That math works.

**`pi-demand-letter-evidence-packet` (not the text).** I think this is the right call. I'm not going to let software write my demand letters. Demands are where I earn my fee. The theory of the case, the characterization of the injuries, the framing of liability — that's my judgment, built from 20 years of knowing what works with different carriers and different venues. What I want is to stop assembling the package by hand. Give me a clean chronology, a billing tabulation, an organized exhibit index, and I'll write the letter. That I'd use on day one.

**The dashboard.** The seven-tab v1 — Today, Queue, Memory, Audit, Persona, Skills, Voice — that's the right set for a first version. I'm not interested in a system that requires me to learn a new operating system. The daily digest approach is smart. I want to see what's pending in the morning and approve things from my phone. If the product can't reduce to that, I won't use it.

**The Memory tab and editability.** I actually like this. The concept of a product that exposes what it knows and lets me correct it is the right mental model. I don't want a black box. The specific thing I'd want to do immediately is set the rules: we don't take medmal, we don't take contingency cases under $50k, always CC Maria on new intake, never deal with a specific carrier without running it by me first. If I can type those rules into a memory tab and they actually apply — that's useful. What concerns me is whether the memory degrades or drifts. If I set a rule and six weeks later the agent isn't following it because something overwrote it, that's a loss of trust I won't recover from. I want to know how rule changes get flagged.

**The Voice calibration ask — 30+ samples and a calibration session.** I'll be honest: my first reaction to "upload 30 of your sent emails" is no. Those emails are client communications. They're not secret — they went to someone — but they contain case-specific information and I'm protective about what goes where. The PRD says it's a closed-loop architecture and my data isn't being used to train anything. I'd need that explained to me and I'd need it in writing before I upload anything. Once I understand it, I'd probably do it. But "probably" depends heavily on how that conversation goes.

The 90-minute calibration session with me is realistic. Four to six hours with Maria is also realistic — she'd do it, and she's the right person. I don't have that time. I'm glad the PRD figured out the split because a 4-6 hour block with me was never going to happen.

**The Audit log.** This is one of the best things in the product. Every read, every draft, every action logged. The "what the agent saw this week" view — I want that. When my ethics counsel asks how we're using AI, that's the answer. When a client asks if a robot wrote their email, I can say: here's exactly what happened, here's what I reviewed, here's what I sent. That's my defense. If this product doesn't have that, I wouldn't consider it.

**The compliance posture.** I've been in practice through enough regulatory changes to know that "we're defensible on bar ethics" and "your bar actually agrees with us" are different claims. The ABA FO 512 framing is legitimate. The paralegal-frame argument is the right framing. I've had paralegals draft client emails for 15 years. I review and send. Nobody has ever suggested that's a bar violation. If this product works the same way, architecturally — the agent drafts, I review, I send from my account — I can defend that. The question is whether it's genuinely architecturally enforced or whether it's a setting someone could turn off. The PRD says it's architectural. **I'd want to see that demonstrated, not described.**

---

### On the pre-provisioned demo approach (§11.3) — the consent-led framing

This is the thing I thought most about. The product was built against information scraped from my website before they walked in the door. Recent Verdicts, partner bios, published writing. Public information, but still.

Here's my honest reaction: if they walk in and say "we built this from your public website, here's what we read, here's what we hypothesized — is this right?" — I'm impressed. That's preparation. That's professional.

If they walk in and open a screen that shows my firm's name and partner bios without acknowledging where that came from — I'm uncomfortable. That's the difference between showing your work and performing surveillance theater. I'm a plaintiff's PI attorney. I litigate privacy cases. I notice that distinction.

The PRD has the consent framing right: acknowledge it in the first 60 seconds, offer to show what they read, let me say yes or no to proceeding on the pre-configured demo. That approach I'd respect. **Anything short of that explicit acknowledgment would make me trust the product less, not more.** The framing in the PRD is correct; the question is whether the person running the demo actually does it that way.

---

### On the "paralegal frame" compliance defense (§8.4)

It's a real argument. I believe the argument. The supervisory framework under Rules 5.1 and 5.3 is how I'd defend this if anyone asked. Paralegals draft client communications. Lawyers review and send. That's been the practice for decades and the bar has blessed it. The parallel holds.

What the paralegal frame doesn't resolve — and what I'd push back on in the meeting — is the judgment question. When Maria drafts a client status update, I know she understands the case. She's been on the file for months. She knows the client's personality. She knows what they're worried about. She exercises judgment I've trained her to exercise.

**Does this product exercise judgment, or does it pattern-match?** The honest answer probably involves both. I need to know where the line is. The PRD is careful to say the agent handles "operational supply chain, not judgment-bearing core." I'd push on a few specific scenarios to understand if that boundary holds in practice, not just in architecture.

---

### On the citation-refusal substrate — the live demo (§9, §11.2)

I want to see this. Not because I need convincing that citation hallucination is a problem — I know it's a problem, I've been following it since 2023 — but because I want to see that they've actually built the wall, not just described it.

The demo scenario in the PRD where someone asks for a motion citing Smith v. Jones and the substrate refuses — run that in front of me. Let me try variations. Let me try: "draft me a demand letter that mentions the case law on negligence." Let me see what happens. **I'm not trying to break the product. I'm trying to trust it.** The only way I trust an architectural defense is if I can probe it and it holds.

The framing in the revised demo design is right — Captain runs the adversarial scenarios first, shows the architecture, then invites me to suggest variations. That's the professional approach. The hubris version ("watch this never fail") is wrong. I've deposed enough expert witnesses to know that the person who says "this is foolproof" is the person I'm most suspicious of.

---

### On the reviewer-as-sender architecture — what's the friction (platform PRD §9.2)

The architecture is right. Drafts go to my drafts folder. I review. I send from my own account. No external communication ever goes out as the agent. I understand this and I think it's the correct design.

The friction question is: what does reviewing look like at volume? If there are 15 drafts a day in my queue and I'm approving most of them from my phone, I need the approval workflow to be so frictionless that I can get through it in 90 seconds. The PRD describes a "60-second daily loop" — digest scan, tap to approve or flag, done. That's the right target. If the approval UI requires me to navigate to a dashboard, open a draft, review it, edit it if needed, and then go back to approve, multiplied by 15 times, that's not 60 seconds. That's 15 minutes I don't have.

I'd want to see the actual approval UX during the demo. Not described. Shown.

---

### On the voice calibration ask — 30+ samples and calibration session

I addressed some of this above. The bigger issue for me is not the time, it's the expectation management. The PRD describes a 4-6 hour paralegal calibration and a 90-minute partner session, and then a blind test before any external drafts go out. I think that's the right sequencing. **What I want to know is: what do I get in week 1 while the calibration is happening?**

The PRD mentions a 10-business-day shadow mode and a daily digest. I assume during that period the agent is learning but not drafting externally. If that's the case, say it clearly: "for the first two weeks, nothing goes externally, we're learning your voice, here's what you'll see." That honesty would build trust with me faster than anything else in the pitch.

---

### On the Memory tab editability

I want control and I want auditability. Being able to read every rule the agent knows, correct wrong ones, and see what it learned from my edits — this is the right product surface for trust. My only concern is whether memory edits persist reliably. I don't want to set a rule and have it silently stop being applied because a newer correction overwrote it. The versioning helps, but I'd need to understand how rule conflicts get resolved.

---

### On the Day-1 / Week-1 / Week-4 experience (§11.8)

Day 1: 60-minute session with partner plus 4 hours with Maria — fine, that's the right allocation. Shadow mode, 8am digest, all skills defaulting to draft-for-review. This is a responsible onboarding design.

Week 1: Partner reviews 5-10 drafts a day. Paralegal handles memory edits, queue management. Captain checks in daily with the paralegal. **This is realistic only if the drafts are actually good.** If the drafts are 70% right and I'm spending 5 minutes editing each one instead of 30 seconds approving, the "60-second loop" collapses immediately. I need someone to tell me honestly: what will the first week's drafts look like, before the voice is fully calibrated? The PRD's "85% approval rate by week 4" implies there's a ramp. What's the ramp? What does week 1 look like?

Week 4: Conflict check goes autonomous, 85% approval rate, paralegal spending 30 minutes a day on the dashboard. That picture sounds right. The "first 'I forgot about that thing' moment" where the agent surfaces something the partner missed — I believe that's where stickiness comes from. That's the product earning its keep.

---

### On "the first hire your firm doesn't have to make" framing

I have two paralegals who've been with me for years. I'm not looking to replace them. This framing would land badly in my meeting if they used it without reading the room first.

**Maria knows that if this product does what it claims, her job changes.** She's smart enough to know that. The product doing her signing-chasing frees her for more interesting work. But "the first hire you don't have to make" sounds like "we'll help you not hire someone to replace Maria when she leaves." That's different from "Maria stops doing the part of her job she likes least."

I'd want to hear "capacity multiplier" language if anyone from my firm is in the room. Which they should be — if this product's daily operator is going to be Maria, she should be in that meeting. **A product the partner buys without the paralegal in the room is a product the paralegal has every reason to quietly undermine.** I've seen this happen with software rollouts before. The PRD understands this (§3, Persona 2) — the question is whether the person running the meeting actually does it.

---

### On the expansion roadmap — Workers' Comp, SSD next

Yes. We do workers' comp. About 25% of my book. The WC overlay would matter to me immediately. We don't do SSD. But the fact that the product is thinking about WC as the first expansion after PI — that tells me they understand how PI practices actually work. Most PI firms have a WC component. If the WC overlay is real and not three months away, that's a meaningful part of my interest.

The roadmap section in the law-firm PRD (§13) says WC is Round 1 with ~70% PI workflow overlap. I'd want to know in the meeting: is WC available at beta-1, or is it roadmap? If it's six months out, fine, but tell me.

---

### On the flat-monthly SKU — compared to loaded paralegal cost ~$70-90k

This is where I'm going to do mental math during the demo and I'd rather do it in advance.

A paralegal at my firm costs me roughly $75k fully loaded. That's salary, benefits, employer taxes, the desk, the systems. If this product is running $1,500 to $2,500 a month, that's $18k to $30k a year. If it does half what Maria does, it doesn't replace Maria — I still need Maria. But if it does the signing-chasing, the status update drafting, the intake triage, and the reconciliation work, Maria is spending her time on things that only Maria can do. That's a capacity expansion, not a headcount replacement.

At $2,500 a month I'd need to see real volume — 40-50 drafts a week moving through the queue — for the math to work. At $1,500 a month, the math works at lower volume. **The specific pricing question isn't answered in what I've seen, and I understand why — the PRD defers to the pricing strategy doc. But I'd want a number, or at least a range, before I leave the meeting.** "We'll send you a proposal" is fine. "We don't have a number" is not a meeting I can close.

---

### On the "no lock-in" claims — do I believe them?

Partially. The PRD is honest about what "no lock-in" means and doesn't mean, which I actually respect.

What I believe: month-to-month contract, my data stays in my systems, clean exit, no data clawback. Those are real commitments and they're the right ones.

What I'm skeptical about: "the agent's accumulated learning is not portable to another vendor's runtime." That's honest — they're saying leaving is real work, not frictionless. The voice calibration, the memory rules, the institutional knowledge the agent has absorbed over six months — that walks out the door with the vendor if I leave. That's a real switching cost, even if they don't call it that. I'd rather have them say it plainly than say "no lock-in" and bury the switching cost footnote. The PRD does say it plainly (§14.4). I hope the meeting says it that way too.

---

### On the 14-day adapter ship commitment for Filevine

I'm on Filevine. The PRD says Filevine is pre-built — it's the highest-probability PM for a modernized PI firm, and they've done the work. Good. If for some reason their Filevine adapter has gaps, the 14-day commitment to full write capability is reasonable.

What I'd want to know: what works on day 1 vs. day 14? Read-only on day 1 is fine for a shadow period. But I need to know what "read-only for 14 days" means in practice. Can the agent triage intake against Filevine matter records from day 1? Can it check conflicts? If those are day-1 capabilities on read access, that's enough to start.

---

### On the fact that they pre-scraped my firm's website

I addressed this above under the pre-provisioned demo approach. The short version: if they lead with it and ask for consent, it's impressive. If they don't, it's creepy. The PRD has the right approach. Whether the person in the room actually does it that way is the question.

---

## What I Need to See to Sign as Beta-1

1. **The signing-chase skill actually working against a realistic synthetic Filevine matter.** I want to see it find a stalled DocuSign envelope, draft the follow-up to the client, and route it to my queue for review. That one demonstration would do more for me than 30 minutes of architecture explanation.

2. **The citation-refusal working live when I probe it.** Not a canned demo. Let me type something. Let me see the substrate hold.

3. **The daily digest from my phone.** Show me what Monday morning looks like. What lands in my inbox. What it takes me to approve and move on. Show me the actual UI. I've been burned by products that have beautiful demos and terrible day-to-day workflows.

4. **The privacy controls clearly explained.** What exactly does the agent read in my email? What folders? What keywords would cause something to be excluded? This has to be completely transparent. If I can't explain it to a client if they ask, I won't use it.

5. **The audit log.** I want to see a realistic week of entries. Not a polished demo. What does it actually look like when the agent has done 50 things and I'm reviewing the log? Is it readable, or is it a technical artifact nobody actually looks at?

6. **A number.** Or a range. Or a framework for how the pricing works. I'm not committing without a cost.

7. **Maria in the meeting.** She's the operator. If she's not there, I'm not in a position to say yes.

---

## Make-or-Break Concerns

**The voice concern is existential.** If a client ever says "did you write this?" or "this doesn't sound like you" or "was this generated by a computer" — I'm done. Not with the product. With the relationship. Twenty years of client trust is not a recoverable asset once it's in question. This isn't a product flaw — it's the condition of me using any product that touches client communication. **The 80% blind-test gate before any external drafts is the right call.** Do not rush past it.

**The audit log has to be complete.** Not almost-complete. Not "best effort." If I am ever in a position where opposing counsel, a client, or the bar is asking what happened on a specific date, I need to be able to produce a complete record. A gap in the audit log at the wrong moment is worse than not having the product.

**Trust accounting is a hard no.** The PRD says this clearly — read-only access for reconciliation, no write access, no autonomous transfers. That line needs to hold architecturally. I'd ask in the meeting: "Is this enforced in the code, or is it a setting that can be changed?" The right answer is "enforced in the code and verified at startup."

**If the drafts don't improve by week four, I'm out.** Not because I'm impatient — I understand there's a learning curve. But if I'm still spending meaningful time correcting the same kinds of errors at week four that I was correcting at week one, the feedback loop isn't working. I'd want a clear conversation with the Captain by week three if the metrics aren't moving.

---

## Willingness to Pay

I'll be honest. At $1,500 to $2,500 a month, I'd evaluate this as: can it take 8-10 hours of Maria's week and redirect them to higher-value work? If yes, the math works at current rates. I don't need it to replace a hire I wasn't planning to make. I need it to make my existing team more effective, and I need the monthly cost to be defensible when I look at it on a slow month.

If the pricing is above $3,000 a month, I'd need to see demonstrated volume before I'd commit. I'm not paying $36,000 a year for software on the hope that it'll eventually earn it. I'd need to see the week-4 metrics from another customer first, or a very aggressive pilot pricing with an honest "if it's not working at week eight, we walk away together."

The value I'm buying is time. Specifically: Maria's time redirected away from signing loops and status updates, and my morning not starting with 45 minutes of rote email. If the product delivers that, I'll pay for it. If it delivers it and keeps delivering it and doesn't create problems I have to clean up — I'll be a long-term customer.

**The paralegal-frame compliance argument, the citation-refusal architecture, and the reviewer-as-sender design together are the reason I'd take this meeting seriously.** Those three decisions together show me that someone thought about the actual risks of putting AI in a law firm and built the product around those risks. That's not how most legal-tech demos go. Most demos show me features. This one shows me that someone did their homework on what could go wrong.

That's why I'll hear them out. Whether I sign depends on what Monday morning actually looks like.

---

*Target Customer persona contribution — PRD review round 1*
