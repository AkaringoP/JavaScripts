// Runs every scenario file against the script and prints one line per file.
//   node run_all.js [variant]      default: current (../XSearchAndUpload.user.js)
// Needs Playwright with Chromium (npm i -g playwright && npx playwright install chromium, or
// set NODE_PATH to a node_modules that has it). Takes about 15 minutes: several scenarios wait
// in real time (60 s queue pauses, retry back-off, re-check ladders). Output goes to out/.
// GAP lines (run_desktop.js KNOWN_GAPS: behaviour a later task adds) are counted and listed, not
// failed.
const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');

const variant = process.argv[2] || 'current';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, {recursive: true});

// Three lanes run side by side; files within a lane run one after another.
const LANES = [
  ['run_core.js', 'run_core_extra.js', 'run_fixes.js', 'run_matching.js', 'run_markers.js', 'run_desktop.js'],
  ['run_upload.js', 'run_scroll.js', 'run_bar.js', 'run_viewer.js'],
  ['run_lookup.js'],
];

function runFile(file) {
  return new Promise((resolve) => {
    const v = file === 'run_viewer.js' ? variant + '_probe' : variant;
    const log = path.join(OUT, file.replace(/\.js$/, '') + '.txt');
    const child = spawn(process.execPath, [path.join(__dirname, file), v]);
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.stderr.on('data', (d) => (text += d));
    child.on('close', (code) => {
      fs.writeFileSync(log, text);
      const pass = (text.match(/^PASS/gm) || []).length;
      const failed = (text.match(/^FAIL.*$/gm) || []);
      const gaps = (text.match(/^GAP.*$/gm) || []);
      const broken = code !== 0 || /HARNESS-ERROR|pageerror/i.test(text);
      console.log(`${failed.length || broken ? 'FAIL' : 'ok  '} ${file}: ${pass} passed, `
          + `${failed.length} failed${gaps.length ? `, ${gaps.length} known gaps` : ''}${broken ? ', harness error' : ''}`
          + `  (${path.relative(process.cwd(), log)})`);
      failed.forEach((line) => console.log('     ' + line));
      gaps.forEach((line) => console.log('     ' + line));
      resolve({pass, fail: failed.length, gap: gaps.length, broken});
    });
  });
}

(async () => {
  const results = (await Promise.all(LANES.map(async (lane) => {
    const out = [];
    for (const file of lane) {
      out.push(await runFile(file));
    }
    return out;
  }))).flat();
  const pass = results.reduce((n, r) => n + r.pass, 0);
  const fail = results.reduce((n, r) => n + r.fail, 0);
  const gap = results.reduce((n, r) => n + r.gap, 0);
  const broken = results.some((r) => r.broken);
  console.log(`\n${pass} passed, ${fail} failed, ${gap} known gaps${broken ? ', harness errors' : ''}`);
  process.exit(fail || broken ? 1 : 0);
})();
