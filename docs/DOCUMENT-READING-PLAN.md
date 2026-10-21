# Document reading: implementation plan

**Status:** draft for review · **Date:** 22 October 2026 · **Owner:** ScalePods

Sambhav receives POs, enquiries, invoices, certificates and photos as PDF, JPG and PNG, by email, WhatsApp and Google Forms. Today someone retypes them. This plan builds **one reading engine**:

- **Reads** the document.
- **Fills** a form.
- **Checks** every value against rules and against our own data.
- **Asks a person to confirm** before anything is saved.

It sits behind the Round 6 items 3.3 (certificate vault) and 3.4 (WhatsApp inbox), the quotation module, and a new **Upload** button.

---

## 1. What it does, in one picture

```
 Upload button ─┐
 Gmail ─────────┼─► 1 Intake ─► 2 Classify ─► 3 Read ─► 4 Check ─► 5 Match ─► 6 Review ─► 7 Save to the module
 WhatsApp ──────┤    store file,  what is it?   fill the   rules in   against     a person    (quotation lines,
 Drive (forms) ─┘    stop dupes                 form       code       our data    confirms    order, invoice,
                                                                                               certificate link)
```

Five rules hold throughout:

1. **A person confirms every document before it changes anything.** The system suggests and never posts on its own. Round 6 already agreed this.
2. **Nothing is lost.**
   - The original file is kept, along with what the AI read, what the person changed, and which model read it.
   - Every step is recorded with who did it and when.
3. **One engine, many doors.** Upload, Gmail, WhatsApp and Drive all feed the same pipeline. Each new document type is a new form (a schema), not new code.
4. **Documents are untrusted.** Text inside a PDF can never trigger an action, change a price or send a message.
5. **No vendor lock-in.** The model sits behind one small interface, so it can be swapped after testing.

---

## 2. Which documents, in which order

| # | Document | Where samples are | Count we can test on | What it feeds | Phase |
|---|---|---|---|---|---|
| 1 | **Customer purchase order (PO)** | Dispatch FMS, "Upload PO" | 885 | Order draft; later dispatch | A |
| 2 | **Purchase invoice** (vendor bill) | Form Response Sheet, Payment Better ("Upload Invoice") | 1,598 | Purchase invoice draft; weight and rate check against stock | A |
| 3 | **Mill certificate** (MTC, consignment MTC, IBR) | WB1 and WB2, LINK / CON LINK / IBR LINK | 906 | Certificate vault: heat/plate numbers linked to our plates | B |
| 4 | **Customer enquiry / RFQ** (PDF, photo, email table) | Gmail, WhatsApp. **Not in the sheets** | 16 sample threads; need 30–50 more | Quotation lines, plus "what do we have in stock that fits" | C |
| 5 | Packing list | Gmail (accounts@) | need samples | Receiving: creates the plates (lots) | C |
| 6 | Dispatch packet (invoice + LR) | Document Tracker | 555 | Dispatch paperwork steps | D |
| 7 | Expense bill | Exp tabs | 507 | Expenses (with the payments module) | D |
| 8 | WhatsApp photos (cutting slips, yard photos) | WhatsApp | — | Same engine, once the WhatsApp number is live | D |

GPay screenshots (118) and yard photos are not worth reading by AI. They are stored and linked only.

**Why this order:**
- POs and purchase invoices have the most samples. They are typed and clean, so the engine can be tested on them.
- Certificates are next. They link straight to the plates already loaded.
- Enquiries come third. They are the most varied, they need samples from the mailboxes, and they feed the quotation module, which is planned for Dec to mid-Jan.

---

## 3. The steps in detail

### Step 1: Intake
- **Upload screen:**
  - Drag-and-drop, or take a photo on a phone.
  - Several files at once.
  - The user picks the document type, or chooses "not sure".
- **Storage:**
  - Files go to private Supabase Storage.
  - A row is written to the existing `documents` table, with the file, type, source, who uploaded it and when.
- **Duplicate check:** a fingerprint of the file (SHA-256) is checked. The trigger for this already exists. A second copy of the same bill is flagged, not read twice. This was a real problem: forms double-uploaded and an automation wrote a PO twice.
- **Drive backfill:** a job reads the 4,579 files already linked from the sheets through the robot account. It needs the Drive folder shared, as for the sheets.

### Step 2: Classify
- If the user didn't pick a type, a cheap first call answers: "PO, invoice, MTC, packing list, enquiry, other?" It also gives a confidence.
- Low confidence means the review screen asks the person to choose.

### Step 3: Read (extraction)
- **Digital PDF** (made by software): the text layer is used first. It's exact and free.
- **Scanned PDF or photo:** the page images go to a vision model.
- **Fixed answer shape:** the model must answer in a fixed JSON shape for that document type (structured output, also called constrained decoding). The answer is always well-formed and every field is present, though a value can still be wrong. Step 4 catches those.
- **For each value, the model also returns:**
  - Where it found the value (page and text snippet), so the review screen can show it.
  - "Not stated" when the document doesn't say. A guess is never allowed.
- **Model plan** (section 5): Claude Haiku 5.5 reads first. Anything that fails a check, plus handwriting and poor photos, goes again to Claude Sonnet 5.5.

**Fields per type.** These are first drafts and get refined on real samples.

| Type | Fields |
|---|---|
| Customer PO | PO number, PO date, customer name, GSTIN, billing and delivery addresses, contact person, payment terms, delivery date, lines (grade, thickness, width, length or size, quantity, unit, rate, amount, make / MTC / testing / IBR notes), freight, taxes, total |
| Purchase invoice | invoice number, invoice date, vendor, vendor GSTIN, buyer entity (SPF / Sai), IRN, lines (description, HSN, grade, size, heat/plate numbers, pieces, weight, rate, amount), taxable value, GST, total, vehicle number, e-way bill |
| MTC / IBR | certificate number, mill, issue date, grade / specification, for each heat or plate (heat number, plate number, size, chemistry, mechanical values), certificate type |
| Enquiry / RFQ | customer, contact, enquiry date, reference / PR number, project code, lines (material / MOC, grade, thickness / SCH, width, length, quantity, unit, make, MTC / IBR / testing requirements), delivery place and date. Notes are copied **exactly as written**, for example "ORIGIONAL" |
| Packing list | mill, invoice number, for each plate (heat number, plate number, size, pieces, weight) |

### Step 4: Check (rules in code, not AI)
Each failed check marks that field **amber**, and the person must look at it.

| Check | Example |
|---|---|
| **Weight against size** | weight ≈ thickness × width × length × 7.85 / 10⁶ per piece, within the 2% / 5% tolerance setting |
| **Totals add up** | line amounts = quantity × rate; lines + freight + tax = total |
| **GST** | GSTIN checksum is valid; CGST + SGST or IGST matches the state; tax = taxable value × rate |
| **Number formats** | invoice-number pattern. This blocks the "25-25" / "25-27" phantom years. Heat and plate number patterns per mill |
| **Dates** | not in the future; invoice date ≤ received date; financial year matches the number |
| **Required fields** | e.g. no PO number means a PO can't be saved |
| **Units** | kg, MT and nos are normalised; "no" and "no/pc", "kg" and "kgs" are made the same |

### Step 5: Match (against our data)
| Value | Matched against | If no match |
|---|---|---|
| Grade text ("SA516GR70", "SA 516 Gr.70") | the grade list and its 473 spellings already loaded | person picks; the new spelling is learned as an alias |
| Customer / vendor | parties, by GSTIN first, then name and email domain | person picks or creates; the alias is saved |
| Heat / plate number | our plates (lots) | "not in our books": flagged, as in the count |
| Enquiry lines | **plates in stock that fit** (grade, thickness ±, size ≥ needed, enough weight) | shown as "nothing in stock; purchase needed" |
| PO | open quotation with the same customer and items | person links it |
| Purchase invoice | the plates it should create, and the matching mill e-invoice | flagged |

**Optional, phase 2:** a decision model such as **Jev** for the uncertain matches. It picks one of the shortlisted candidates and returns an honest probability. We add it only if testing shows too many fields go to review (section 8).

### Step 6: Review screen
- **Layout:**
  - **Left:** the document, page by page, with the spot each value came from highlighted.
  - **Right:** the form, with green = checked, amber = check failed or low confidence, and empty = "not stated".
- **Editing:**
  - Keyboard-first: Tab to move, Enter to accept.
  - Works on a phone for the yard.
- **Actions:**
  - **Confirm**, which saves.
  - **Correct and confirm**.
  - **Reject**, with a reason.
  - **Not this type**, which re-reads it as another type.
- **Learning:** every correction is stored. Corrections become the test set and help improve the instructions. We **don't** train our own model.
- **Who:** the queue lives under **Needs review → Documents**. Roles decide who can confirm which type: the accounts person for invoices, sales for POs and enquiries.

### Step 7: Save to the module
After confirmation, the document becomes a **draft** in the right module. It goes through the module's normal approval rules, never straight into the books.

- **Enquiry:** quotation lines prefilled, with the stock suggestions alongside.
- **PO:** order draft.
- **Purchase invoice:** purchase invoice draft, and later receipt into stock.
- **MTC:** certificate rows linked to plates (`certificates`, `lot_certificates`).
- **Packing list:** new plates (lots), waiting for approval.

---

## 4. Database additions (small: most of it already exists)

**Already there:**
- `documents`, with type, source, hash, duplicate flag, extraction status and the extracted JSON.
- `certificates` and `lot_certificates`.
- `approval_requests`.
- `exceptions`.
- `grade_aliases`.
- The audit log.

**New:**
| Table | Holds |
|---|---|
| `document_pages` | page images and text, page count, whether the PDF was digital or scanned |
| `extraction_runs` | one row per AI read: model, prompt version, schema version, tokens, cost, raw answer, time taken, which checks failed |
| `document_reviews` | who confirmed or corrected, field by field (old value → new value), and when |
| `doc_schemas` | the form for each document type, versioned, so a new type is data, not code |
| Storage bucket `documents` | private; files are reachable only through the app |

---

## 5. Models and cost

| Job | Model | Why |
|---|---|---|
| Classify + first read | **Claude Haiku 5.5** ($0.10 in / $0.50 out per 1M tokens) | Very cheap, reads PDFs and images, fixed-shape output |
| Second read (failed checks, handwriting, poor photos) | **Claude Sonnet 5.5** ($2 / $10) | Stronger on hard documents |
| "Which stock fits this enquiry" wording, Ask the business | **Claude Sonnet 5.5** | Judgement and writing; it only sees the rows our SQL returns |
| Backfill of old files | the same models through the **Batch API** | 50% cheaper; not urgent |
| Fixed instructions | **prompt caching** | Repeated instructions cost about 10% |

**Cost estimate.** These are assumptions to check in phase 0: about 2,500 input and 600 output tokens per page, and about 25% of pages going to the second read.

| | Pages | Cost |
|---|---|---|
| One-time backfill of the 4,579 Drive files (~2 pages each, batch) | ~9,200 | **~$15** |
| Ongoing, ~1,500 documents a month | ~3,000 a month | **~$10–25 a month** |

At this volume, **cost isn't the decision. Accuracy is.**

**The test decides the vendor (phase 0).** We run the same labelled documents through Claude Haiku 5.5, Claude Sonnet 5.5 and Gemini Flash. If another model clearly wins on one type (for example handwriting), that type uses it. Only the model interface changes.

**Not doing:**
- **Training our own model.** It needs thousands of labelled documents and an ML team, and gives no benefit at this volume.
- **Self-hosted open models.** These are only needed if Sambhav forbids cloud AI. That is a decision for them (section 10).

---

## 6. Accuracy: how we know it works

1. **Test set (phase 0):**
   - **100 real documents:** 25 POs, 25 purchase invoices, 25 MTCs, and 25 enquiries and packing lists, including bad photos and handwriting.
   - We fill in the correct answers once. Their accounts person checks a sample.
2. **Measure field by field:**
   - The share of fields read correctly.
   - The share of fields flagged amber.
   - **The share of wrong values that were not flagged. This is the number that matters.**
3. **Go-live bar for each document type:**
   - At least **98% of key fields right or flagged**. Key fields are numbers, dates, heat numbers, quantities and amounts.
   - **Under 1% wrong and unflagged.**
   - If a type misses the bar, it stays on "read and suggest". A person fills the gaps until it passes.
4. **Every model or instruction change re-runs the test set** before release.
5. **Live tracking:** a monthly report shows corrections per type, which fields people correct most, and cost per document.

---

## 7. Security and privacy
- Files go to private storage. The API keys live on the server only. Only signed-in staff with the right role see documents.
- **No training on the data:** the Anthropic API doesn't train on customer data by default. Zero data retention can be requested if Sambhav wants it.
- **Instructions inside documents are ignored.** Document text is treated as data, and the AI's answer can't trigger sending, posting or paying.
- **Personal data:** names, phone numbers, GSTINs and bank details stay inside the database's role rules. They are never sent anywhere except to the model for reading.
- **Cost guard:** a page limit per document and a daily spend limit, with an alert.

---

## 8. Phases and effort

| Phase | What | Effort | Can start |
|---|---|---|---|
| **0: Test set and model trial** | Pick and label 100 documents; run the 3 models; choose; set the go-live bars | 3–4 days | When the Drive folder is shared |
| **A: Engine + POs + purchase invoices** | Upload screen, storage, duplicate check, classify, read, checks, matching (grades, parties), review screen, `extraction_runs`, drafts in the module | 8–10 days | After phase 0 |
| **B: Certificate vault** (Round 6 item 3.3) | Read MTCs and IBRs, link heat/plate numbers to plates, attach to quotations and dispatches, backfill the 906 linked certificates | 6–8 days (inside the 8–10 already quoted for 3.3) | After A |
| **C: Enquiries → quotations + stock fit** | Read PDF and photo enquiries and email tables, prefill quotation lines, "what we have in stock that fits", packing lists to new plates | 6–8 days (shared with the quotation module) | With the quotation module (Dec–Jan); needs the enquiry samples |
| **D: WhatsApp, dispatch packets, expense bills** | Same engine on new doors and types | 2–3 days per type | With the WhatsApp (3.4) and payments modules |
| **Backfill** | Read all 4,579 Drive files in batches, into the review queue in priority order | 2 days + review time | After B |

**New work, not yet quoted:**
- The Upload button.
- PDF and photo enquiries (Round 6 only covered email tables).
- The stock-fit suggestion.

That comes to about **1.5–2 weeks** on top of 3.3 and 3.4, under the change-request rule (one-page impact note, HJ approves).

---

## 9. What we need from Sambhav
1. **Share the Drive folder** of POs and documents with the robot account (read only), and the six remaining sheets.
2. **30–50 enquiry documents** from the mailboxes (PDFs, photos, email tables) and **10–20 packing lists**.
3. **Consent for cloud AI:** documents go to Anthropic (and Google for the trial) for reading. No training; zero retention on request.
4. **Who reviews which type:** accounts for invoices, sales for POs and enquiries, and a backup for each.
5. **An hour of the accounts person's time** to check 20 of our test answers.

## 10. Decisions needed
| Decision | Our recommendation |
|---|---|
| Main AI vendor | Anthropic (Claude Haiku 5.5 + Sonnet 5.5), confirmed by the phase 0 test |
| Can documents leave India for AI reading? | Yes, with no-training terms. If not, the cost and effort change (self-hosted models) |
| Auto-save high-confidence documents without a person? | **No**, not in the first 3 months. Review once accuracy is measured live |
| Jev or a similar decision model | Not now. Re-test if the review rate is too high |
| Should the Upload button also take Excel / CSV files from customers? | Yes. Read them directly, no AI needed |

## 11. Risks
| Risk | What we do |
|---|---|
| Handwritten slips and blurry photos read badly | The second read with a stronger model, amber flags, and a person always confirms. Ask staff to photograph flat and in good light |
| Each customer's PO looks different | The model reads by meaning, not by template. Each new layout is added to the test set |
| Staff confirm without looking | Amber fields can't be accepted with one click. A weekly sample is audited |
| Row and number drift between the sheets and the documents | Match on the document's own numbers (PO number, invoice number, heat number), never on sheet row positions |
| Model or price changes from the vendor | One small model interface, the test set re-run before any switch, and cost tracked per document |
