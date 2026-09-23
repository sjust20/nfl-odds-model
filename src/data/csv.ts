/** Minimal RFC 4180 parser (quoted fields may contain commas and doubled quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Streaming version of `parseCsv` for files too big to hold as rows (nflverse play-by-play is
 * ~100 MB per season). Feed text chunks with `push`; each completed row goes to `onRow`.
 */
export class CsvStream {
  private row: string[] = [];
  private field = "";
  private quoted = false;
  /** Inside quotes and the last char was a quote: next char decides escape vs close. */
  private quoteSeen = false;

  constructor(private onRow: (row: string[]) => void) {}

  push(chunk: string) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (this.quoted) {
        if (this.quoteSeen) {
          this.quoteSeen = false;
          if (ch === '"') {
            this.field += '"';
            continue;
          }
          this.quoted = false; // the previous quote closed the field; handle ch below
        } else if (ch === '"') {
          this.quoteSeen = true;
          continue;
        } else {
          this.field += ch;
          continue;
        }
      }
      if (ch === '"') this.quoted = true;
      else if (ch === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n") this.endRow();
      else if (ch !== "\r") this.field += ch;
    }
  }

  end() {
    if (this.quoteSeen) this.quoted = false;
    if (this.field !== "" || this.row.length) this.endRow();
  }

  private endRow() {
    this.row.push(this.field);
    this.onRow(this.row);
    this.row = [];
    this.field = "";
  }
}
