// Applies one device's usage report to the shared counter.
//
// Devices report a MONOTONIC total ("I have used N seconds today"), never a delta.
// That makes every dispatch idempotent: a duplicate, a retry, or an out-of-order
// run can never inflate or deflate the count.
import fs from 'node:fs';
import { dayKey } from './day.mjs';

const HARD_CEILING = 2700;
const STATE = 'state.json';

const device = String(process.env.SLATE_DEVICE || '').trim();
const day = String(process.env.SLATE_DAY || '').trim();
const seconds = Number(process.env.SLATE_SECONDS || 0);

if (!/^[a-z0-9-]{1,32}$/.test(device)) throw new Error(`bad device id: ${device}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day: ${day}`);
if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
  throw new Error(`bad seconds: ${seconds}`);
}

// A device reporting a day that is not the server's day is either clock-skewed or
// lying. Either way its report is dropped rather than trusted.
const today = dayKey();
if (day !== today) {
  console.log(`dropping report for ${day}; server day is ${today}`);
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));

if (state.day !== today) {
  state.day = today;
  state.devices = {};
  state.used_seconds = 0;
}

const limitCfg = JSON.parse(fs.readFileSync('config/limit.json', 'utf8'));
state.limit_seconds = Math.min(HARD_CEILING, Number(limitCfg.limit_seconds) || HARD_CEILING);

const prev = Number(state.devices[device] || 0);
state.devices[device] = Math.max(prev, Math.round(seconds));
state.used_seconds = Object.values(state.devices).reduce((a, b) => a + Number(b || 0), 0);
state.updated_at = new Date().toISOString();

fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
console.log(
  `${device}: ${prev} -> ${state.devices[device]}s | total ${state.used_seconds}/${state.limit_seconds}s`
);
