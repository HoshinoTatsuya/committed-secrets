  /**
   * Хосты, на которых встретился секрет: строка = хост, свёрнутый из записей
   * секрета на нём. Метки строк приходят только для раскрытой группы
   * (`secretId`/`rawSecret`), иначе — пустые.
   *
   * Маршрут провода: `'LIST_HOSTS_BY_SECRET'`
   * (VaultRoute.LIST_HOSTS_BY_SECRET).
   *
   * @param params - Вход {@link IListHostsBySecretInput}: `teamId`,
   * `userId`, `page`, `size`, `secretId` (предпочтительно) или `rawSecret`,
   * фильтры листинга.
   *
   * @returns Ответ {@link IListHostsBySecretOutput} (`items`, `totalItems` —
   * число хостов, `page`, `size`) ЛИБО `ClientError` значением — промис не
   * отклоняется никогда. Виды ошибок:
   * ```typescript
   * VALIDATION            // 422: вход не прошёл схему
   * INTERNAL_SERVER_ERROR // 500: отказ хранилища; сервис меток недоступен при заданном labelFilter; обрыв соединения, потолок ожидания
   * ```
   *
   * @example
   * ```typescript
   * const result = await client.vault.listHostsBySecret({
   *   teamId: 3,
   *   userId: 1,
   *   page: 0,
   *   size: 20,
   *   secretId: '24e45e7f5fe0b41140284afaf0c792a2ad28b6ae095f5bc4f6d29c8b70ceed39',
   * });
   * ```
   */
  public abstract listHostsBySecret(
    params: IListHostsBySecretInput,
  ): Promise<IListHostsBySecretOutput | ClientError>;
