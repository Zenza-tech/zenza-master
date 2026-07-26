# NDPA Compliance — Preparation Checklist

**What this is:** a structured account of how Zenza FID currently handles
personal data, written so a Nigerian data-protection lawyer can review it
efficiently, and so you can answer a prospective customer's due-diligence
questionnaire without improvising.

**What this is not: legal advice.** I am not a lawyer, and this has not
been reviewed by one. The Nigeria Data Protection Act 2023 (NDPA) and the
NDPC's implementing regulations carry real penalties, and several items
below are genuinely unresolved questions that need a qualified opinion —
they are flagged as such rather than papered over. Treat this as the
document you hand a lawyer to make their review cheaper, not as a
substitute for that review.

Phase 0 of the plan had two items: fix multi-tenancy (done — see the QA
report), and get a compliance read. This is the input to the second.

---

## 1. Your role under the NDPA — the question that changes everything

The NDPA distinguishes a **data controller** (decides why and how
personal data is processed) from a **data processor** (processes on a
controller's instructions).

**The working assumption in this build:** each customer institution is
the *controller* of the fraud data they enter; Zenza is a *processor*
acting on their instructions.

**Why it matters:** processors have narrower obligations but stricter
limits — most importantly, a processor may not use client data for its
own purposes. Much of the architecture below only makes sense under that
assumption.

**⚠ Where it gets genuinely uncertain — needs a lawyer:** the
cross-institution network arguably makes Zenza a *joint controller* for
that specific processing, because Zenza (not any single customer)
determines the mechanism, what is shared, and the matching logic. This is
the single most important legal question in the product and it should be
answered before the network is enabled for any real customer.

---

## 2. What personal data the system holds

| Data | Sensitivity | Where it lives |
|---|---|---|
| BVN, NIN | High — government identifiers | Tenant DB (per-organization file) |
| Phone, email, account number, device ID | Moderate | Tenant DB |
| Names, risk notes, watchlist reasons | Moderate–high (allegations about identifiable people) | Tenant DB |
| Uploaded evidence documents | Potentially high, contents unknown to us | Tenant filesystem |
| AI-generated summaries of that evidence | Derived from the above | Tenant DB |
| Staff user accounts (name, email, password hash) | Standard | Platform DB |
| Keyed hashes of identifiers | Pseudonymised, still personal data | Platform DB (shared) |

**Note on the hashes:** under both NDPA and GDPR reasoning,
pseudonymised data is still personal data. Publishing an HMAC of a BVN is
not "anonymisation" and shouldn't be described to a customer as such. It
is a strong technical safeguard, not an exemption.

---

## 3. Technical measures actually in place

These are implemented and tested, not aspirational:

- **Tenant isolation by architecture.** Each organization's data is a
  physically separate SQLite database file. Isolation does not rely on
  developers remembering a `WHERE org_id = ?` clause. Verified with
  adversarial cross-tenant tests (QA report §11).
- **Attachment isolation.** Uploaded files are stored per-organization on
  disk, under random UUID filenames, never the original filename.
- **Operator access is metadata-only.** The platform admin API returns
  counts, timestamps, plan and storage — never entity names, identifiers,
  reasons, or attachment content. Enforced in code
  (`server/routes/platform.js`) and verified by a test asserting no
  fraud content appears in any platform response.
- **Keyed hashing for network signals.** HMAC-SHA256 with a server-side
  secret. A plain hash would be inadequate: an 11-digit BVN has only
  10^11 possible values and is exhaustively brute-forceable.
- **Network participation is opt-in**, defaulting to off.
- **Immutable audit trails.** Insert-only, at both tenant and platform
  level. No update or delete path is exposed anywhere.
- **Access control.** Role-based permissions, maker-checker separation on
  watchlist decisions, timing-safe password comparison, login rate
  limiting, CSP and security headers.
- **Erasure capability.** Archive (revoke access, retain data) and purge
  (permanently delete the tenant database, all attachments, all user
  accounts, and all network signals) are both implemented, with the purge
  requiring explicit typed confirmation.

---

## 4. Data subject rights — honest status

Under NDPA, individuals have rights of access, rectification, erasure,
restriction, objection, and portability.

**Important framing:** those requests come to the *customer institution*
(the controller), not to Zenza. Our obligation is to make sure the
institution can actually fulfil them in our system.

| Right | Can a customer fulfil it today? | Gap |
|---|---|---|
| Access | Partially — they can search and view a profile, but there's no one-click "export everything about this person" | **Needs building** |
| Rectification | Yes — entities are editable, with version history | — |
| Erasure | Partially — no "delete this entity entirely" function exists; entities can be marked inactive but not removed | **Needs building, with care: erasure must not silently destroy audit integrity** |
| Restriction | Partially — watchlist entries can be suspended | Adequate for now |
| Objection | Process question, not a software one | Customer's own procedure |
| Portability | No structured per-subject export | **Needs building** |

**⚠ The hardest unresolved tension, needs legal input:** an immutable
audit trail (required for financial-crime accountability, and a core BRD
principle) sits in direct conflict with an unqualified right to erasure.
Most frameworks resolve this via a legal-obligation basis for retaining
audit records — but *which* records qualify, and for how long, is exactly
the kind of judgment that needs a qualified Nigerian opinion rather than
my guess.

---

## 5. Lawful basis — the weakest area

Every processing activity needs a lawful basis. For a fraud repository,
the plausible bases are **legitimate interest** (fraud prevention is
explicitly recognised as one in comparable frameworks) or **legal
obligation** (AML/CFT duties on financial institutions).

**What doesn't exist yet, and should before a real deployment:**
- A documented Legitimate Interest Assessment for the core repository.
- A separate one for the cross-institution network, which is a materially
  more intrusive processing activity than the single-institution case and
  cannot simply inherit the same justification.
- A Data Protection Impact Assessment. Large-scale processing of
  government identifiers, combined with automated flagging of
  individuals, is very likely to require one.

**⚠ Specific concern worth raising with counsel:** the rule engine
automatically flags individuals. The system is deliberately designed so
that no rule ever takes action on its own — every alert requires a human
to review and escalate, and every watchlist addition requires a second
human to approve. That design choice was made for operational integrity
before the legal angle was considered, and it happens to be exactly the
posture that protections against solely-automated decision-making call
for. Worth confirming that the human-review step is sufficient as
implemented.

---

## 6. Practical steps before selling to a regulated customer

1. **Engage a Nigerian data protection lawyer** with NDPA experience.
   This document is the input.
2. **Register with the NDPC** if the processing volume requires it.
3. **Appoint or designate a Data Protection Officer** — likely mandatory
   given the scale and sensitivity of identifiers processed.
4. **Draft a Data Processing Agreement** for customers. Institutional
   customers will require one before signing; not having a template ready
   will stall deals.
5. **Resolve the joint-controller question** for the network (§1) before
   enabling it for anyone.
6. **Complete a DPIA** before the first production deployment.
7. **Define and implement retention periods.** Nothing in the system
   currently expires automatically except watchlist entries with an
   explicit expiry date. "We keep fraud records forever" is not a
   defensible default.
8. **Build the data subject access / export function** (§4).
9. **Write a breach response procedure.** NDPA has notification
   timelines; you cannot improvise this after an incident.
10. **Get an independent security assessment.** Everything in §3 was
    tested by the same process that built it. That is a real limitation,
    and a customer's security team will ask.

---

## 7. Things that would currently fail a customer's due diligence

Stated plainly, because finding these out during a sales cycle is worse
than knowing now:

- No DPA template to sign.
- No DPIA.
- No named DPO.
- No independent penetration test or security audit.
- No defined retention or deletion schedule.
- No documented breach response plan.
- No automated test suite (so "we tested it" rests on manual testing
  performed once, by the same party that wrote the code).
- Encryption at rest depends on the host's disk encryption; the database
  files themselves are not separately encrypted.

None of these is unusual for a product at this stage. All of them are
answerable. But they should be answered deliberately, before a customer
asks, rather than discovered live in a procurement conversation.
