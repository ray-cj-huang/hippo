const ABBREVIATIONS = new Set([
  "dr",
  "mr",
  "mrs",
  "ms",
  "st",
  "jr",
  "sr",
  "a.m",
  "p.m",
  "e.g",
  "i.e",
  "vs",
]);
const MAX_CHARS = 220;

export class SentenceChunker {
  private buffer = "";

  push(text: string): string[] {
    this.buffer += text;
    const sentences: string[] = [];
    let start = 0;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const ch = this.buffer[i];
      if ((ch === "." || ch === "?" || ch === "!") && /\s/.test(this.buffer[i + 1] ?? "")) {
        const candidate = this.buffer.slice(start, i + 1).trim();
        if (ch === "." && endsWithAbbreviation(candidate)) continue;
        if (candidate) sentences.push(candidate);
        start = i + 1;
      }
    }
    this.buffer = this.buffer.slice(start);

    if (this.buffer.length > MAX_CHARS) {
      const cut = Math.max(
        this.buffer.lastIndexOf(", ", MAX_CHARS),
        this.buffer.lastIndexOf(" ", MAX_CHARS),
      );
      if (cut > 0) {
        sentences.push(this.buffer.slice(0, cut + 1).trim());
        this.buffer = this.buffer.slice(cut + 1);
      }
    }
    return sentences;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

function endsWithAbbreviation(sentence: string): boolean {
  const lastWord = sentence.slice(0, -1).split(/\s+/).at(-1)?.toLowerCase() ?? "";
  return ABBREVIATIONS.has(lastWord);
}
