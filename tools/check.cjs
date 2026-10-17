// One command graph for npm, direct invocation and Python release validation.
// Invoke Node tools directly so checks do not depend on shell/npm PATH quirks.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

if (process.argv.includes('--browser')) {
    run(['--test', 'tests/browser.test.js']);
} else {
    if (!process.argv.includes('--test')) {
        run(['node_modules/eslint/bin/eslint.js', '.', '--max-warnings', '0']);
        run(['node_modules/typescript/bin/tsc', '-p', 'jsconfig.json']);
    }
    const contracts = fs.readdirSync(path.join(root, 'tests'))
        .filter((name) => name.endsWith('.test.js') && name !== 'browser.test.js')
        .sort().map((name) => `tests/${name}`);
    run(['--test', ...contracts]);
    for (const file of ['tests/test_matching.js', 'tests/test_adapters.js', 'tests/test_coverage.js', 'tools/benchmark.cjs', 'tools/mutation-check.cjs']) run([file]);
    run(['tools/benchmark.cjs', '--holdout']);
}
