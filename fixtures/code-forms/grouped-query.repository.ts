   */
  private _buildGroupedQuery(input: IGroupedEntriesQuery): IEntriesQuery {
    const base = this._buildBaseQuery(input, { omitHostFilter: true });
    const stateConditions = [
      sql`"state_link"."team_id" = ${input.teamId ?? null}`,
      // Статус секрета — по тем же записям, что видны в выдаче: иначе
      // скрытая запись выключенного правила держала бы группу в состоянии NEW.
      sql.raw(activeRuleCondition('"state_link"."rule_id"')),
    ];
    const from = sql`${base.from} LEFT JOIN (SELECT "state_link"."secret_digest" AS "secret_id", ${sql.raw(groupStatusExpr('"state_link"."review_status"'))} AS "group_status" FROM "vault_entries" "state_link" ${this._whereActive(stateConditions, '"state_link"')} GROUP BY "state_link"."secret_digest") "secret_state" ON secret_state.secret_id = "vault_entries"."secret_digest" LEFT JOIN "saved_secrets" "saved_secrets" ON "saved_secrets"."secret_id" = "vault_entries"."secret_digest" AND "saved_secrets"."user_id" = ${input.userId ?? null} AND "saved_secrets"."team_id" = "vault_entries"."team_id" AND "saved_secrets"."deleted_at" IS NULL`;
    const query: IEntriesQuery = { from, conditions: base.conditions };

    if (input.statuses?.length) {
      query.conditions.push(
        sql`${sql.raw(SECRET_STATE)}.group_status IN ${input.statuses}`,
      );
