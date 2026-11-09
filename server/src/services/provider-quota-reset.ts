/**
 * Reads a provider's "try again at 4:30 PM (America/Chicago)" or
 * "resets 2am (UTC)" wording as the next matching wall-clock instant after
 * `now`. A clock without a time zone is read as UTC.
 * Fork: a dated reset ("resets Oct 28 at 7pm (Europe/Warsaw)") is read as that
 * day, at most 8 days ahead.
 */
export function parseProviderQuotaClockReset(error: string, now: Date) {
  const datedMatch = error.match(/\bresets?\s+(?:at\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:,?\s+at|,)?\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\s*(?:\(([^)]+)\)|\s+([A-Z]{2,5}))?/i);
  if (datedMatch) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf((datedMatch[1] ?? "").toLowerCase()) + 1;
    const day = Number(datedMatch[2]);
    const hour12 = Number(datedMatch[4]);
    const minute = Number(datedMatch[5] ?? "0");
    const hour = hour12 % 12 + ((datedMatch[6] ?? "").toLowerCase() === "p" ? 12 : 0);
    const year = datedMatch[3] ? Number(datedMatch[3]) : now.getUTCFullYear();
    const rawZone = (datedMatch[7] ?? datedMatch[8] ?? "UTC").trim();
    const timeZone = /^(?:utc|gmt)$/i.test(rawZone) ? "UTC" : rawZone;
    if (month < 1 || !Number.isInteger(day) || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const toWallClock = (targetYear: number): Date | null => {
      let candidate = new Date(Date.UTC(targetYear, month - 1, day, hour, minute));
      const target = Date.UTC(targetYear, month - 1, day, hour, minute);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(candidate).map(part => [part.type, part.value]));
        const actual = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
        const adjustment = target - actual;
        if (!adjustment) break;
        candidate = new Date(candidate.getTime() + adjustment);
      }
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(candidate);
      const actual = Object.fromEntries(parts.map(part => [part.type, part.value]));
      if (Number(actual.year) !== targetYear || Number(actual.month) !== month || Number(actual.day) !== day || Number(actual.hour) !== hour || Number(actual.minute) !== minute) return null;
      return candidate;
    };
    try {
      let parsed = toWallClock(year);
      if (!datedMatch[3] && (!parsed || parsed.getTime() <= now.getTime())) parsed = toWallClock(year + 1);
      if (!parsed) return null;
      if (parsed.getTime() <= now.getTime() || parsed.getTime() - now.getTime() > 8 * 86400000) return null;
      return parsed;
    } catch { return null; }
  }
  const match = error.match(
    /(?:try again at|resets?(?:\s+at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?(?:\s*\(([^)]+)\)|\s+([A-Z]{2,5}))?/i,
  );
  if (!match) return null;

  const hourValue = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "0", 10);
  const meridiem = (match[3] ?? "").toLowerCase();
  if (!Number.isInteger(hourValue)) return null;
  if (
    meridiem ? hourValue < 1 || hourValue > 12 : hourValue < 0 || hourValue > 23
  )
    return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  let hour = meridiem ? hourValue % 12 : hourValue;
  if (meridiem === "p") hour += 12;
  const timeZone = (match[4] ?? match[5])?.trim();
  if (!timeZone) {
    const retryAt = new Date(now);
    retryAt.setUTCHours(hour, minute, 0, 0);
    if (retryAt.getTime() <= now.getTime())
      retryAt.setUTCDate(retryAt.getUTCDate() + 1);
    return retryAt;
  }

  try {
    const wallClock = (date: Date) =>
      Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          hourCycle: "h23",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
          .formatToParts(date)
          .map((part) => [part.type, part.value]),
      );
    const nowParts = wallClock(now);
    const buildRetryAt = (dayOffset: number) => {
      const targetDay = new Date(
        Date.UTC(
          Number(nowParts.year),
          Number(nowParts.month) - 1,
          Number(nowParts.day) + dayOffset,
          hour,
          minute,
        ),
      );
      let candidate = targetDay;
      const targetMs = targetDay.getTime();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const actual = wallClock(candidate);
        const actualMs = Date.UTC(
          Number(actual.year),
          Number(actual.month) - 1,
          Number(actual.day),
          Number(actual.hour),
          Number(actual.minute),
        );
        const adjustment = targetMs - actualMs;
        if (adjustment === 0) break;
        candidate = new Date(candidate.getTime() + adjustment);
      }
      return candidate;
    };
    const sameDay = buildRetryAt(0);
    return sameDay.getTime() > now.getTime() ? sameDay : buildRetryAt(1);
  } catch {
    return null;
  }
}
