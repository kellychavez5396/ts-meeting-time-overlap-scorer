import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MeetingTimeOverlapScorer,
  parseTimeOfDay,
  formatTimeOfDay,
} from '../src/index.js';

// A frozen reference instant so DST offsets are deterministic.
const REFERENCE = new Date('2024-01-15T12:00:00Z');

function makeWindow({ timeZone, day, start, end }) {
  return new MeetingTimeOverlapScorer({ timeZone, day, start, end, reference: REFERENCE });
}

test('parseTimeOfDay accepts valid times', () => {
  assert.equal(parseTimeOfDay('00:00'), 0);
  assert.equal(parseTimeOfDay('09:30'), 9 * 60 + 30);
  assert.equal(parseTimeOfDay('23:59'), 23 * 60 + 59);
});

test('parseTimeOfDay rejects malformed times', () => {
  assert.throws(() => parseTimeOfDay('24:00'), RangeError);
  assert.throws(() => parseTimeOfDay('12:60'), RangeError);
  assert.throws(() => parseTimeOfDay('noon'), RangeError);
  assert.throws(() => parseTimeOfDay(930), TypeError);
});

test('formatTimeOfDay wraps and pads', () => {
  assert.equal(formatTimeOfDay(0), '00:00');
  assert.equal(formatTimeOfDay(9 * 60 + 5), '09:05');
  assert.equal(formatTimeOfDay(-1), '23:59');
  assert.equal(formatTimeOfDay(24 * 60), '00:00');
});

test('identical windows in the same timezone score 1', () => {
  const a = makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '10:00' });
  const b = makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '10:00' });
  assert.equal(a.score(b), 1);
  assert.equal(a.overlapMinutes(b), 60);
});

test('disjoint windows score 0', () => {
  const a = makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '10:00' });
  const b = makeWindow({ timeZone: 'UTC', day: 0, start: '11:00', end: '12:00' });
  assert.equal(a.score(b), 0);
});

test('partial overlap is proportional to the shorter window', () => {
  const a = makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '10:00' });
  const b = makeWindow({ timeZone: 'UTC', day: 0, start: '09:30', end: '10:30' });
  assert.equal(a.overlapMinutes(b), 30);
  assert.equal(a.score(b), 0.5);
});

test('a short meeting inside a long one scores 1', () => {
  const short = makeWindow({ timeZone: 'UTC', day: 0, start: '09:15', end: '09:45' });
  const long = makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '11:00' });
  assert.equal(short.score(long), 1);
  assert.equal(long.score(short), 1);
});

test('overnight meeting wraps past midnight', () => {
  const a = makeWindow({ timeZone: 'UTC', day: 0, start: '23:00', end: '01:00' });
  const b = makeWindow({ timeZone: 'UTC', day: 1, start: '00:30', end: '01:30' });
  assert.equal(a.overlapMinutes(b), 30);
  assert.equal(a.score(b), 0.5);
});

test('meeting on Sunday can overlap Monday morning', () => {
  const sunday = makeWindow({ timeZone: 'UTC', day: 6, start: '23:00', end: '23:30' });
  const monday = makeWindow({ timeZone: 'UTC', day: 0, start: '00:00', end: '00:15' });
  assert.equal(sunday.overlapMinutes(monday), 0);
  assert.equal(sunday.score(monday), 0);
});

test('timezone offset shifts the UTC window', () => {
  // 09:00 in New York (UTC-5 in January) is 14:00 UTC.
  const ny = makeWindow({ timeZone: 'America/New_York', day: 0, start: '09:00', end: '10:00' });
  const utc = makeWindow({ timeZone: 'UTC', day: 0, start: '14:00', end: '15:00' });
  assert.equal(ny.overlapMinutes(utc), 60);
  assert.equal(ny.score(utc), 1);
});

test('DST shifts the offset used for the window', () => {
  const winter = new Date('2024-01-15T12:00:00Z');
  const summer = new Date('2024-07-15T12:00:00Z');
  const nyWinter = new MeetingTimeOverlapScorer({
    timeZone: 'America/New_York',
    day: 0,
    start: '09:00',
    end: '10:00',
    reference: winter,
  });
  const nySummer = new MeetingTimeOverlapScorer({
    timeZone: 'America/New_York',
    day: 0,
    start: '09:00',
    end: '10:00',
    reference: summer,
  });
  const utc = makeWindow({ timeZone: 'UTC', day: 0, start: '14:00', end: '15:00' });
  assert.equal(nyWinter.score(utc), 1);
  assert.equal(nySummer.score(utc), 0);
});

test('constructor rejects zero-length meetings', () => {
  assert.throws(
    () => makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '09:00' }),
    RangeError,
  );
});

test('constructor rejects invalid timezones', () => {
  assert.throws(
    () => makeWindow({ timeZone: 'Not/AZone', day: 0, start: '09:00', end: '10:00' }),
    RangeError,
  );
});

test('overlapMinutes rejects non-scorer arguments', () => {
  const a = makeWindow({ timeZone: 'UTC', day: 0, start: '09:00', end: '10:00' });
  assert.throws(() => a.overlapMinutes({}), TypeError);
});
