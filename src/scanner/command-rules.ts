import { AUTH_HEADER_VALUE } from './auth-header-value.constant';
import { Base64Credentials } from './base64-credentials';
import { isCredential } from './credential-value';
import type { FlagRule } from './flag-rule.type';
import type { LineSink } from './line-sink';
import { isSecretKey, namesSecret, wordsOf } from './secret-key';
import { SECRET_PAIRS } from './secret-rules';
import { isLiteralSecret, literalParts } from './secret-value';
import type { ShellToken } from './shell-token.type';

/**
 * Секрет в командной строке. Короткий флаг значит пароль только у своей
 * команды (`-p` у `sshpass` — пароль, у `docker run` — порты), поэтому
 * короткие флаги привязаны к команде; длинный флаг, последнее слово которого
 * называет секрет (`--requirepass`, `--api-key`), — у любой команды.
 */
export class CommandRules {
  private static readonly PASSWORD: FlagRule = { mode: 'password', separate: true, glued: false };

  private static readonly PASSWORD_GLUED: FlagRule = { mode: 'password', separate: true, glued: true };

  private static readonly USERPASS: FlagRule = {
    mode: 'userpass',
    separate: true,
    glued: true,
    separator: ':',
  };

  private static readonly HEADER: FlagRule = { mode: 'header', separate: true, glued: false };

  private static readonly OPENSSL: FlagRule = { mode: 'opensslpass', separate: true, glued: false };

  private static readonly SECRET: FlagRule = { mode: 'secret', separate: true, glued: false };

  /**
   * Спека секрета BuildKit (`docker build --secret id=npm_token,env=NPM_TOKEN`,
   * `src=.npmrc`): ссылка на секрет по имени переменной или файла, а не его
   * значение. Ключи — закрытый набор и `id` обязателен: чужой ключ
   * (`id=x,password=…`) спекой не считается.
   */
  private static readonly BUILD_SECRET_SPEC =
    /^(?=(?:[^,]*,)*id=[^,]+(?:,|$))(?:id|env|src|source|type|required)=[^,=\s]*(?:,(?:id|env|src|source|type|required)=[^,=\s]*)*$/u;

  /**
   * Экранированная ссылка на переменную (`\$PW`, `\${PW}`, `\"\$PW\"`) в
   * команде для другой оболочки (`ssh host redis-cli -a \"\$PW\"`): в этой
   * оболочке слово литерально, но его значение — имя переменной, а не пароль.
   * Экранированные кавычки вокруг (`\"\$PW\"`) — часть слова и для удалённой
   * оболочки двойные: ссылка та же.
   */
  private static readonly VARIABLE_REFERENCE =
    /^("?)\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})\1$/u;

  /** `mysql -p` отдельно — запрос пароля, а следующее слово — имя базы: только слитно. */
  private static readonly MYSQL: Readonly<Record<string, FlagRule>> = {
    '-p': { mode: 'password', separate: false, glued: true },
  };

  private static readonly MONGO: Readonly<Record<string, FlagRule>> = {
    '-p': CommandRules.PASSWORD,
  };

  private static readonly LDAP: Readonly<Record<string, FlagRule>> = { '-w': CommandRules.PASSWORD_GLUED };

  /** Флаги по командам. Имя команды — последний сегмент пути слова (`/usr/bin/curl`). */
  public static readonly COMMANDS: Readonly<Record<string, Readonly<Record<string, FlagRule>>>> = {
    'redis-cli': { '-a': CommandRules.PASSWORD, '--pass': CommandRules.PASSWORD },
    sshpass: { '-p': CommandRules.PASSWORD_GLUED },
    curl: {
      '-u': CommandRules.USERPASS,
      '--user': CommandRules.USERPASS,
      '-U': CommandRules.USERPASS,
      '--proxy-user': CommandRules.USERPASS,
      '-H': CommandRules.HEADER,
      '--header': CommandRules.HEADER,
    },
    wget: { '--header': CommandRules.HEADER },
    mysql: CommandRules.MYSQL,
    mysqldump: CommandRules.MYSQL,
    mysqladmin: CommandRules.MYSQL,
    mariadb: CommandRules.MYSQL,
    'mariadb-dump': CommandRules.MYSQL,
    mongo: CommandRules.MONGO,
    mongosh: CommandRules.MONGO,
    mongodump: CommandRules.MONGO,
    mongorestore: CommandRules.MONGO,
    ldapsearch: CommandRules.LDAP,
    ldapadd: CommandRules.LDAP,
    ldapmodify: CommandRules.LDAP,
    ldapdelete: CommandRules.LDAP,
    ldapwhoami: CommandRules.LDAP,
    sqlcmd: { '-P': CommandRules.PASSWORD },
    mosquitto_pub: { '-P': CommandRules.PASSWORD },
    mosquitto_sub: { '-P': CommandRules.PASSWORD },
    smbclient: { '-U': { mode: 'userpass', separate: true, glued: true, separator: '%' } },
    openssl: {
      '-passin': CommandRules.OPENSSL,
      '-passout': CommandRules.OPENSSL,
      '-pass': CommandRules.OPENSSL,
      '-k': CommandRules.PASSWORD,
    },
    // `login` — флаги только после клиента реестра (`docker login -p`).
    login: { '-p': CommandRules.PASSWORD, '--password': CommandRules.PASSWORD },
  };

  /** Клиенты реестра, у которых `login -p` — пароль. */
  private static readonly REGISTRY_CLIENTS: ReadonlySet<string> = new Set([
    'docker',
    'podman',
    'buildah',
    'skopeo',
    'nerdctl',
    'helm',
    'oras',
    'crane',
  ]);

  /**
   * Находки списка слов. `from` — номер слова, начиная с которого значения
   * судятся: список YAML дорастает строка за строкой, и каждое значение
   * называется один раз.
   */
  public static evaluate(
    tokens: readonly ShellToken[],
    sink: LineSink,
    placeholders: ReadonlySet<string>,
    from = 0,
  ): void {
    const judge = (
      key: string,
      rule: Pick<FlagRule, 'mode' | 'separator'>,
      token: ShellToken | undefined,
      index: number,
    ): void => {
      if (token !== undefined && index >= from) {
        CommandRules.judge(key, rule, token, sink, placeholders);
      }
    };
    let active: Readonly<Record<string, FlagRule>> | undefined;
    let activeName = '';
    tokens.forEach((token, index) => {
      const { text } = token;
      const name = text.slice(text.lastIndexOf('/') + 1).replace(/\.exe$/iu, '');
      if (name === 'login' ? CommandRules.REGISTRY_CLIENTS.has(activeName) : name in CommandRules.COMMANDS) {
        active = CommandRules.COMMANDS[name];
        activeName = name === 'login' ? `${activeName} login` : name;
        return;
      }
      if (CommandRules.REGISTRY_CLIENTS.has(name)) {
        active = undefined;
        activeName = name;
        return;
      }
      for (const [flag, rule] of Object.entries(active ?? {})) {
        const key = `${activeName} ${flag}`;
        if (text === flag && rule.separate) {
          judge(key, rule, tokens[index + 1], index + 1);
        } else if (
          rule.glued &&
          !flag.startsWith('--') &&
          text.startsWith(flag) &&
          text.length > flag.length
        ) {
          judge(key, rule, { text: text.slice(flag.length), literal: token.literal }, index);
        } else if (flag.startsWith('--') && text.startsWith(`${flag}=`)) {
          judge(key, rule, { text: text.slice(flag.length + 1), literal: token.literal }, index);
        }
      }
      if (text.startsWith('--') && text.length > 2) {
        const equals = text.indexOf('=');
        if (equals > 2) {
          const flag = text.slice(0, equals);
          const value = { text: text.slice(equals + 1), literal: token.literal };
          if (isSecretKey(flag.slice(2))) {
            judge(flag, CommandRules.SECRET, value, index);
          }
          // `--from-literal=password=…`, `--set=db.password=…`.
          CommandRules.assignments(value, sink, placeholders, index >= from);
        } else if (
          CommandRules.lastWordNamesSecret(text.slice(2)) &&
          !text.startsWith('--no-') &&
          tokens[index + 1] !== undefined &&
          !(tokens[index + 1] as ShellToken).text.startsWith('-')
        ) {
          judge(text, CommandRules.SECRET, tokens[index + 1], index + 1);
        }
      }
      // `yc config set token …`, `aws configure set aws_secret_access_key …`.
      if (
        text === 'set' &&
        tokens[index + 1] !== undefined &&
        isSecretKey((tokens[index + 1] as ShellToken).text)
      ) {
        judge((tokens[index + 1] as ShellToken).text, CommandRules.SECRET, tokens[index + 2], index + 2);
      }
      CommandRules.assignments(token, sink, placeholders, index >= from);
    });
  }

  /** `KEY=значение` в позиции присваивания: перед командой, `-e`, `--build-arg`, `-o user=…,password=…`. */
  private static assignments(
    token: ShellToken,
    sink: LineSink,
    placeholders: ReadonlySet<string>,
    report: boolean,
  ): void {
    if (!report || !token.text.includes('=')) {
      return;
    }
    for (const part of token.text.split(',')) {
      const match = /^([A-Za-z_][A-Za-z0-9_.-]*)=(.+)$/su.exec(part);
      if (match !== null && match[1] === '_auth' && Base64Credentials.decode(match[2] as string) !== null) {
        // `_auth` .npmrc — base64 «логин:пароль»: по содержимому, как в TextScanner.keyValues.
        Base64Credentials.judgeKey('_auth', match[2] as string, sink, placeholders);
      } else if (match !== null && isSecretKey(match[1] as string)) {
        CommandRules.judge(
          match[1] as string,
          CommandRules.SECRET,
          { text: match[2] as string, literal: token.literal },
          sink,
          placeholders,
        );
      }
    }
  }

  /** Последнее слово флага называет секрет: `--admin-password` да, `--password-file` нет. */
  private static lastWordNamesSecret(flag: string): boolean {
    const words = wordsOf(flag);
    const last = words.at(-1);
    if (last === undefined) {
      return false;
    }
    return namesSecret([last]) || (words.length > 1 && SECRET_PAIRS.has(`${words.at(-2)} ${last}`));
  }

  private static judge(
    key: string,
    rule: Pick<FlagRule, 'mode' | 'separator'>,
    token: ShellToken,
    sink: LineSink,
    placeholders: ReadonlySet<string>,
  ): void {
    // Подстановка без значения по умолчанию — не литерал; `${X:-литерал}` — литерал.
    const parts = token.literal ? [token.text] : token.text.includes('${') ? literalParts(token.text) : [];
    for (const part of parts) {
      if (rule.mode === 'secret' || rule.mode === 'header') {
        CommandRules.judgeSecret(key, rule.mode, part, sink, placeholders);
        continue;
      }
      let password = part;
      if (rule.mode === 'opensslpass') {
        password = /^pass:(.+)$/su.exec(part)?.[1] ?? '';
      } else if (rule.mode === 'userpass') {
        const at = part.indexOf(rule.separator ?? ':');
        password = at > 0 ? part.slice(at + 1) : '';
      }
      if (!CommandRules.VARIABLE_REFERENCE.test(password) && isCredential(password, placeholders)) {
        sink.literal(key, 'command-flag', password);
      }
    }
  }

  private static judgeSecret(
    key: string,
    mode: FlagRule['mode'],
    value: string,
    sink: LineSink,
    placeholders: ReadonlySet<string>,
  ): void {
    if (mode === 'secret') {
      if (key === '--secret' && CommandRules.BUILD_SECRET_SPEC.test(value)) {
        return;
      }
      for (const part of literalParts(value)) {
        if (isLiteralSecret(part, placeholders)) {
          sink.literal(key, 'command-flag', part);
        }
      }
      return;
    }
    const header = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/su.exec(value);
    if (header === null) {
      return;
    }
    const name = header[1] as string;
    const content = header[2] as string;
    if (/^(?:proxy-)?authorization$/iu.test(name)) {
      if (AUTH_HEADER_VALUE.test(content)) {
        Base64Credentials.judgeAuthorization(name, content, sink, placeholders);
      }
    } else if (isSecretKey(name) && isLiteralSecret(content, placeholders)) {
      sink.literal(name, 'command-flag', content);
    }
  }
}
