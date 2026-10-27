// Plain-language explanations for the words, columns and status labels in the app. The "i" button (components/Info.tsx) shows them.
// Keys are lower-case labels as they appear on screen (units in brackets are ignored), so a column called "Left (kg)" finds "left".
// A page can also pass an explanation directly. Keep each one short: what it is, what the values mean, what to do when it looks wrong.

export type Entry = { title?: string; text: string };

const G: Record<string, Entry> = {
  // ---------------------------------------------------------------- Tally invoices and paperwork
  "customer po": { title: "Customer PO", text: "The customer's own purchase order: the paper in which they asked us to supply. Its number is written on the Tally invoice. We look that number up in the uploaded documents and in the orders sheet. “Found” (PO uploaded / In orders sheet) means we can show it. “Not found” means the number is on the invoice but we hold no matching document or order yet: upload the PO under Documents." },
  "certificates": { title: "Mill certificates", text: "Mill test certificates (MTC) prove the quality of the steel. Every plate carries a heat number. For this invoice we take its heat numbers, check how many of those plates are in our stock book, and whether a certificate is filed for them. “none filed” means no certificate is linked yet: upload it under Documents." },
  "vehicle register": { title: "Vehicle register", text: "The sheet where each truck leaving the yard is written down. A tick means this invoice was found there; a dash means it was not. The register sheet stops at 29 Sep 2026, so a dash on a later invoice only means the register has not been filled that far." },
  "e-invoice": { title: "E-invoice (IRN)", text: "The government's electronic invoice number (IRN). A tick means Tally stored one for this invoice. A dash means none is stored: it may not be required for this invoice, or it was not created in Tally yet." },
  "e-way": { title: "E-way bill", text: "The government permit needed to move goods by road. A tick means its number is stored in Tally for this invoice; a dash means no number is stored." },
  "heat no": { title: "Heat number", text: "The mill's batch number stamped on a steel plate. It links the plate to its test certificate. We use it to find the same plate in our stock book and its certificate." },
  "heat no.": { title: "Heat number", text: "The mill's batch number stamped on a steel plate. It links the plate to its test certificate. We use it to find the same plate in our stock book and its certificate." },
  "plate / heat no": { title: "Plate / heat number", text: "How a plate is identified. A heat number is the mill's batch number; a plate number is the number stamped on one plate (some mills give both). Search for either in the box at the top." },
  "plate / heat": { title: "Plate / heat number", text: "How a plate is identified. A heat number is the mill's batch number; a plate number is the number stamped on one plate." },
  "voucher": { title: "Voucher", text: "One entry in Tally: a sales invoice, a purchase, a receipt, a payment or a journal." },
  "vouchers": { title: "Vouchers", text: "The number of entries (sales, purchases, receipts, payments, journals) copied from Tally, and the dates they run from and to." },

  // ---------------------------------------------------------------- Tally status
  "connection": { title: "Connection to the Tally PC", text: "Whether the small program on the Tally PC is reporting to this site. Online: it is working. Offline: nothing was heard for a while, usually because the PC is off, the Windows user is logged out, or Tally is closed." },
  "last good sync": { title: "Last good sync", text: "When the last complete copy of the Tally data arrived without problems. The numbers on the Tally pages are as of this time, not live." },
  "customers and vendors": { title: "Customers and vendors", text: "The parties (ledgers) in Tally: customers we sell to and vendors we buy from, with their balances. Also shows how many stock items Tally has." },
  "records": { title: "Records", text: "How many pieces of data (vouchers, parties, bills, items) arrived in that sync." },
  "how": { title: "How the sync started", text: "Scheduled: the Tally PC did it by itself on its timetable. Sync now: an administrator pressed the button." },
  "problem": { title: "Problem", text: "Why a sync did not finish. Most often Tally was closed or the Windows session ended on the Tally PC." },

  // ---------------------------------------------------------------- Stock
  "plates left": { title: "Plates left", text: "How many separate plates still have material left in stock for this grade and thickness." },
  "pcs": { title: "Pieces", text: "The number of pieces (plates) left. A plate that was partly cut still counts as one piece." },
  "left": { title: "Left", text: "The weight still in stock for this plate: what was received minus everything sold or cut from it, in the unit chosen at the top." },
  "book": { title: "Stock book", text: "Which of the two stock sheets the plate is recorded in. WB1 is the Sambhav Pipes & Fittings alloy-plate book; WB2 is the book for SPF and RS (S690QL, SA 537, Rockstar plates)." },
  "size (mm)": { title: "Size", text: "Thickness × width × length in millimetres. A plate that was cut shows the length that is left." },
  "grade": { title: "Grade", text: "The steel specification of the plate, for example SA 387 GR 11 CL2. Different spellings in the sheets are read as the same grade." },
  "thickness": { title: "Thickness", text: "The plate thickness in millimetres." },
  "thk": { title: "Thickness", text: "The plate thickness in millimetres." },
  "wid": { title: "Width", text: "The plate width in millimetres." },
  "len": { title: "Length", text: "The plate length in millimetres." },
  "nos": { title: "Numbers", text: "How many pieces." },
  "wt": { title: "Weight", text: "The weight in kilograms." },
  "plate no": { title: "Plate number", text: "The number stamped on one plate (some mills use it instead of, or together with, a heat number)." },
  "cert": { title: "Certificate", text: "A link to the mill test certificate for this plate." },
  "hsn": { title: "HSN", text: "The tax classification code of the goods, used on GST invoices." },

  // ---------------------------------------------------------------- Physical count
  "books at start": { title: "Books at start", text: "What our stock book said this plate weighed when the count began." },
  "moved before count": { title: "Moved before the count", text: "Material that was sold or received after the count started but before this plate was counted. It is allowed for so the difference is fair." },
  "opening (worked back)": { title: "Opening, worked back", text: "What the plate must have weighed when the count began, worked out from the count and the movements since." },

  // ---------------------------------------------------------------- Payments
  "customers owe us": { title: "Customers owe us", text: "Money customers still have to pay, from the payment sheets: invoices not fully received yet." },
  "past the due date": { title: "Past the due date", text: "The part of that money whose payment date (invoice date plus the credit days) has passed." },
  "we owe suppliers": { title: "We owe suppliers", text: "Money we still have to pay our vendors, from the payment sheets." },
  "blocked debtors": { title: "Blocked debtors", text: "Customers whose invoices the sheet marks as “Blocked”: money that is stuck and needs follow-up, often an old dispute." },
  "pending": { title: "Pending", text: "The part of the invoice that has not been paid yet." },
  "overdue": { title: "Overdue days", text: "How many days after the due date the invoice is still unpaid. A minus or zero means not due yet." },
  "overdue days": { title: "Overdue days", text: "How many days after the due date the invoice is still unpaid. Zero or a minus means it is not due yet." },
  "checked": { title: "Checked", text: "Someone ticked this bill as checked in the payment sheet." },
  "sales invoiced": { title: "Sales invoiced", text: "The total of sales invoices written in the chosen period, from the payment sheets." },
  "purchases invoiced": { title: "Purchases invoiced", text: "The total of purchase bills in the chosen period." },
  "expenses": { title: "Expenses", text: "Payments entered through the GPay / expense form in the chosen period." },

  // ---------------------------------------------------------------- Orders
  "open orders": { title: "Open orders", text: "Customer orders where at least one line has not been sent yet." },
  "past the delivery date": { title: "Past the delivery date", text: "Open orders whose promised delivery date has already passed." },
  "orders received": { title: "Orders received", text: "Orders entered in the chosen period, with how many lines they hold." },
  "from stock / bought for it": { title: "From stock / bought for it", text: "How many order lines are filled from plates we already hold, against lines where the material is bought specially for that order." },
  "lines still to send": { title: "Lines still to send", text: "Order lines not marked as sent yet." },
  "trips": { title: "Trips", text: "The number of vehicle trips written in the vehicle register for the period." },
  "sent out": { title: "Sent out", text: "The total weight of material that left on those trips." },
  "without a readable date": { title: "Without a readable date", text: "Trips whose date in the sheet could not be read, so they are left out of the month-by-month figures." },

  // ---------------------------------------------------------------- Mill orders
  "purchase orders": { title: "Purchase orders", text: "Orders we placed with the mills for new material." },
  "ordered": { title: "Ordered", text: "The weight we asked the mill to supply." },
  "still to arrive": { title: "Still to arrive", text: "Ordered minus received, for lines that are not complete yet." },
  "pending (kg)": { title: "Pending", text: "Ordered minus received. A minus means the mill sent more than ordered." },

  // ---------------------------------------------------------------- Documents and drafts
  "checks": { title: "Checks", text: "Automatic checks of the numbers (totals, GST, GSTIN). “to check” means something does not add up and a person should look; “clear” means every check passed." },
  "draft": { title: "Draft", text: "A confirmed document waiting to become a real order or invoice. A draft changes nothing by itself: it is a prepared copy to work from." },
  "hsn · heat · plate": { title: "HSN, heat, plate", text: "The tax code, the mill batch number and the plate number read from the line." },
  "what was found": { title: "What was found", text: "A problem the system noticed while comparing the sheets, for example a plate sold more than was received." },

  // ---------------------------------------------------------------- Overview
  "plates in stock": { title: "Plates in stock", text: "How many separate plates still have material left. Each can be traced to its heat or plate number." },
  "needs review": { title: "Needs review", text: "Findings the sheets could not settle on their own, such as a plate sold more than received. Open to go through them." },
  "received in period": { title: "Received in period", text: "Weight that arrived in the chosen period. The arrow compares it with the period before." },
  "sold in period": { title: "Sold in period", text: "Weight sold in the chosen period. The arrow compares it with the period before." },

  // ---------------------------------------------------------------- Mail and leads
  "mails waiting for a reply": { title: "Mails waiting for a reply", text: "Mails in the email tracker still marked Pending: nobody has answered them yet. Urgent are the ones marked Urgent." },
  "quotes with no follow-up": { title: "Quotes with no follow-up", text: "Quotations sent that nobody followed up on yet." },
  "quotations sent": { title: "Quotations sent", text: "Quotations recorded in the tracker, and how many carry a quotation number." },
  "indiamart leads": { title: "IndiaMART leads", text: "Enquiries that came from IndiaMART. Buy leads are people who want to buy." },
  "follow-up": { title: "Follow-up", text: "How many follow-up calls or mails were done for this quotation (1 done, 2 done) or that the order was won." },

  // ---------------------------------------------------------------- Tally vs sheets
  "debtors vs sheets": { title: "Debtors vs sheets", text: "For each customer, what Tally says they owe next to what the payment sheet says. A difference means the two books disagree: one needs correcting." },
  "creditors vs sheets": { title: "Creditors vs sheets", text: "For each vendor, what Tally says we owe next to what the payment sheet says." },
};

export const GLOSSARY: Record<string, Entry> = G;

/** Find an explanation from a label as written on screen: lower case, without units or trailing counts. */
export function explain(label: string): Entry | null {
  const k = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (G[k]) return G[k];
  const bare = k.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s*:\s*$/, "").trim();
  return G[bare] ?? null;
}

/** Shown beside an invoice whose number in Tally is only X, XX, XXXX. */
export const PLACEHOLDER_INVOICE =
  "The invoice number typed in Tally is only X, XX or XXXX. That is a placeholder, not a real invoice number: usually a draft or practice entry (these also have tiny amounts or 1 kg quantities and a future date). Ask the accountant whether it is a real invoice and, if so, to put its real number in Tally.";
