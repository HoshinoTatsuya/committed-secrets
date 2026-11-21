#!/usr/bin/env node
'use strict';
/**
 * Запуск гейта секретов. Каталог запуска — корень проекта (там
 * `committed-secrets.json`). Код выхода: 0 — чисто, 1 — находки, 2 — гейт не
 * смог проверить.
 */
require('../dist/scanner/cli.js');
