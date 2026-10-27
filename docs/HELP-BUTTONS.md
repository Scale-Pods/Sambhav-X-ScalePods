# The "i" help buttons (29 Oct 2026)

Anyone new to the app should be able to tell what a column, a number or a status label means without asking. Every such label can carry a small **i**: hover, tap or tab to it and a short plain-language box opens (Esc or a tap elsewhere closes it).

- `web/src/components/Info.tsx`: the button and its box (drawn on top of the page, so scrolling tables never cut it off).
- `web/src/lib/glossary.ts`: the explanations for labels that mean the same thing everywhere (Customer PO, Certificates, Heat no, Vehicle register, E-invoice, Connection, Plates left ...). Keys are the lower-case label; units in brackets are ignored. Labels whose meaning changes from page to page (Status, Due, Note, Invoice ...) are NOT in it: those get an explanation where they are used.
- Where it appears: table headings (`<Th>`; a column in a list gets `info:`), tiles (`<Stat>`, automatically when the label is in the glossary, or `info=`), status labels (`<Badge info=...>`), the page title (`<PageHeader help=...>`, an "i" next to the heading with how to read the page) and card titles (`<Card help=...>`).
- Adding one: put the text in `glossary.ts` if it means the same everywhere, otherwise pass `info` / `help` at the place. Keep it short: what it is, what the values mean, what to do when it looks wrong.
- Tally invoices page: an invoice whose Tally number is only X, XX, XXXX is marked "placeholder no." (a draft or practice entry), and the page has a "How to read this table" box.
