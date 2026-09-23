import { describe, expect, it } from "vitest";
import { CsvStream, parseCsv } from "../data/csv";

const text = 'a,b,c\r\n1,"x, ""quoted"" y",3\n"",,"end"\n4,5,6';

describe("CSV", () => {
  it("streaming parser matches the whole-text parser for any chunking", () => {
    const expected = parseCsv(text);
    for (let size = 1; size <= text.length; size++) {
      const rows: string[][] = [];
      const s = new CsvStream((r) => rows.push(r));
      for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
      s.end();
      expect(rows).toEqual(expected);
    }
    expect(expected[1]).toEqual(["1", 'x, "quoted" y', "3"]);
  });
});
