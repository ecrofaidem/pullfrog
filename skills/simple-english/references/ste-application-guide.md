# STE application guide

This guide is an operational map for the skill. It is not a replacement for ASD-STE100 Issue 9. Consult the official standard for exact wording, examples, dictionary decisions, and a strict review.

## Words and terminology: Rules 1.1 through 1.14

In strict review mode, use approved general words plus valid technical nouns and technical verbs. Check the approved meaning, part of speech, and permitted form. Use one technical noun for one item, and use approved project terminology.

Do not use a technical noun as a verb or a technical verb as a noun without an approved basis. Select short, clear technical terms and avoid regional or slang terms.

Use American English spelling unless another official directive applies. Keep the spelling in quoted text unchanged.

## Multi-word nouns: Rules 2.1 and 2.2

Keep multi-word nouns short and easy to parse. A chain of more than three words needs review. Use a shorter approved term, add a preposition, add a hyphen where applicable, or define a short form.

Do not split an established identifier or product term only to satisfy this preference.

## Verbs: Rules 3.1 through 3.7

Strict STE controls verb forms and tenses. Prefer the infinitive, imperative, simple present, simple past, simple future, and permitted participle forms.

Avoid auxiliary constructions that create perfect or progressive tenses when a simple construction preserves the meaning. Use an `-ing` form only in a permitted noun or modifier role. Use a direct verb to describe an action instead of hiding the action in a noun.

Use active voice. In descriptive writing, passive voice can be appropriate when the actor is unknown. Do not invent an actor to remove a passive sentence.

Modal vocabulary needs semantic review. Do not replace a modal until you identify whether it expresses obligation, recommendation, permission, capability, or possibility. See [meaning and modality](meaning-and-modality.md).

## Sentences: Rules 4.1 through 4.5

Write short, clear, grammatically complete sentences. Do not remove necessary words or use contractions only to reduce length.

Use a vertical list when it makes complex material easier to understand. Use connecting words when they make the relation between sentences clear.

Use an article or demonstrative before a noun when it is grammatically applicable. Do not insert an article mechanically into identifiers, headings, or established technical terms.

The general recommendation about `that` is not an absolute rule. Use `that` when it prevents ambiguity or makes a clause easier to understand.

## Procedural writing: Rules 5.1 through 5.5

Use no more than 20 words in each procedural sentence in strict review mode. Write one instruction in each sentence unless two actions occur at the same time. Use the imperative for instructions.

Rule 5.4 is conditional. Put a descriptive condition before the command when the reader must know the condition first. Do not move every `if` or `when` clause to the start without checking the task logic.

A note gives information. It must not hide an instruction. Treat a note as descriptive text and apply the descriptive sentence limit.

## Descriptive writing: Rules 6.1 through 6.6

Give information gradually and use key terms to show the logical structure. Use no more than 25 words in each descriptive sentence in strict review mode.

Group related information. Keep one topic in each paragraph and no more than six sentences in a paragraph.

A mixed document is permitted. A procedure can contain descriptive notes, prerequisites, results, and explanations. Classify each block instead of forcing one type on the complete document.

## Safety instructions: Rules 7.1 through 7.3

Use the applicable risk word or label from the governing domain. Start with a clear command or with a condition that the reader needs first. Then explain the risk or possible result.

Do not infer the label from writing style alone. Follow the applicable safety standard or company directive, and do not change the risk level.

## Punctuation and word count: Rules 8.1 through 8.7

A semicolon is not permitted in strict STE. Use separate sentences.

Use hyphens to connect directly related words when the construction requires them. Parentheses have specific permitted uses, including references, identifiers, abbreviations, alternatives, and explanations.

For strict word counts:

- In a vertical list, a lead-in colon ends the sentence for word-count purposes.
- Parenthetical text counts as one word.
- Each of these counts as one word: a number, a number with its unit, an abbreviation, or an alphanumeric identifier.
- Quoted text, a heading, a label, or a proper name also counts as one word.
- A hyphenated word counts as one word.

The bundled linter approximates these rules. Review unusual Markdown, tables, nested parentheses, and quoted material manually.

## Writing practices: Rules 9.1 through 9.4

Do not force a word-for-word substitution when the sentence structure is the problem. Rewrite the complete sentence.

Use approved words correctly. Avoid unintended phrasal verbs in strict review mode. Keep terminology and style consistent.

## General recommendations

Issue 9 also includes general recommendations, identified with `GR` labels rather than numbered rules. They cover topics such as `that`, `with`, pronouns, false friends, Latin abbreviations, inclusive language, and possessive forms.

Treat a general recommendation as guidance, not as an absolute numbered rule. Apply it when it improves clarity and does not conflict with an official directive or the user's required terminology.

## Rule-citation discipline

When an audit cites a rule:

1. Verify the rule number in the official standard or this guide.
2. State whether the finding is objective or requires judgment.
3. Do not cite a general recommendation as a mandatory numbered rule.
4. Do not claim that a regex finding proves a violation.
5. Give a rewrite only when it preserves the source meaning.
