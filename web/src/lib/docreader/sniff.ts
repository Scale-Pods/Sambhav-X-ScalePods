/** The real type of a file from its first bytes (the browser's claim is never trusted). null when it is none of the types the reader handles. */
export function sniffType(b: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  const at = (i: number, s: string) => s.split("").every((c, j) => b[i + j] === c.charCodeAt(0));
  if (b.length >= 5 && at(0, "%PDF-")) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG") && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  return null;
}
