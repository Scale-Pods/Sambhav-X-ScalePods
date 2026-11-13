// An amount in rupees written in words the Indian way (lakh, crore): 516781 -> "Rupees Five Lakh Sixteen Thousand Seven Hundred Eighty One Only".
// Paise are written too ("... and Fifty Paise"). Plain code, used on the screen and in the Excel file.

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`);
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " + below100(n % 100) : ""}` : below100(n));

function words(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000); n %= 10_000_000;
  const lakh = Math.floor(n / 100_000); n %= 100_000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${words(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

export function rupeesInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  const paise = Math.round(amount * 100);
  const rupees = Math.floor(paise / 100), p = paise % 100;
  return `Rupees ${words(rupees)}${p ? ` and ${below100(p)} Paise` : ""} Only`;
}
