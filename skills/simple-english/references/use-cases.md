# Use-case patterns

Load only the section that matches the artifact. These patterns do not authorize new facts.

## Error messages and interface messages

Use this order when the information is known:

1. what happened
2. the cause
3. what the reader can do

Do not invent a cause from a generic failure. Do not tell the reader to change credentials unless the system established a credential error.

**Source facts:** The connection timed out. The cause is unknown. The reader can retry.

**Rewrite:**

> The database connection timed out. Try the connection again. If the error continues, record the request ID and contact support.

The final instruction is permitted only when the source or product policy supplies it.

## Runbooks and operating procedures

- Put prerequisites and access requirements before the numbered steps.
- Use one observable action in each step.
- Put decision branches immediately after the check that controls them.
- Give expected results when the source supplies them.
- Put destructive-action warnings before the action.
- Keep recovery and rollback steps explicit. Do not invent a rollback.

## Troubleshooting

Use a stable decision structure:

1. symptom
2. first check
3. result branch
4. next check or correction
5. verification

Do not convert a possible cause into the cause. Use conditional wording when evidence is conditional.

## Incident reports and postmortems

Separate these items:

- observed impact
- timeline
- known cause or explicit unknown cause
- mitigation and recovery
- corrective actions that were actually approved

Use exact times and measurements from the source. Do not add an explanation, rollback, owner, or commitment.

**Source facts:** From 14:02 to 14:31 UTC, 12 percent of requests failed. The cause is under investigation.

**Rewrite:**

> From 14:02 to 14:31 UTC, 12 percent of requests failed. The cause is under investigation.

## API documentation and release notes

Keep endpoints, field names, versions, status codes, and dates exact.

For a breaking change, state:

1. the required reader action, when it is truly required
2. the changed behavior
3. the effective version or date, when supplied
4. the consequence of no action, when known

Do not create a migration deadline or deprecation date.

## CLI documentation

Treat commands, flags, paths, and output as fixed literals. Keep each command next to the instruction that explains it. Do not alter command syntax to improve grammar.

For destructive flags, use the applicable warning pattern and only the documented consequence.

## Prompts and agent instructions

Use direct, testable instructions. Keep optional behavior optional.

- Split independent requirements.
- State the condition before the action when execution order depends on it.
- Define terms that can be interpreted in more than one way.
- Avoid synonym rotation for named operations.
- Do not replace every `should` with `must`. First decide whether the instruction is mandatory.

## Translation-ready technical content

- Build a small terminology list before the rewrite.
- Keep one term for each concept.
- Expand ambiguous abbreviations on first use when the product style allows it.
- Keep complete grammar and explicit logical relations.
- Preserve locale-sensitive values and units.

Strict vocabulary review still needs the official dictionary and the project's approved terminology.

## Support and status updates

Use factual impact, current status, and the next supported action. Preserve uncertainty. Do not add an apology, resolution time, or promise that the source does not contain.

## Marketing, brand, and creative text

Do not activate this skill by default. STE can flatten persuasion, rhythm, and voice. When the user requests an STE adaptation, preserve the facts. Explain that the result is a clarity adaptation, not strict technical-document compliance.
