# ts-meeting-time-overlap-scorer

Computes a similarity score between two recurring weekly meeting windows in named timezones, resolving DST via a caller-supplied reference instant.

## Usage

```js
import { MeetingTimeOverlapScorer } from './src/index.js';

// A frozen instant so DST offsets are deterministic.
const reference = new Date('2024-01-15T12:00:00Z');

const standup = new MeetingTimeOverlapScorer({
  timeZone: 'America/New_York',
  day: 0, // Monday
  start: '09:00',
  end: '09:30',
  reference,
});

const sync = new MeetingTimeOverlapScorer({
  timeZone: 'UTC',
  day: 0,
  start: '14:00',
  end: '15:00',
  reference,
});

standup.score(sync); // 1, the standup fits entirely inside the sync
standup.overlapMinutes(sync); // 30
```

The module also exports `parseTimeOfDay('HH:MM')` and `formatTimeOfDay(minutes)`.

## Why this exists

Comparing meeting times across timezones is easy until DST enters the picture. A naive implementation converts both windows using the current offset, which silently produces wrong answers for half the year. This library forces the caller to pass a `reference` Date, so the offset is resolved at a specific instant and the result is reproducible. The trade-off is that the same weekly window is treated as having one fixed offset for the whole week; a meeting that straddles a DST transition will be scored using the offset in effect at the reference instant, not the offset at the meeting itself. That is documented and tested rather than hidden.

## Edge cases

- Overnight meetings are supported: `start: '23:00', end: '01:00'` wraps past midnight.
- A window is a half-open weekly interval on the UTC clock, so a Sunday 23:00 meeting and a Monday 00:00 meeting do not overlap. Week-wrap overlap is handled by trying both placements.
- `score` divides by the shorter of the two durations, so a short meeting fully inside a long one scores 1. Zero-length meetings are rejected at construction.
- Invalid timezone names and malformed `HH:MM` strings throw `RangeError` at construction time.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

