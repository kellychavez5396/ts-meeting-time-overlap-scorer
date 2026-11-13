// Core implementation for ts-meeting-time-overlap-scorer.
//
// The scorer models a recurring meeting window as a half-open interval
// [startMinutes, endMinutes) on a weekly clock, where Monday 00:00 is minute 0
// and Sunday 24:00 is minute 10080. This makes week-wrap arithmetic a simple
// modulo operation and avoids Date objects entirely except when converting a
// wall-clock time in a specific IANA timezone to UTC.
//
// DST is handled by comparing the two windows at a fixed UTC instant (the
// "reference" instant) supplied by the caller. The caller is expected to pass a
// Date-like value; the tests pass a frozen Date so the result is deterministic.
// We do not attempt to average over a year because that would make the score
// depend on the machine's clock and the tz database version.

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/**
 * Parse a "HH:MM" string into minutes since midnight.
 * Throws on malformed input so callers learn about typos early.
 * @param {string} text
 * @returns {number}
 */
export function parseTimeOfDay(text) {
  if (typeof text !== 'string') {
    throw new TypeError('time must be a string in HH:MM form');
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) {
    throw new RangeError(`invalid time of day: ${text}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new RangeError(`invalid time of day: ${text}`);
  }
  return hours * 60 + minutes;
}

/**
 * Format minutes since midnight as "HH:MM".
 * @param {number} minutes
 * @returns {string}
 */
export function formatTimeOfDay(minutes) {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Convert a day-of-week (0 = Monday) and minutes-since-midnight in a named
 * timezone into minutes since Monday 00:00 UTC at the given reference instant.
 *
 * We use Intl.DateTimeFormat with timeZoneName: 'shortOffset' to obtain the
 * UTC offset in effect at that instant. This is the only standard-library way
 * to get a timezone offset without pulling in a dependency, and it accounts for
 * DST because the formatter resolves the offset at the reference instant.
 *
 * @param {number} day 0..6, Monday = 0
 * @param {number} minutes minutes since midnight, 0..1439
 * @param {string} timeZone IANA timezone name
 * @param {Date} reference instant used to resolve the offset
 * @returns {number} minutes since Monday 00:00 UTC, in [0, 10080)
 */
function localToUtcMinutes(day, minutes, timeZone, reference) {
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new RangeError(`day must be an integer in 0..6, got ${day}`);
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError(`minutes must be an integer in 0..1439, got ${minutes}`);
  }
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new TypeError('timeZone must be a non-empty IANA name');
  }
  if (!(reference instanceof Date) || Number.isNaN(reference.getTime())) {
    throw new TypeError('reference must be a valid Date');
  }

  // Build a UTC instant that has the same wall-clock day and time, then read
  // back the offset the timezone had at the reference instant. This is a
  // deliberate simplification: we assume the offset at the reference instant
  // applies to the whole weekly window. That is the documented trade-off.
  const utcMillis = Date.UTC(2024, 0, 1 + day, Math.floor(minutes / 60), minutes % 60);
  const probe = new Date(utcMillis);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(reference);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName');
  if (!offsetPart) {
    throw new RangeError(`could not resolve offset for timezone ${timeZone}`);
  }
  const offsetMinutes = parseOffset(offsetPart.value, timeZone);

  // The wall-clock time in the target zone corresponds to UTC wall-clock time
  // minus the offset. Convert that back to minutes since Monday 00:00 UTC.
  const localMinutes = day * MINUTES_PER_DAY + minutes;
  const utcMinutes = localMinutes - offsetMinutes;
  return modulo(utcMinutes, MINUTES_PER_WEEK);
}

/**
 * Parse an offset string like "GMT+5:30" or "GMT-8" into minutes east of UTC.
 * @param {string} text
 * @param {string} timeZone used only for error messages
 * @returns {number}
 */
function parseOffset(text, timeZone) {
  if (text === 'GMT' || text === 'UTC') {
    return 0;
  }
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(text);
  if (!match) {
    throw new RangeError(`unrecognized offset ${text} for timezone ${timeZone}`);
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const mins = match[3] ? Number(match[3]) : 0;
  return sign * (hours * 60 + mins);
}

function modulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * A recurring weekly meeting window in a specific timezone.
 */
export class MeetingTimeOverlapScorer {
  /**
   * @param {object} options
   * @param {string} options.timeZone IANA timezone name
   * @param {number} options.day 0 = Monday .. 6 = Sunday
   * @param {string} options.start "HH:MM" local time
   * @param {string} options.end "HH:MM" local time, exclusive; may be <= start for overnight meetings
   * @param {Date} options.reference instant used to resolve DST offsets
   */
  constructor({ timeZone, day, start, end, reference }) {
    if (typeof timeZone !== 'string' || timeZone.length === 0) {
      throw new TypeError('timeZone must be a non-empty IANA name');
    }
    if (!(reference instanceof Date) || Number.isNaN(reference.getTime())) {
      throw new TypeError('reference must be a valid Date');
    }
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new RangeError(`day must be an integer in 0..6, got ${day}`);
    }
    const startMinutes = parseTimeOfDay(start);
    const endMinutes = parseTimeOfDay(end);
    if (startMinutes === endMinutes) {
      throw new RangeError('start and end must differ; zero-length meetings are not supported');
    }

    const startUtc = localToUtcMinutes(day, startMinutes, timeZone, reference);
    let duration = endMinutes - startMinutes;
    if (duration < 0) {
      duration += MINUTES_PER_DAY;
    }
    if (duration <= 0 || duration > MINUTES_PER_WEEK) {
      throw new RangeError('meeting duration must be positive and at most one week');
    }

    this.timeZone = timeZone;
    this.day = day;
    this.start = start;
    this.end = end;
    this.reference = reference;
    this.startUtc = startUtc;
    this.duration = duration;
  }

  /**
   * Compute the overlap in minutes between this window and another, treating
   * both as recurring weekly intervals on the UTC clock. Because intervals can
   * wrap past Sunday 24:00, we test both the direct placement and the shifted
   * placement, then take the maximum overlap.
   *
   * @param {MeetingTimeOverlapScorer} other
   * @returns {number} overlap in minutes, 0..duration
   */
  overlapMinutes(other) {
    if (!(other instanceof MeetingTimeOverlapScorer)) {
      throw new TypeError('other must be a MeetingTimeOverlapScorer');
    }
    const a = this.startUtc;
    const b = other.startUtc;
    const da = this.duration;
    const db = other.duration;

    // Try all four placements: a at 0, b at 0, b shifted by a week, and a
    // shifted by a week. The maximum overlap is the true weekly overlap.
    const placements = [
      [a, b],
      [a, b + MINUTES_PER_WEEK],
      [a + MINUTES_PER_WEEK, b],
      [a + MINUTES_PER_WEEK, b + MINUTES_PER_WEEK],
    ];
    let best = 0;
    for (const [sa, sb] of placements) {
      const start = Math.max(sa, sb);
      const end = Math.min(sa + da, sb + db);
      const overlap = end - start;
      if (overlap > best) {
        best = overlap;
      }
    }
    return Math.min(best, Math.min(da, db));
  }

  /**
   * Similarity score in [0, 1]: overlap divided by the shorter of the two
   * meeting durations. This rewards a short meeting that fits entirely inside a
   * long one, which is usually what a meeting organizer cares about.
   *
   * @param {MeetingTimeOverlapScorer} other
   * @returns {number}
   */
  score(other) {
    const overlap = this.overlapMinutes(other);
    const denom = Math.min(this.duration, other.duration);
    if (denom === 0) {
      return 0;
    }
    return overlap / denom;
  }
}
