import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as time from '../packages/school/src/time.ts';
import * as fields from '../portal/src/lib/fields.ts';
import * as tours from '../packages/school/src/tours/model.ts';
import * as series from '../packages/school/src/scheduling/schedule-series.ts';
import * as dates from '../src/lib/admissions/dates.ts';
import * as flyer from '../src/lib/flyerExpiration.ts';
import * as present from '../admin/src/lib/present.ts';
import * as classreach from '../packages/school/src/classreach.ts';

// Recorded against origin/main before moving implementations. Preserve even
// permissive parsing, rollover, DST gap/fold choices and thrown error messages.
const modules = { time, fields, tours, series, dates, flyer, present, classreach };
const cases = JSON.parse(readFileSync(new URL('./fixtures/time-outputs.json', import.meta.url)));
for (const { module, helper, args, expected, error } of cases) {
 test(`${module}.${helper}(${JSON.stringify(args)})`, () => {
  const input = args.map(arg => arg && typeof arg === 'object' && '$date' in arg ? new Date(arg.$date) : arg);
  const call = () => modules[module][helper](...input);
  if (error) assert.throws(call, { name: error.name, message: error.message });
  else assert.deepEqual(call(), expected);
 });
}

test('schedule Chicago today matches website calendar date across DST and midnight', t => {
 t.mock.timers.enable({ apis: ['Date'], now: 0 });
 for (const iso of ['2027-03-14T05:59:59Z', '2027-03-14T06:00:00Z', '2027-03-14T08:00:00Z', '2027-11-07T04:59:59Z', '2027-11-07T05:00:00Z', '2027-11-07T07:00:00Z']) {
  t.mock.timers.setTime(new Date(iso).getTime());
  assert.equal(series.chicagoToday(), dates.chicagoToday(new Date(iso)));
 }
});
