---
name: clickhouse
description: Query ClickHouse Cloud and ClickHouse Cloud managed Postgres (Terracotta, Reps production databases) using the official chctl CLI and browser OAuth/SSO, without database passwords. Use for ClickHouse SQL, database/table/schema discovery, Clay ClickHouse services, read-only SQL/metrics/slow queries on the managed Postgres services, or setting up and troubleshooting ClickHouse CLI authentication. Prefer this workflow over the local chmcp wrapper when the user authenticates with SSO.
---

# ClickHouse Cloud via OAuth

Use the installed official `chctl` (`clickhousectl`) CLI. Its browser OAuth flow supports read-only SQL through the Cloud Query API; database usernames/passwords are not needed. Do not build another OAuth client or extract browser cookies.

## Local setup and boundaries

- Executable: `~/.local/bin/chctl` (also available on PATH).
- Authenticate with `chctl cloud auth login`; inspect with `chctl cloud auth status --json`.
- `chctl` owns token storage and refresh. Its token file is `~/.clickhouse/tokens.json`; never read, print, copy, or commit its contents. Keep owner-only permissions.
- OAuth SQL access is read-only. Do not replace it with API-key authentication or create database users to get around a permission failure.
- The separately installed `chmcp` CLI wraps the official MCP server but does **not** inherit the `chctl` OAuth session. `CHMCP_TOKEN` authenticates to a remote MCP server, not directly to a ClickHouse database. Use `chctl` for this OAuth workflow.
- Service state, permissions, and login status change. Discover them at runtime rather than assuming the last session still applies.

## Authenticate

```bash
chctl cloud auth status --json
```

Proceed when OAuth is active and its scope is read-only. API keys and environment credentials can take precedence over OAuth, including credentials found by the CLI in `.clickhouse/credentials.json` or `.env`. If another source is active, identify it using the CLI's status/debug output; do not silently delete or replace credentials. Select a working directory without conflicting project credentials when appropriate.

If OAuth is absent or expired:

```bash
chctl cloud auth login
```

This opens the browser and prints a device code/activation URL. Let the user approve with their existing SSO account. In an agent harness, run this waiting process with the supervised-process tool, show the activation instructions if needed, and verify its successful exit. Never request the user's password or tokens in chat. After login, check status again.

## Select the organization and service

```bash
chctl cloud org list --json
chctl cloud service list \
  --org-id 1dff95ae-7280-4e33-bd5d-677e5f9456f9 --json \
  | jq '[.[] | {id, name, state}]'
```

Known local context:

| Organization/service | ID |
| --- | --- |
| Clay organization | `1dff95ae-7280-4e33-bd5d-677e5f9456f9` |
| Audiences - Staging | `1da9fe0b-af98-44b5-809d-ca93413efc3b` |
| terracotta-production | `35c9d147-023b-45bb-b8fa-ef836a1639cf` |

Always pass `--org-id`: this account has access to multiple organizations. Match the service to the user's task; do not silently default workload queries to production or to Audiences. Audiences - Staging was used only for the initial connection smoke test.

Prefer an already-running service for a smoke test. A query can wake an idle service. Do not start stopped services, change scaling/network rules, or provision Query API keys merely to verify authentication.

## Execute SQL

Connection smoke test on the staging service, after confirming it is running:

```bash
chctl cloud service query \
  --org-id 1dff95ae-7280-4e33-bd5d-677e5f9456f9 \
  --id 1da9fe0b-af98-44b5-809d-ca93413efc3b \
  --no-auto-enable \
  --query "SELECT 1 AS ok, currentUser() AS user, getSetting('readonly') AS readonly" \
  --json
```

The initial OAuth smoke test returned `ok=1`, a `sql-console:` user for the signed-in account, and `readonly=2`. Treat that as historical evidence, not a hard-coded identity requirement.

For actual work, use the chosen service's `--id` or `--name`. Keep `--no-auto-enable` to prevent accidental provisioning if the active credential source changes. Use `--database` when needed.

Input/output:

- `--query 'SELECT ...'`: one SQL statement.
- `--queries-file query.sql`: one SQL statement from a file.
- `--queries-file -`: read SQL from stdin.
- `--json`: JSONEachRow output (one JSON object per row), **not** a JSON array. Use `jq -s` when an array is needed.
- `--format CSV` or `--format TabSeparated`: alternate output; omit `--json` when selecting another format.
- `--query` and file/stdin input are alternatives. Do not send semicolon-separated scripts.

## Discover schema before querying data

Use the same service/organization flags with these SQL statements:

```sql
SELECT name FROM system.databases ORDER BY name
```

```sql
SELECT database, name, engine
FROM system.tables
WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
ORDER BY database, name
LIMIT 100
```

```sql
SELECT database, table, name, type
FROM system.columns
WHERE database = 'chosen_database' AND table = 'chosen_table'
ORDER BY position
```

Replace the database/table literals with names discovered from that service and quote SQL values correctly. Do not assume production and staging schemas match. Prefer bounded queries, explicit columns, time/partition filters, and `EXPLAIN ESTIMATE` for potentially expensive MergeTree scans. `LIMIT` alone does not bound aggregation work. Do not fetch sensitive rows merely to test connectivity.

## Managed Postgres (Terracotta, Reps)

The same OAuth session covers `chctl cloud postgres` (Beta). These are the production primaries for Terracotta and Reps since 2026-10-01 and 2026-10-26; they are not Aurora, and Datadog has no host metrics for them. Read-only, like the ClickHouse path.

```bash
chctl cloud postgres list --org-id 1dff95ae-7280-4e33-bd5d-677e5f9456f9 --json \
  | jq -r '.[] | "\(.name)\t\(.id)\t\(.postgresVersion)\t\(.haType)\t\(.state)"'
```

Services on 2026-11-06: `terracotta-pg-prod` (18, async HA), `terracotta-pg-staging`, `reps-pg-prod`, `reps-pg-staging`, `audiences-staging-pg`. Re-list rather than trusting this.

```bash
ORG=1dff95ae-7280-4e33-bd5d-677e5f9456f9
chctl cloud postgres query --org-id $ORG --name terracotta-pg-prod --json \
  -q "SELECT version(), current_setting('lock_timeout')"
```

`--json` streams three arrays: column names, column types, then rows. `--database` selects a database other than `postgres`. Queries are read-only at the API; `pg_stat_user_tables`, `pg_stat_activity`, `pg_settings`, and `EXPLAIN` are the usual targets.

Metrics and slow queries take RFC 3339 `--from-date`/`--to-date`. `metrics` accepts `--name`; `slow-queries list` takes the service id as a positional argument:

```bash
F=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ); T=$(date -u +%Y-%m-%dT%H:%M:%SZ)
chctl cloud postgres metrics --org-id $ORG --name terracotta-pg-prod --from-date $F --to-date $T --json
ID=$(chctl cloud postgres list --org-id $ORG --json | jq -r '.[]|select(.name=="terracotta-pg-prod").id')
chctl cloud postgres slow-queries list --org-id $ORG --from-date $F --to-date $T $ID --json
```

`metrics` returns CPU, memory, disk, I/O, connections, active sessions by wait, lock wait time, blocked sessions, cache hit ratio, throughput, deadlocks, database size, transactions. `slow-queries list` returns query patterns with call count, p50/p95/p99 duration, rows, shared blocks hit/read, and WAL bytes; `slow-queries get` shows recent executions of one pattern. `config get` reads `pgConfig` and PgBouncer settings. Do not run `config replace`/`patch`, `update`, `reset-password`, `create`, or `delete`: those write to production.

## Troubleshooting

- **Login expired:** rerun browser login and check the active credential source; do not dump the token file.
- **403 or missing service:** verify organization, service, and account permissions. Do not escalate access automatically.
- **Timeout:** the Query API times out after roughly 30 seconds; SQL may still run server-side after the client loses its result. Do not blindly retry expensive queries. Narrow the query or report the limitation; native-client fallback may require separate authentication.
- **Stopped service:** report its state; starting it is a separate operational action.
- **Stored Query API key rejected:** do not run `repair-query-key` automatically; that replaces credentials and is unnecessary for the intended OAuth-only workflow.
- **CLI behavior differs:** consult `chctl cloud auth login --help` and `chctl cloud service query --help` for the installed version rather than guessing flags.

Official reference: https://github.com/ClickHouse/clickhousectl
