# Phase 0 – what is in the 100 sample documents

Status: reading done by Claude vision (all 100 files opened and read). The three-model accuracy trial has **not** run yet – it needs an API key (see "Need from you").
Client documents stay local in `data/` (git-ignored). The per-file catalogue is `data/phase0/catalog.csv`.

## 1. What the folder holds

- 100 files, 17 MB. **95 unique** – 5 files are byte-for-byte copies (the same handwritten note 4 times, another 3 times).
- Every file is named `PO_####`, but **not every file is a purchase order**.

| How it arrived | Files |
|---|---|
| Typed PDF (text inside) | 29 |
| Handwritten note on the buyer's letterhead (photo) | 26 |
| WhatsApp text screenshot | 25 |
| Scanned PDF (no text inside) | 6 |
| Photo of a printed PO | 6 |
| Email / Gmail screenshot | 5 |
| Photo of a computer screen | 2 |
| Cropped table image | 1 |

| What it is | Files |
|---|---|
| Formal customer PO (typed, ERP, scanned or photographed) | 31 (one file also holds our proforma) |
| Handwritten order | 26 |
| WhatsApp / chat order | 20 |
| Email order, typed-screen order | 7 |
| Broker delivery order (priced per tonne) | 2 |
| PO amendment | 1 |
| **Not an order**: our own proformas (3), sales invoice, lorry receipt, rate card, GST page, sent mail, offer table | 9 |
| **Not a firm order**: price negotiation threads (2), half messages (2) | 4 |

So about **1 in 8 files must never become an order**, and 5 are exact repeats.

## 2. Readable? Yes – with care

- Every file was readable. Handwriting is mostly neat block or cursive English; two have Hindi words.
- About **20 files** have at least one value I would not trust blindly (overwritten digit, "8mm or 2mm", grade "11/12", rate "142 or 155", year written wrong, finger over the page, edge cut off).
- That is exactly what the "flag it, never guess" rule in the plan is for.

## 3. Traps found (each one becomes a rule in the engine)

1. **The text hidden inside PDFs lies.** One scan says grade "T2CL2" where the picture says "12 CL 2". Others lose letters ("Fittings" → "FiAngs"), scramble columns (rates detached from items) or swap buyer and seller on a broker slip. → Read the picture; use the hidden text only as a cross-check.
2. **Units change.** Rates are per kg on most, **per tonne** on both broker slips (₹1,20,000 and ₹1,39,000), quantity comes as Nos, kg, tons, metres, even "60 M2 at ₹152 per KG". → Normalise units, flag any rate outside the normal band.
3. **Dates and years disagree.** Year-conflict between a PO and its annexure, a note dated 2025 saved in 2026, a signature date different from the header, a "24-25" PO number dated Sep 2025. → Keep the printed date, also keep the file date, flag mismatches.
4. **One file, several documents.** A 54-page PO of which 9 pages matter (the rest is terms and a Bechtel procedure); a PDF with the PO and our proforma together; an amendment that re-prints the whole order; "page 1 of 3" only. → Page triage, split, link amendments to the base PO.
5. **Totals can be checked.** About 15 documents have totals that tie out to the rupee (kg × rate, GST, round-off). Found real errors: a line off by ₹0.13, a PO total of ₹63,720 vs our proforma ₹64,900 (different tax type), a PO showing 18% GST but ₹0 tax. → The code check catches these.
6. **Incomplete orders are normal.** 5 handwritten notes have no rate; 3 chats show no buyer name in the picture; one email confirms "INR 57,009" without a PO number. → Save as draft with the gap marked, ask a human.
7. **Chats are messy.** One order split over several messages, address and vehicle number in separate bubbles, the forwarder ("Mukesh Sir", "Harshil Sir") is not the buyer, a changed GST number, an order mixing CL1 and CL2 plates. → Read the whole screenshot as one thread.
8. **Direction.** 6 documents are Sambhav's own (proformas, invoice, sent mail, a "SPF to Bombay Metal" message); 7 more are unclear. → Classify direction first.
9. **Which company?** Some orders are addressed to Sai Steel, some to Sambhav Metal, most to Sambhav Pipes & Fittings. → Entity must be read and confirmed.
10. **Photo problems.** Finger on page, glare, skew, page rotated 90°, screen moiré, text cut at the edge, other papers in the background. → Quality check up front; "cannot read" is a valid answer.

## 4. What we can check against – a big advantage

- 44 files carry a PO number. I looked up 29 of them in the Dispatch FMS sheet already in Supabase: **27 are found** (the other two are formatted differently, e.g. `VE: 848`). So for formal POs the sheet itself is the answer key – no hand labelling needed there.
- The ~50 handwritten / chat orders have **no PO number**. They must be matched on customer + grade + size + date, so those need human labels.
- The date of capture is in every image file name (`WhatsApp Image 2025-12-08…`) – a useful fallback date.

## 5. Proposed bars (unchanged from the plan, now with per-type targets)

- Go-live: ≥ 98% of key fields right **or flagged**; < 1% wrong **and** unflagged.
- Typed / ERP PDFs: ≥ 99% right. Handwritten and chat: ≥ 90% right, the rest flagged.
- Never "not an order" saved as an order. Every result lands as a **draft** for a person to approve.

## 6. Need from you

1. **Anthropic API key** with a monthly spend cap. Trial cost is small: about ₹150–400 for Haiku + Sonnet on 95 documents, well under $5 with reruns. Keep it out of chat; put it in `data/secrets/`.
2. **Client OK to send their order documents to an AI provider** (they hold GST numbers, phone numbers and prices). Please get a yes in writing from HJ.
3. *(Optional)* a Google AI Studio key to compare Gemini.
4. **About 2 hours of Sagar / Harshil** to confirm the ~25 uncertain values and answer: which entity each order belongs to, whether broker delivery orders count as orders, and what makes a chat "confirmed".

## 7. Next (once the key is in)

1. Run Haiku 5.5 and Sonnet 5.5 (and Gemini if keyed) on the 95 unique files with fixed-format output.
2. Score against: sheet answers (formal POs) + the human-checked labels (chat / handwritten).
3. Report fields right / flagged / wrong-and-unflagged per document type, cost per document, and pick the first-pass model.
4. Set the final bars, then build the intake screen (upload → read → review → save as draft).

## 8. Haiku 5.5 first run (22 Oct 2026)

Script: `tools/docs-trial/read_docs.py` (run) and `tools/docs-trial/score.py` (score). Results stay in `data/phase0/haiku/`.

- **Cost: $0.13 for all 95 unique documents** – about $0.0014 (≈ ₹0.12) per document, about 9 seconds each. (Estimate was $0.08; the model "thinks" before answering, which adds output tokens.)
- All 95 came back in the fixed format, none failed.
- Typed PDFs: all 341 numbers returned exist in the PDF's own text. Totals tie out.
- Handwritten: sizes, quantities and rates mostly right. Hard digits are **flagged, not hidden** – e.g. "148/-" read as 1481 and "140/-" as 1407 were both flagged by the model itself (a rate-band check would also catch them).
- Found things my own reading missed: a second line on a Qlar PO (page 2) and one fewer line in an email order than I had counted – so the model is more thorough than my draft labels.

Real weaknesses (all fixable with prompt / schema changes, not model limits):
1. **Chat orders called "not firm"** – 7 forwarded WhatsApp "Order / Purchase Order" messages were marked not firm; needs the rule "a forwarded message headed Order = firm".
2. **Handwritten "D.O." notes** – 4 were typed as broker delivery order / offer; a customer's own D.O. is an order.
3. **Direction mix-ups** – 5 files (e.g. a Saudi PO issued *to* us read as us buying).
4. **Missing fields** – no slot for our own document numbers (broker slip, proforma, LR); total came as pre-tax on some and with tax on others → capture net, tax and gross separately.
5. **Small misses** – a few handwritten rates and one date left empty (flagged), one date read as 2025 instead of 2026 on a rotated note.

Next: fix those in the prompt/schema, re-run Haiku (≈ $0.13), then ask before running Sonnet 5.5 (≈ $2.5 for the same 95).

### Haiku 5.5, second run (tightened prompt + document number and net/tax/total fields)

Cost $0.14 for the 95 documents. Scored against the draft catalogue (two catalogue mistakes corrected first: a missed second line on one Qlar PO, an email order with 9 lines not 10).

| Check | Run 1 | Run 2 |
|---|---|---|
| Order / not an order | 75 / 93 | **92 / 93** |
| Direction (who orders from whom) | 74 / 85 | **83 / 85** |
| PO or document number | 36 / 43 | **43 / 43** |
| Date | 56 / 60 | 58 / 60 |
| Line count | 79 / 79 | 79 / 79 |
| Total | 23 / 26 | **25 / 26** |

- Both bad handwritten rates ("148/-" → 1481, "140/-" → 1407) are now read correctly and still flagged.
- Still wrong: one supplier note typed as an offer (Hindco), one direction left "unclear", one handwritten date read as 2025 not 2026 (flagged), one email total left empty, and one width read as 1230 instead of 1250 on a rotated handwritten note **without a flag** – the kind of error the Sonnet comparison and the rate/size checks must catch.
- **Caution:** I wrote the new rules after seeing these same 95 documents, so run 2 is tuned to them. Real accuracy needs fresh documents the prompt has not seen (the next 100 from the client).

### Sonnet 5.5 on the uncertain documents only

Selection (`tools/docs-trial/pick_uncertain.py`): documents where Haiku's own output showed doubt – a firm order with a missing rate/quantity, a rate outside ₹60–600/kg, direction unclear, an order it was unsure about, or a flag on a key field saying "could be / unclear / cut off". 45 of the 95 were picked. Same prompt as Haiku run 2.

- **Cost $0.88** for the 45 (about $0.02 each, about 14× Haiku). Haiku on the same 45 cost $0.07.
- Same 45, scored against the draft catalogue:

| Check | Haiku | Sonnet |
|---|---|---|
| Direction | 36 / 38 | **38 / 38** |
| Order / not an order | 42 / 43 | 41 / 43 (both disagreements are debatable: a cropped table, a negotiation that starts with "Order") |
| PO number, line count, total | same | same |
| Date | 28 / 30 | 28 / 30 |

- Sonnet fixed the two cases Haiku got wrong: the Hindco supplier note (now a customer order) and the Bright Steel note (direction). It read the rotated Gadhavi note's width correctly (1250; Haiku said 1230 without a flag) and read the cut-off rates on the Silicon Steel note (136).
- Neither model got the TechnipEnergies email total (₹57,009 "Order Value") – a prompt rule is needed.
- Two-step plan cost: Haiku for every document, Sonnet only for the uncertain ~45% → about $0.01 (under ₹1) per document on average.
