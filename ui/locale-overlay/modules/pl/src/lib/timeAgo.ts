// overlay-upstream-sha256: a9daffa1258e2458e06a91013bcbffd7edcb43bbf2e7e47844a2ff1bf88e871a
// Polish replacement for src/lib/timeAgo.ts, served by the locale overlay when
// PAPERCLIP_UI_LOCALE=pl. Keep the exported API identical to upstream.
// Abbreviated units ("min", "godz.", "tyg.", "mies.") avoid Polish plural
// forms; days are the only unit spelled out.
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.round((now - then) / 1000);

  if (seconds < MINUTE) return "przed chwilą";
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min temu`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)} godz. temu`;
  if (seconds < WEEK) {
    const days = Math.floor(seconds / DAY);
    return days === 1 ? "1 dzień temu" : `${days} dni temu`;
  }
  if (seconds < MONTH) return `${Math.floor(seconds / WEEK)} tyg. temu`;
  return `${Math.floor(seconds / MONTH)} mies. temu`;
}
