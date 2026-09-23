// nflverse lists kickoff times in US Eastern time; the odds API works in UTC.

/** Minutes east of UTC for New York at the given instant (-240 in summer, -300 in winter). */
function newYorkOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // e.g. "GMT-4"
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(name);
  if (!m) return 0;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] ?? 0);
}

/** A game's kickoff as a UTC instant, from its Eastern date and time. */
export function kickoffUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, hh, mm);
  // Use the offset in force around that time (a guess 5 hours later is on the right side of any DST switch).
  const offset = newYorkOffsetMinutes(new Date(asIfUtc + 5 * 3600e3));
  return new Date(asIfUtc - offset * 60e3);
}
