// Files a change request. Anything that makes the rules looser is put behind a
// 48h cooldown; anything that makes them stricter takes effect immediately.
import fs from 'node:fs';

const HARD_CEILING = 2700;
const COOLDOWN_HOURS = 48;

const action = String(process.env.SLATE_ACTION || '').trim();
const value = Number(process.env.SLATE_VALUE || 0);

const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const cfg = JSON.parse(fs.readFileSync('config/limit.json', 'utf8'));
const effectiveAt = new Date(Date.now() + COOLDOWN_HOURS * 3600000).toISOString();

if (action === 'set-limit') {
  const want = Math.min(HARD_CEILING, Math.max(0, Math.round(value)));
  if (want <= (cfg.limit_seconds ?? HARD_CEILING)) {
    cfg.limit_seconds = want;
    cfg.pending = null;
    console.log(`tightening to ${want}s - applied immediately`);
  } else {
    cfg.pending = { limit_seconds: want, effective_at: effectiveAt };
    console.log(`loosening to ${want}s - lands ${effectiveAt}`);
  }
} else if (action === 'unlock') {
  state.unlock = { state: 'pending', requested_at: new Date().toISOString(), effective_at: effectiveAt };
  console.log(`unlock requested - lands ${effectiveAt}`);
} else if (action === 'cancel-unlock') {
  state.unlock = { state: 'locked', requested_at: null, effective_at: null };
  console.log('unlock cancelled - applied immediately');
} else if (action === 'relock') {
  state.unlock = { state: 'locked', requested_at: null, effective_at: null };
  cfg.pending = null;
  console.log('relocked - applied immediately');
} else {
  throw new Error(`unknown action: ${action}`);
}

state.limit_seconds = Math.min(HARD_CEILING, Number(cfg.limit_seconds) || HARD_CEILING);
state.updated_at = new Date().toISOString();
fs.writeFileSync('state.json', JSON.stringify(state, null, 2) + '\n');
fs.writeFileSync('config/limit.json', JSON.stringify(cfg, null, 2) + '\n');
