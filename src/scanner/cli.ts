#!/usr/bin/env node
import { runGate } from './run-gate';

// Каталог запуска — корень проекта (там committed-secrets.json).
void runGate(process.argv.slice(2), process.cwd(), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
}).then((code) => {
  process.exitCode = code;
});
