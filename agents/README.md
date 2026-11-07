# Agent skills and rules

Skills and rules shared by omp, Claude Code, and Codex. `install.sh` links them into place:

| Repo path | Linked to |
| --- | --- |
| `agents/skills/<name>/` | `~/.agents/skills/<name>` (one link per skill, so skills installed from elsewhere can sit next to them) |
| `agents/omp/RULES.md` | `~/.omp/agent/RULES.md` |
| `agents/claude/CLAUDE.md` | `~/.claude/CLAUDE.md` |
| `agents/codex/AGENTS.md` | `~/.codex/AGENTS.md` |

The skills reference each other by `~/.agents/skills/<name>` paths, so they only work once linked. Review gates: `pre-push-review` runs `software-design` and, for diffs that touch a database, `database-design`. Skill descriptions double as the trigger conditions each harness matches on.
