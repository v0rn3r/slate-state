// Scheduled housekeeping: roll the day over, and land any change whose 48h
// cooldown has expired.
//
// This script is the ONLY writer the clients trust for limit and unlock state.
// A hand-edit to config/limit.json is overwritten on the next run, because the
// effective value is recomputed from `pending` (which only the request workflow
// can create) rather than read from the file.
import fs from 'node:fs';
import { dayKey } from './day.mjs';

const HARD_CEILING = 2700;
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const cfg = JSON.parse(fs.readFileSync('config/limit.json', 'utf8'));
const now = Date.now();

const today = dayKey();
if (state.day !== today) {
  console.log(`rolling ${state.day} -> ${today} (used ${state.used_seconds}s)`);
  state.day = today;
  state.devices = {};
  state.used_seconds = 0;
}

// A pending change lands only after its effective_at passes. Reductions are
// applied by the request workflow immediately and never arrive here.
if (cfg.pending && cfg.pending.effective_at && now >= Date.parse(cfg.pending.effective_at)) {
  const want = Number(cfg.pending.limit_seconds);
  cfg.limit_seconds = Math.min(HARD_CEILING, Math.max(0, want));
  console.log(`cooldown expired: limit is now ${cfg.limit_seconds}s (requested ${want})`);
  cfg.pending = null;
}

if (state.unlock?.effective_at && now >= Date.parse(state.unlock.effective_at)) {
  state.unlock = { state: 'unlocked', requested_at: state.unlock.requested_at, effective_at: state.unlock.effective_at };
  console.log('cooldown expired: enforcement unlocked');
}

// Clamp the config file itself, not just the published value. Otherwise a hand
// edit to something enormous survives in config/limit.json and makes the next
// set-limit request look like a tightening, which would skip the cooldown.
cfg.limit_seconds = Math.min(HARD_CEILING, Math.max(0, Number(cfg.limit_seconds) || HARD_CEILING));

state.limit_seconds = cfg.limit_seconds;
state.updated_at = new Date().toISOString();

fs.writeFileSync('state.json', JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync('config/limit.json', JSON.stringify(cfg, null, 2) + '\n');
