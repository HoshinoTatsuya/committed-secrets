# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the package uses
[Semantic Versioning](https://semver.org/) with the pre-1.0 rule that a breaking change or a change of
verdicts bumps the minor.

## [0.6.3] — 2026-11-21

First public release as `@hoshinotatsuya/committed-secrets`, MIT; documentation in English and Russian;
no functional changes to scanning.

### Changed

- The GitLab Secret Detection report names the vendor `@hoshinotatsuya` (was the previous scope).
- Code-shaped false-positive fixtures moved to `fixtures/code-forms/` as synthetic lines of the same form
  (the spec gives the same pass/fail result per test on the 0.5.1 scanner as the previous fixtures did).
- The README quick start (`examples/committed-secrets.json`, `examples/committed-secret-fixtures.json`) is
  run by a spec against the built CLI in a throwaway git repository.
- CI runs on GitHub Actions; dev dependencies: arch-gates 0.12.2, jest-groups 0.7.2.

## [0.6.2] — 2026-11-21

### Fixed

- The "could not check" branch built its reason with `String()`: a thrown value without a prototype or with
  a throwing `toString` / `Symbol.toPrimitive` turned a clear exit code 2 into a `TypeError`. Now it is exit
  code 2 with the reason (`message` if it is a string, otherwise the object tag).

## [0.6.1] — 2026-11-18

### Fixed

- A file name under a secret-named key is not a finding: a CI report key
  (`secret_detection: gl-secret-detection-report.json`), a key file path without `./`
  (`client_secret: keys/client-secret.json`, `private_key: tls/server.key`), a file name in `.env` and in
  code. The form is narrow: lowercase words separated by `-`, `_` or `.`, and an extension from a fixed list
  of data, report and key-file formats. A literal with an appended extension in mixed case is still a finding.

## [0.6.0] — 2026-11-17

Fixes from an external audit; verdicts change.

### Changed

- Run from a monorepo subdirectory, `--staged` scanned zero changed files (paths from the repository root
  never matched the index paths from the working directory) and `--history` scanned the whole monorepo.
  Both now use `--relative`: the working directory and paths relative to it.
- `--write-baseline` together with `--history`/`--since` is a refusal (exit code 2).
- A `name`/`value` pair with a non-secret name (`- name: IMAGE_TAG` / `value: a1b2c3d4…`) is no longer a
  finding.
- A Markdown code block with a programming language (`ts`, `python`, `go`, `java`, …) is judged as code.

### Added (found now, missed before)

- YAML list commands in quotes; Kubernetes env with `value:` above `name:`, comments after `name:`,
  `value: |`; `#` inside an unquoted value; escaped quotes inside literals; a literal on the line after its
  key; `Authorization` of any scheme and raw tokens; argument arrays with brackets inside strings; keys to the
  right of the first assignment; `.npmrc` `_auth` decoded from base64.

### Fixed

- A literal of a neighbouring property is not attributed to the key; `${…}` inside a default literal is
  not a literal.
- `EPIPE` on an interrupted blob read was an `uncaughtException` (exit code 1, "secrets found").
- UTF-16 BE with a BOM and an odd length is decoded without the last byte instead of a `RangeError`.

### Migration

Fixture-list entries that covered `name`/`value` pairs with non-secret names become stale (refusal
"entry is stale") — remove them.

## [0.5.2] — 2026-11-16

### Fixed

False positives of 0.5.1 on lines with the full surrounding code structure (comment blocks, code blocks
inside JSDoc, quotes): a URL password cut with an ellipsis in a comment; a description in words with the
secret word in plural; a quoted SQL column on the right of a qualified key; a hash in a JSDoc `@example`
section several lines after the tag (the section is closed by another tag, the end of the comment or a line
that is not a comment); a single-word environment variable name (`PGPASSWORD: 'PGPASSWORD'`). Each form has
pairs where a real secret in the same position is still a finding.

### Migration

Fixture-list or baseline entries that covered one of these false positives become entries without a
finding: remove fixture entries (stale entries are a refusal), rewrite the baseline with `--write-baseline`.

## [0.5.1] — 2026-11-16

### Fixed

False positives found in real use (no secret values in them): BuildKit `--secret id=…[,env=…|,src=…]`;
compose volumes `path:path[:mode]`; an escaped variable reference in a command for another shell
(`\"\$PW\"`); an identifier value with a version suffix; an SQL column compared with a column; a URL with
placeholders in a comment example; a 32/40/64-hex hash in an `@example` comment; the AWS documentation
example keys. Each form has a pair "the same position with a real secret is a finding".

## [0.5.0] — 2026-11-15

### Changed (breaking)

- A fixture-list entry exempts SPECIFIC findings: `count` findings of each key (default one), not every
  finding of the key in the file. Migration: add `"count": N` to entries that cover several fixtures.
- The configuration is type-checked: `minFiles` is an integer ≥ 0, string fields are non-empty, an unknown
  key is a refusal (exit code 2). Migration: remove extra keys (`$schema`, `$comment` are allowed), write
  `minFiles` as a number.
- An unknown argument is a refusal (exit code 2), not a path.
- `--staged` reads the configuration, fixture list and baseline from the index and checks only what changed
  relative to HEAD (`--staged --full` for the whole index).
- New forms find what used to be missed: a repository green on 0.4.0 can turn red.

### Added

- Command-line flags and assignments, the exec form, YAML lists; `curl -u`, `curl -H "Authorization: …"`,
  `sshpass -p`, `mysql -pPASS`, `docker login -p`, `… set token …`; `requirepass` and ACL passwords,
  `.netrc`, `.pgpass`, shell profiles; base64 credentials (`auth`, kubeconfig `*-data`, `Basic`); JWT,
  GitLab, OpenAI, Anthropic, Yandex Cloud and age tokens; literal defaults; `=>`, XML, `name`/`value` pairs;
  YAML `|` blocks, `!!str`, `~~~`, UTF-16, `prod.env.example`; more key words.
- Not a finding: SOPS `ENC[…]`, SealedSecret `encryptedData`, age ciphertext, Maven `{…}`,
  `--password-stdin`, `--no-password`, `docker run -p 8080:80`, `mysql -p db`, configparser `%(…)s`,
  CloudFormation `!Ref`.
- `--history`, `--since <commit>`; the baseline (`baselinePath`, `--write-baseline`); `--format
  json|sarif|gitlab`, `--output`; `testCodePatterns`; the `ENOBUFS` reason.
- `--staged` on 500 MB: 0.22 s instead of 20.9 s, 69 MB instead of 1147 MB.

## [0.4.0] — 2026-11-15

### Changed

- The `exports` map closes `dist/*`: the package is a CLI only. Running through `bin` is unchanged.

## [0.3.0] — 2026-11-15

### Changed

- The scanner runs on Node; python3 is no longer needed. Ported one to one and compared on the same
  corpus before the old implementation was removed (stdout, stderr and exit codes matched byte for byte).
- `auth` and `authorization` as words are no longer secrets; authorization headers are judged by the
  value form.

### Added

- Type annotations between key and value (`const apiKey: string = '…'`), tokens by known prefix under any
  key and in URLs, `Authorization` with a scheme, PGP private keys. One literal — one finding.

## [0.2.0] — 2026-11-14

### Changed

- `--staged` checks the INDEX, not the working tree.
- Exit code 2 "could not check", separate from a finding (1).
- `local-dev-only` is no longer a built-in placeholder; new configuration key `extraPlaceholders`.

## [0.1.1] — 2026-11-10

### Fixed

- A description of a secret in camelCase (`secretAccessKey`, `isStrongPassword`) is not a finding, like
  kebab-case; the words of the value must name a secret.

## [0.1.0] — 2026-11-10

First release: literal secrets in committed files, project configuration in `committed-secrets.json`.

[0.6.3]: https://github.com/HoshinoTatsuya/committed-secrets/releases/tag/v0.6.3
