// Runs the real accounting scripts against a scratch copy of the repo.
//
// Everything the server is trusted to do lives here: idempotent reports, the
// day check, the ceiling, and the 48-hour cooldown only ever delaying a change
// that loosens the rules.
//
//   node test/accounting.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-test-'));

for (const entry of ['state.json', 'config', 'scripts']) {
  fs.cpSync(path.join(repo, entry), path.join(work, entry), { recursive: true });
}

const { dayKey } = await import(
  'file://' + path.join(work, 'scripts', 'day.mjs').replace(/\\/g, '/')
);
const today = dayKey();

let fails = 0;
const check = (ok, name, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

const state = () => JSON.parse(fs.readFileSync(path.join(work, 'state.json'), 'utf8'));
const limits = () => JSON.parse(fs.readFileSync(path.join(work, 'config', 'limit.json'), 'utf8'));

function run(script, env) {
  try {
    execFileSync(process.execPath, [path.join('scripts', script)], {
      cwd: work,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) };
  }
}

const reportAs = (device, seconds, day = today) =>
  run('accrue.mjs', { SLATE_DEVICE: device, SLATE_DAY: day, SLATE_SECONDS: String(seconds) });

const request = (action, value = '2700') =>
  run('request.mjs', { SLATE_ACTION: action, SLATE_VALUE: value });

/* ---------------------------------------------------------------- reporting */

reportAs('phone', 600);
reportAs('pc-chromium', 300);
check(state().used_seconds === 900, 'two devices sum into one budget',
  `${state().used_seconds}s`);

reportAs('phone', 400);
check(state().devices.phone === 600, 'a replayed older total never lowers the count',
  `phone=${state().devices.phone}s`);

reportAs('phone', 600);
check(state().used_seconds === 900, 'a duplicate report is idempotent',
  `${state().used_seconds}s`);

check(!reportAs('phone', 1200, '1999-01-01').ok === false, 'a wrong-day report is accepted but ignored');
check(state().used_seconds === 900, 'a wrong-day report does not move the counter',
  `${state().used_seconds}s`);

check(!reportAs('phone', 999999).ok, 'an impossible number of seconds is rejected outright');
check(!reportAs('../../etc', 60).ok, 'a device id that is not a plain name is rejected');

/* ------------------------------------------------------------- the ceiling */

{
  const cfg = limits();
  cfg.limit_seconds = 14400; // four hours, by hand
  fs.writeFileSync(path.join(work, 'config', 'limit.json'), JSON.stringify(cfg, null, 2));
  reportAs('pc-chromium', 360);
  check(state().limit_seconds === 2700,
    'a hand-edited four-hour limit is clamped on the next report',
    `${state().limit_seconds}s`);

  run('rollover.mjs', {});
  check(limits().limit_seconds === 2700,
    'rollover writes the clamp back into the config file too',
    `${limits().limit_seconds}s`);
}

/* -------------------------------------------------------------- the cooldown */

request('set-limit', '1200');
check(limits().limit_seconds === 1200 && limits().pending === null,
  'tightening the limit applies immediately', `${limits().limit_seconds}s`);

request('set-limit', '2700');
check(limits().limit_seconds === 1200 && limits().pending?.limit_seconds === 2700,
  'loosening the limit is parked, not applied', `still ${limits().limit_seconds}s`);

run('rollover.mjs', {});
check(limits().limit_seconds === 1200,
  'rollover before the cooldown expires changes nothing', `${limits().limit_seconds}s`);

{
  const cfg = limits();
  const parked = Date.parse(cfg.pending.effective_at);
  const hours = (parked - Date.now()) / 3600000;
  check(hours > 47 && hours < 49, 'the cooldown is 48 hours', `${hours.toFixed(1)}h`);

  cfg.pending.effective_at = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(work, 'config', 'limit.json'), JSON.stringify(cfg, null, 2));
}

run('rollover.mjs', {});
check(limits().limit_seconds === 2700 && limits().pending === null,
  'once the cooldown expires the change lands', `${limits().limit_seconds}s`);

request('set-limit', '99999');
check((limits().pending?.limit_seconds ?? limits().limit_seconds) <= 2700,
  'even a parked change cannot exceed the ceiling');

/* --------------------------------------------------------------- the unlock */

request('relock');
request('unlock');
check(state().unlock.state === 'pending', 'an unlock starts out pending');
{
  const hours = (Date.parse(state().unlock.effective_at) - Date.now()) / 3600000;
  check(hours > 47 && hours < 49, 'the unlock waits 48 hours too', `${hours.toFixed(1)}h`);
}

request('cancel-unlock');
check(state().unlock.state === 'locked', 'cancelling an unlock is immediate');

/* ------------------------------------------------------------- the rollover */

{
  const s = state();
  s.day = '1999-01-01';
  s.used_seconds = 2700;
  s.devices = { phone: 2700 };
  fs.writeFileSync(path.join(work, 'state.json'), JSON.stringify(s, null, 2));
  run('rollover.mjs', {});
  check(state().day === today && state().used_seconds === 0,
    'a new day starts empty', `day=${state().day} used=${state().used_seconds}s`);
}

fs.rmSync(work, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
