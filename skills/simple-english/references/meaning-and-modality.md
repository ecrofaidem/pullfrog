# Meaning and modality

Use this reference before you simplify text that contains requirements, advice, permissions, uncertainty, safety information, legal qualifications, or future commitments.

## Priority order

When rules compete, use this order:

1. factual accuracy
2. safety, legal, and regulatory meaning
3. obligation, permission, possibility, and uncertainty
4. technical correctness and established terminology
5. information order and usability
6. STE structure and style

A shorter sentence is not an improvement if it changes any item above it.

## Do not invent or complete the story

A rewrite can reorganize known information. It cannot add information that seems likely.

Do not add:

- a root cause that the source does not establish
- a fix that the source does not authorize
- a measurement, date, deadline, owner, or status
- a warning or risk that the source does not identify
- an action item, apology, promise, or future commitment
- a reason for a decision unless the source gives that reason

When evidence is incomplete, say that the fact is unknown or omit the unsupported claim. Do not convert missing evidence into confident prose.

## Preserve modal force

The same surface word can express different meanings. Identify the meaning before you replace the word.

| Source meaning | Typical signals | Preserve as |
|---|---|---|
| Obligation | must, shall, required, has to | A requirement or an imperative instruction |
| Recommendation | should, recommended, advisable | Advice that remains optional |
| Permission | may, permitted, allowed | Permission, not capability |
| Capability | can, is able to | Capability |
| Possibility | may, might, could, can, possible | The same degree of possibility |
| Conditional ability | could if, can when | Ability under the stated condition |
| Expected future | will, is scheduled to | A supported future statement |
| Uncertain future | may, might, expected to, likely | The same uncertainty |

Do not apply a global replacement such as `should` to `must`. This can turn advice into a requirement. Do not delete a recommendation because strict STE vocabulary needs a different construction.

In strict review mode:

1. Determine the intended force from the source and context.
2. Consult the official dictionary and the applicable rule.
3. Select a permitted construction that keeps the force.
4. If the force is unclear, present alternatives and request a decision.

Example:

> Source: You should back up the database before the migration.

This sentence does not show whether the backup is mandatory. Do not choose for the author.

- If mandatory: `Back up the database before the migration.`
- If optional advice: keep it explicitly optional with wording approved for the project's strict terminology set.

## Preserve uncertainty and evidence quality

Keep distinctions such as:

- known versus suspected cause
- observed correlation versus demonstrated cause
- possible versus probable result
- estimate versus measurement
- partial impact versus total impact
- temporary mitigation versus permanent correction

A strict style does not require false certainty. A direct statement can still say that a fact is unknown, estimated, or under investigation.

## Safety, legal, and regulated text

Do not rewrite a warning label, contractual term, policy obligation, or regulatory phrase only to satisfy a style preference. First determine whether the wording is controlled by:

- law or regulation
- a safety standard
- a contract
- an approved company policy
- a product or industry style guide

If a directive controls the wording, follow that directive. Record the exception in an audit instead of forcing a conflicting STE construction.

Do not lower or raise a risk category. Do not add an injury, damage mechanism, or consequence that the source does not establish.

## Fixed and editable text

Treat these as fixed unless the user explicitly makes them the target:

- code and command syntax
- identifiers, keys, flags, paths, and values
- API fields and endpoint names
- product names and legal names
- log excerpts and quoted source text
- existing user-interface strings that the document quotes

When the user asks to rewrite an error message or interface string, that string is editable. Preserve embedded literals such as `DB_PASSWORD`, `/v2/users`, error codes, and exact field names.

## Contradictions and missing facts

When sources conflict, do not merge them into a new claim. Identify the conflict and use the authoritative source that the user specified. If authority is not clear, ask for a decision or mark the item as unresolved.

When a missing fact blocks a safe rewrite, use one concise question. When it does not block the task, keep the uncertainty visible and continue.
