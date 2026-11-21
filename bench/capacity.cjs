'use strict';
/**
 * Замер скорости скана. Запуск: `pnpm build && node bench/capacity.cjs [корень проекта …]`.
 *
 *  1. `scanText` на синтетике: обычный код, конфиг, и худшие для регулярных
 *     выражений строки — минифицированная строка в мегабайт, длинный base64,
 *     повтор `key=` без значения (проверка на катастрофический откат);
 *  2. с аргументами — весь гейт на настоящих проектах (рабочее дерево, только
 *     чтение), как в CI.
 */
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const { scanText } = require('../dist/scanner/scan-text.js');

const placeholders = new Set();

function rate(label, shown, text) {
  const started = performance.now();
  const findings = scanText(shown, text, placeholders);
  const seconds = (performance.now() - started) / 1000;
  const megabytes = Buffer.byteLength(text) / 1024 / 1024;
  console.log(
    `${label}: ${megabytes.toFixed(1)} МБ за ${seconds.toFixed(2)} с (${(megabytes / seconds).toFixed(1)} МБ/с), находок ${findings.length}`,
  );
}

function synthetic() {
  console.log('## scanText');
  const code = Array.from(
    { length: 200_000 },
    (_, i) => `  const value${i} = await this.repository.findOne({ where: { id: input.id${i} } });\n`,
  ).join('');
  rate('код TS', 'src/service.ts', code);
  const config = Array.from({ length: 200_000 }, (_, i) => `SERVICE_${i}_URL=http://service-${i}:8080/path\n`).join('');
  rate('конфиг .env.example', 'deploy/.env.example', config);
  rate('минифицированная строка 1 МБ', 'dist/app.min.js', `${'a.b=function(c){return c+1};'.repeat(36_000)}\n`);
  rate('base64 в одной строке 2 МБ', 'src/fixture.ts', `const blob = '${'QUJDREVGR0g'.repeat(190_000)}';\n`);
  rate('повтор «key=» без значения, 1 МБ', 'config.yml', `${'key='.repeat(260_000)}\n`);
  rate('повтор «password: » в строке, 1 МБ', 'config.yml', `${'password: '.repeat(100_000)}\n`);
}

function gate(root) {
  const bin = join(__dirname, '..', 'bin', 'committed-secrets.cjs');
  const started = performance.now();
  let code = 0;
  try {
    execFileSync(process.execPath, [bin], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    code = error.status;
  }
  const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean).length;
  console.log(`${root}: файлов git ${files}, гейт ${((performance.now() - started) / 1000).toFixed(2)} с, код ${code}`);
}

synthetic();
for (const root of process.argv.slice(2)) {
  gate(root);
}
