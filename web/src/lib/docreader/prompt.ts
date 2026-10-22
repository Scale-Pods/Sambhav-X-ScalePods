// The reading instructions and the fixed answer shape. Kept identical to tools/docs-trial/read_docs.py (the version tested in Phase 0).
// Change both together and re-run the test set before release.
export const PROMPT_VERSION = "v2-2026-10-24";

export const SYSTEM = "You read documents for Sambhav Pipes & Fittings (SPF), a Mumbai steel trader. Related selling names: Sai Steel & Engineering Co, Sambhav Metal, RS (they appear as \"Sambhav Steel\", \"Sambhav Pipe\", \"Sambhav Metal\" etc. - all the seller side). They sell alloy steel plates (SA 387 Gr 11/12/22/5/91 Cl 1/2, 16Mo3, SA 516, S690QL), pipes, fittings, flanges and bolts.\nCustomers send orders as typed PDFs, scans, photos of printed POs, handwritten notes on their letterhead, WhatsApp or email screenshots. Some files are not orders.\n\nExtract exactly what the document shows, using the picture itself. Rules:\n\n1. Never guess. If a value is missing, unreadable or ambiguous, leave it empty (\"\" / not_shown) and add a line to `uncertain` (\"field: reason\"). Also list anything inconsistent (dates, arithmetic, units, struck-out text, cut-off edges, a digit you could read two ways).\n\n2. Direction - decide it from who is ordering from whom:\n   - customer_orders_from_us: a buyer orders from SPF/Sai/Sambhav. This includes any PO or order *addressed to* Sambhav/SPF/Sai (the customer is the buyer; SPF is the vendor/supplier/\"issued to\"), handwritten notes on a customer's letterhead addressed \"To Sambhav\", and WhatsApp messages passed on by \"Mukesh Sir\" or \"Harshil Sir\" (they forward customer orders; they are staff, not the buyer).\n   - we_buy_from_supplier: SPF is the buyer and issues the order to a supplier (the PO is on SPF's letterhead, or says \"SPF to <supplier>\").\n   - our_own_document: our proforma invoice, our sales invoice, our sent mail.\n   - unclear: only when nothing in the picture tells you.\n\n3. doc_kind and is_firm_order:\n   - A customer's PO, amendment, email confirmation or order note is a firm order (is_firm_order=true), even if forwarded, unsigned or on plain paper. A forwarded WhatsApp message headed \"Order\", \"Purchase Order\", \"PO\", \"We confirm PO\" or \"Order confirmation\" with sizes and a rate is a firm order (chat_order).\n   - A handwritten note headed \"D.O.\" or \"Order\" on a customer's letterhead is a customer order (handwritten_order). broker_delivery_order is only for a printed slip by a broker/co-ordinator (e.g. Nalin Girish, Mehul Trivedi) with brokerage and rate per M/T.\n   - Mark is_firm_order=false only for: price negotiations where the rate or terms are still being argued, our own proformas/invoices/mails, lorry receipts, rate cards/offers, registration certificates, and pure fragments with no order intent. If a PO is marked UNAPPROVED, draft or \"waiting for approval\", still mark it as an order but put the status in `uncertain`.\n   - An order that lacks a price or quantity is still an order: set is_firm_order=true and list the gap in `uncertain`.\n\n4. Dates as YYYY-MM-DD (Indian day/month/year). Use the date printed or written on the document. The file name often carries the date the photo or screenshot was taken (e.g. \"2026-01-03\"): a handwritten date should be consistent with it (same or slightly earlier); if your reading puts the year a year earlier than the file date, re-read the digits, and if still unsure keep what you see and flag it. WhatsApp bubbles show only a time: leave the date empty unless a date is visible. For an amendment use the amendment date in po_date and mention the original order date in `uncertain` or delivery_terms.\n\n5. Numbers: copy as shown. Rates are per kg unless the document says per MT/tonne, per piece or per metre; record the unit shown. In Indian handwriting \"148/-\" means rupees 148 (the \"/-\" is a currency mark, not a digit): never read it as 1481 or 1487. Steel plate rates are normally between about 60 and 600 rupees per kg (per MT: 60,000-600,000). If a rate you read falls outside that, re-read the digits and flag it. Indian grouping 1,23,456.00 means 123456.00; some scans use dots, e.g. 2.33.145.00 means 233145.00.\n\n6. Plate sizes are thickness x width x length in mm (6mm x 1250 x 6300). Write each dimension in its own field, one line item per size. If a size or quantity is written only once for several lines, repeat it on each line and flag that.\n\n7. Totals: net_amount = before tax, tax_amount = GST/IGST total, total_amount = final payable including tax. Fill what the document shows; leave the others empty. Do not calculate.\n\n8. document_number is the number printed on this document (PO no., order no., D.O. no., SR no., proforma no., LR no.). po_number is the customer's PO/order number only. For handwritten notes use a ref number only if written. Do not invent numbers, and never use the file name as a number.\n\n9. Include every line item that is visible. For multi-page files you see only the first pages; read what is there and note if a page says \"Page 1 of N\".";

export const SCHEMA = {
  "type": "object",
  "properties": {
    "doc_kind": {
      "type": "string",
      "enum": [
        "purchase_order",
        "po_amendment",
        "typed_order_note",
        "chat_order",
        "handwritten_order",
        "broker_delivery_order",
        "email_order",
        "negotiation_not_final",
        "our_proforma_invoice",
        "our_sales_invoice",
        "transport_receipt",
        "price_list_or_offer",
        "registration_or_certificate",
        "sent_mail_or_notice",
        "other_not_an_order"
      ]
    },
    "is_firm_order": {
      "type": "boolean"
    },
    "direction": {
      "type": "string",
      "enum": [
        "customer_orders_from_us",
        "we_buy_from_supplier",
        "our_own_document",
        "unclear"
      ]
    },
    "seller_entity_named": {
      "type": "string"
    },
    "buyer_name": {
      "type": "string"
    },
    "buyer_gstin": {
      "type": "string"
    },
    "po_number": {
      "type": "string"
    },
    "document_number": {
      "type": "string",
      "description": "the number printed on this document: PO / order / D.O. / proforma / SR / LR number; empty if none"
    },
    "po_date": {
      "type": "string",
      "description": "YYYY-MM-DD or empty"
    },
    "currency": {
      "type": "string"
    },
    "payment_terms": {
      "type": "string"
    },
    "delivery_terms": {
      "type": "string"
    },
    "net_amount": {
      "type": "string",
      "description": "total before tax, as shown, or empty"
    },
    "tax_amount": {
      "type": "string",
      "description": "total GST/IGST as shown, or empty"
    },
    "total_amount": {
      "type": "string",
      "description": "final payable total including tax, as shown, or empty"
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": {
            "type": "string",
            "description": "item as written"
          },
          "grade": {
            "type": "string"
          },
          "thickness_mm": {
            "type": "string"
          },
          "width_mm": {
            "type": "string"
          },
          "length_mm": {
            "type": "string"
          },
          "qty": {
            "type": "string",
            "description": "number as shown"
          },
          "qty_unit": {
            "type": "string",
            "enum": [
              "nos",
              "kg",
              "mt",
              "m",
              "m2",
              "other",
              "not_shown"
            ]
          },
          "weight_kg": {
            "type": "string"
          },
          "rate": {
            "type": "string",
            "description": "number as shown"
          },
          "rate_unit": {
            "type": "string",
            "enum": [
              "per_kg",
              "per_mt",
              "per_nos",
              "per_m",
              "other",
              "not_shown"
            ]
          },
          "amount": {
            "type": "string"
          }
        },
        "required": [
          "description",
          "grade",
          "thickness_mm",
          "width_mm",
          "length_mm",
          "qty",
          "qty_unit",
          "weight_kg",
          "rate",
          "rate_unit",
          "amount"
        ],
        "additionalProperties": false
      }
    },
    "readable": {
      "type": "boolean"
    },
    "uncertain": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "every value you are not sure of, as 'field: why'"
    }
  },
  "required": [
    "doc_kind",
    "is_firm_order",
    "direction",
    "seller_entity_named",
    "buyer_name",
    "buyer_gstin",
    "po_number",
    "document_number",
    "po_date",
    "currency",
    "payment_terms",
    "delivery_terms",
    "net_amount",
    "tax_amount",
    "total_amount",
    "lines",
    "readable",
    "uncertain"
  ],
  "additionalProperties": false
} as const;
