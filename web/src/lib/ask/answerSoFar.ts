/** The text of the "answer" field so far, from the partial JSON of the final_answer tool as it streams in. */
export function answerSoFar(buf: string): string {
  const m = /"answer"\s*:\s*"/.exec(buf);
  if (!m) return "";
  let out = "";
  for (let i = m.index + m[0].length; i < buf.length; i++) {
    const c = buf[i];
    if (c === '"') break;
    if (c === "\\") {
      const n = buf[i + 1];
      if (n === undefined) break;
      if (n === "u") { const hex = buf.slice(i + 2, i + 6); if (hex.length < 4) break; out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue; }
      out += n === "n" ? "\n" : n === "t" ? "\t" : n; i += 1; continue;
    }
    out += c;
  }
  return out;
}
