const { execFile } = require('node:child_process');
const path = require('node:path');

// Resolves the Python interpreter for the procedural puzzle engine CLI.
// Preference order:
//   1. puzzles/.venv/bin/python   (created by scripts/setup_puzzle_engine.sh)
//   2. PUZZLE_PYTHON env var      (explicit override)
//   3. 'python' on PATH           (system fallback)
const PROJECT_ROOT = path.resolve(__dirname, '..');
const VENV_PYTHON = path.join(PROJECT_ROOT, 'puzzles', '.venv', 'bin', 'python');

let cached;
function resolvePuzzlePython() {
  if (cached) return cached;
  if (require('node:fs').existsSync(VENV_PYTHON)) {
    cached = VENV_PYTHON;
  } else if (process.env.PUZZLE_PYTHON) {
    cached = process.env.PUZZLE_PYTHON;
  } else {
    cached = 'python';
  }
  return cached;
}

function runPuzzleCli(cmd, args = [], cwd = PROJECT_ROOT) {
  return new Promise((resolve, reject) => {
    const pythonBin = resolvePuzzlePython();
    execFile(pythonBin, [path.join(PROJECT_ROOT, 'puzzles', 'cli.py'), cmd, ...args], { cwd }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return reject(new Error(`CLI error (${error.code}): ${stderr || error.message}`));
      }
      try {
        resolve(JSON.parse(stdout || stderr || '{}'));
      } catch (e) {
        reject(new Error(`Failed to parse CLI output: ${stdout}\n${stderr}`));
      }
    });
  });
}

module.exports = { resolvePuzzlePython, runPuzzleCli };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  runPuzzleCli(cmd, args)
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
