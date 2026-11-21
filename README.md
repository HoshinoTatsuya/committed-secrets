# @hoshinotatsuya/committed-secrets

[![npm](https://img.shields.io/npm/v/@hoshinotatsuya/committed-secrets.svg)](https://www.npmjs.com/package/@hoshinotatsuya/committed-secrets)
[![CI](https://github.com/HoshinoTatsuya/committed-secrets/actions/workflows/ci.yml/badge.svg)](https://github.com/HoshinoTatsuya/committed-secrets/actions/workflows/ci.yml)

[Русская версия](README.ru.md) · [Changelog](CHANGELOG.md)

A gate that keeps **literal secrets out of committed files**. A value that reached git is in every clone
and every CI checkout, and editing the file does not clean the history — the secret is compromised from
the moment of the commit. Run it in CI over the whole tree, in the commit hook over what is about to be
committed, and once over the history.

A simplified check that sees one form — a quoted value right after a key — missed 12 of 15 real lines.
This one sees:

- `KEY=value` / `KEY: value` without quotes in configuration files (`.env` and its variants, YAML,
  compose, Dockerfile, shell, `.npmrc`, shell profiles, `.netrc`, `.pgpass`, `.my.cnf`, Markdown code
  blocks ``` and ~~~);
- quoted values in code and JSON, `=>` (PHP, Ruby), XML elements and `name`/`value` pairs in XML and JSON;
- keys of any shape (`dbPassword`, `apiKey`, `secret_token`, `JWT_SECRET`, `REDIS_PASSWORD_PREVIOUS`),
  glued (`PGPASSWORD`, `accesstoken`), abbreviated (`DB_PWD`), encryption and signing keys
  (`ENCRYPTION_KEY`, `SIGNING_KEY`), `AUTH` as the last word of an environment variable name
  (`REDISCLI_AUTH`, `BASIC_AUTH`), `.npmrc` `_auth`;
- command lines: password flags (`--requirepass`, `--password=…`, `redis-cli -a`, `sshpass -p`,
  `curl -u user:pass`, `curl -H "Authorization: Bearer …"`, `mysql -pPASS`, `docker login -p`,
  `openssl … pass:…`, `ldapsearch -w`), `KEY=…` assignments in any position (`PGPASSWORD='…' psql`,
  `docker run -e`, `--from-literal=password=…`), `… set token …`; the exec form
  (`["redis-server", "--requirepass", "…"]`), YAML lists line by line, a command inside a code string or
  inline Markdown code;
- base64: Docker `config.json` `auth`, kubeconfig `*-data`, the `Basic` scheme — decoded and judged by
  content (a PEM private key or `user:password`); base64 PEM (`LS0tLS1CRUdJTi…`) anywhere;
- literal defaults: `${VAR:-literal}` and in code `process.env.X ?? 'literal'`, `|| 'literal'`,
  `config.get('DB_PASSWORD', 'literal')`, `os.getenv("KEY", "literal")`, `.default('literal')`,
  `Buffer.from('literal', 'hex')`;
- tokens by shape under any key: GitHub, GitLab (`glpat-`, `glrt-`, `gldt-`, …), Slack, AWS, Google,
  Stripe `sk_live_`, npm, OpenAI, Anthropic, JWT, Yandex Cloud (`y0_`, `t1.`, `AQVN`), age keys;
- passwords in URLs, PEM and PGP private keys, a YAML `key: |` block on one line, the `!!str` tag;
- UTF-16 files (with and without a BOM) are text, not binary.

**Not a finding**: placeholders (an exact match with the list, not a prefix), substitutions and
**encrypted storage** — SOPS `ENC[AES256_GCM,…]`, SealedSecret `encryptedData`, age ciphertext, Maven
`{…}`. A project that stores secrets properly turns the gate on without exceptions.

The list of files comes from git (a host `.env` is not in git, and secrets there are legitimate).
**The value is never printed** — not in text, JSON, SARIF or the GitLab report, neither raw nor base64 nor
decoded: a report carries the key, the length and a fingerprint.

## Install

```sh
pnpm add -D @hoshinotatsuya/committed-secrets
```

Node.js **24 or newer** and `git` on `PATH`. No runtime dependencies. The package is a CLI only (no
programmatic entry point: the `exports` map closes `dist/*`).

## Quick start

**1.** Put `committed-secrets.json` into the project root. There are no defaults: without the file the gate
refuses (defaults would judge someone else's repository by someone else's threshold).

```json
{
  "minFiles": 50,
  "requiredKinds": [".ts", ".json", ".yml", ".md"],
  "fixturesPath": "committed-secret-fixtures.json",
  "deliveryPattern": "^(deploy/|docker-compose[^/]*\\.ya?ml$|(?:[^/]*/)*Dockerfile[^/]*$|\\.github/workflows/|\\.env\\.example$)",
  "serviceCodeRoot": "src/"
}
```

**2.** List legitimate test secrets (throwaway container passwords) in the fixture list named by
`fixturesPath` — or `[]`:

```json
[
  {
    "file": "src/testing/postgres.harness.ts",
    "keys": ["POSTGRES_PASSWORD"],
    "reason": "one-off password of the throwaway test container on 127.0.0.1"
  }
]
```

**3.** Run it:

```sh
pnpm exec committed-secrets            # CI: every file git tracks in the working tree
pnpm exec committed-secrets --staged   # commit hook: what is about to be committed
```

Exit code `0` — no secrets; `1` — findings or fixture-list violations; `2` — the gate could not check
(no configuration or git, a bad argument or field, broken JSON, a degenerate sample, git output too large).
"Could not check" is distinct from both success and a finding.

Both JSON files above are [`examples/`](examples) and are quoted verbatim; a spec of this package runs
the built CLI with exactly these files in a throwaway git repository: the listed fixture passes with exit
code 0, a new `apiKey` literal in `src/` gives exit code 1 in both modes, and the value does not appear in
the output.

## Configuration

Every field is type-checked: `minFiles` is an integer ≥ 0 (`"1,500"` is a refusal — it used to silently
turn the threshold off), an unknown key is a refusal (a typo never silently does nothing; `$schema` and
`$comment` are allowed), `deliveryPattern` must be a regular expression.

| key | required | meaning |
|---|---|---|
| `minFiles` | yes | lower bound of the number of scanned files: "no findings" on a degenerate sample proves nothing |
| `requiredKinds` | yes | file kinds that must be present in the sample (a missing one means the sample degenerated) |
| `fixturesPath` | yes | the fixture list (below) |
| `deliveryPattern` | yes | regular expression of delivery files (deploy manifests, compose, Dockerfiles, CI): a secret there is a production secret, the fixture list never exempts it |
| `serviceCodeRoot` | yes | root of the service code: the fixture list exempts code there only if it matches `testCodePatterns` |
| `extraPlaceholders` | no | project placeholders, exact case-insensitive match (e.g. a local dev default `${POSTGRES_PASSWORD:-local-dev-only}`) |
| `testCodePatterns` | no | regular expressions of test code under `serviceCodeRoot`; default `["spec\\.ts$", "/testing/"]` |
| `baselinePath` | no | baseline file (below) |

## Modes

| command | what is checked | where |
|---|---|---|
| `committed-secrets` | files git tracks, in the working tree | CI |
| `committed-secrets --staged` | what changed in the INDEX relative to HEAD — what goes into the commit | commit hook |
| `committed-secrets --staged --full` | the whole index | hook that wants a full scan |
| `committed-secrets --history` / `--since <commit>` | history blobs (all refs / after a commit up to HEAD), with the commit in the report | initial audit |
| `committed-secrets <paths…>` | only these files, without the fixture list and the threshold | one-off |
| `committed-secrets --write-baseline` | writes the current findings into `baselinePath` | adopting the gate |

`--format text|json|sarif|gitlab` (default `text`), `--output <file>` — the machine-readable document to a
file (without it — to stdout, and the summary goes to stderr). SARIF 2.1.0 and the GitLab Secret Detection
report format are supported.

`--staged` judges the index **by the rules in the index**: configuration, fixture list and baseline are
read from the index, not from disk — a fixture entry added on disk but not staged does not exempt the
commit. Only changed blobs are read (streamed through `git cat-file --batch`); unchanged files passed the
gate when they were committed, and CI does the full scan. A change to the gate's own files (configuration,
list, baseline) in the index switches to a full index scan. Run from a monorepo subdirectory, `--staged`
and `--history` cover that directory with paths relative to it, like `git ls-files`.

Text messages are in Russian; exit codes, the JSON/SARIF/GitLab structure and finding keys are stable.

## Fixture list

`fixturesPath` is `[{ file, keys, reason, count? }]`: one-off passwords of test containers and the like.
An entry exempts `count` findings of EACH key in the file (default one): a second secret under the same key
is a finding again. A delivery file (`deliveryPattern`) and service code outside `testCodePatterns` are
never exempted; an entry that matches fewer findings than it exempts is a refusal (remove stale entries).
Finding keys: the key name, `адрес` (a password in a URL), `PEM`, `PGP`, `токен <kind>`, a command flag
(`redis-cli -a`, `--requirepass`).

## Baseline

To adopt the gate in a repository with history without fixing everything at once: set `baselinePath` and
run `committed-secrets --write-baseline`. Current findings are written as fingerprints (file, key,
fingerprint of the value; no values in the file). From then on the gate fails only on NEW findings; a moved
line does not refresh a finding, a new value under the same key is a new finding. A baseline entry without
a finding is not a refusal; the summary mentions it.

The fingerprint is scrypt (N=1024) of the value salted with "file + key": it ends up in CI reports, and a
fast hash would let a weak password be brute-forced in seconds; scrypt costs about a millisecond per
attempt. It does not protect a truly weak password — a value that reached git must be rotated anyway.

## CI and hooks

GitHub Actions (SARIF into code scanning):

```yaml
secrets:
  runs-on: ubuntu-latest
  permissions: { contents: read, security-events: write }
  steps:
    - uses: actions/checkout@v5
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v5
      with: { node-version: 24, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm exec committed-secrets --format sarif --output committed-secrets.sarif
    - if: always()
      uses: github/codeql-action/upload-sarif@v3
      with: { sarif_file: committed-secrets.sarif }
```

GitLab merge requests: `--format gitlab --output gl-secret-detection-report.json` and the report under
`artifacts.reports.secret_detection`. A commit hook (husky, lefthook, a plain `.git/hooks/pre-commit`):
`pnpm exec committed-secrets --staged`.

## Guarantees and limits

- **A descriptive value counts as a placeholder**: `super-secret-jwt-token` in a secret field — the words of
  the value name a secret, and that is not a finding. A real secret in such a form is missed; the price of
  the opposite is noise on field names and enum members.
- `--staged` over changed files does not see a secret committed around the hook: CI (working tree) or
  `--history` finds it.
- No online validity check of tokens, and there will be none: that would send the secret out.
- `.http`/`.rest` files (request headers as lines) are not recognised as a file kind; `Authorization: …`
  in them is not judged.
- A literal default split across lines (`=` ⏎ `env.X ?? '…'`) is not seen.
- A random lowercase-and-digits literal with an extension from the data-file list (`x7k2m9q4.json`) is
  read as a file name.

**Capacity** (`bench/capacity.cjs`, `pnpm build && node bench/capacity.cjs [root …]`, Node 24 on a laptop, measured on 0.5.0):

| input | throughput |
|---|---|
| TypeScript code, 16.6 MB | 54 MB/s |
| `.env.example`, 9.5 MB | 17 MB/s |
| a minified 1 MB line | 110 MB/s |
| base64 on one 2 MB line | 141 MB/s |
| `key=` × 260k on one line | 40 MB/s |
| `password: ` × 100k on one line | 24 MB/s (one finding: a line literal is named once) |

The whole gate on a synthetic monorepo (16k files, 500 MB of text, one changed file in the index):
`--staged` 0.22 s and 69 MB peak memory; the working tree 22.2 s and 200 MB. Files are read one at a time,
so memory is one file, not the repository; no catastrophic regex backtracking on long lines (worst inputs
are linear).

## Failure behaviour

Fail-closed: a missing or invalid configuration, missing git, broken JSON of the configuration or fixture
list, a sample below `minFiles` or without a required kind, a path that does not exist, git output beyond
the buffer (reported as `ENOBUFS`, not "no git") — exit code 2 with a one-line reason. An interrupted blob
read (`EPIPE`) is handled, not an uncaught exception that would look like "secrets found". A stale fixture
entry is a refusal, so exemptions do not outlive what they exempted.

## Compatibility

- Node.js ≥ 24 and git on `PATH` (it runs `ls-files`, `cat-file --batch`, `diff --cached --relative`, `log`); checked with git 2.50 locally and the git of the CI runner, no lower bound is established.
- Any repository layout, including a monorepo subdirectory; Windows is not verified (no Windows runner in CI).

## Testing and development

```sh
pnpm install
pnpm run typecheck
pnpm run lint             # biome
pnpm test                 # build, then Jest in sequential groups of at most 300 tests, 2 workers
pnpm run build
```

The suite needs only git (specs create throwaway repositories and run the built CLI). Every form in the
corpus has a pair "finds exactly one, with its key / the same form without a secret is silent"
(`corpus.spec.ts`, `forms.spec.ts`), token shapes are tested at full length and one character shorter, and
every output format is checked not to contain the value — raw, base64, hex or decoded. Code-shaped false
positives (`fixtures/code-forms/`) are synthetic lines of the same form as those met in real use, kept with
the surrounding comment and JSDoc structure that affects parsing.

## License

[MIT](LICENSE) © 2026 Hoshino Tatsuya
