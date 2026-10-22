// Plain-language names for what the reader decides a document is.
export const KIND: Record<string, string> = {
  purchase_order: "Purchase order", po_amendment: "PO amendment", typed_order_note: "Typed order note", chat_order: "Chat order",
  handwritten_order: "Handwritten order", broker_delivery_order: "Broker delivery order", email_order: "Email order",
  negotiation_not_final: "Price talk (not final)", our_proforma_invoice: "Our proforma", our_sales_invoice: "Our invoice",
  transport_receipt: "Lorry receipt", price_list_or_offer: "Price list / offer", registration_or_certificate: "Certificate",
  sent_mail_or_notice: "Sent mail", other_not_an_order: "Not an order",
};
