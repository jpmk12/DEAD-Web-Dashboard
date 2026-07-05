// Starter templates for the Docs tab. Templates are ORDINARY docs tagged
// "template" — the picker lists any doc carrying that tag, and these seeds
// exist only so a fresh install has something useful on first click ("Create
// starter templates" in the New ▾ menu). Pure data; safe for client import.

export interface StarterTemplate {
  title: string;
  tags: string[];
  content: string;
  // Creating a doc from a typed template pre-sets the doc's type + seeds its
  // property keys (values left blank, ready to fill).
  docType: string;
  props: Record<string, string>;
}

export const TEMPLATE_TAG = "template";

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    title: "Template: Theorist card",
    tags: [TEMPLATE_TAG],
    docType: "theorist",
    props: { era: "", course: "", domain: "", work: "" },
    content: `*Work:* · *Era:* · *Course:*

## Core argument

One paragraph — what is the theory?

## Arguing against

What position or school is this a rebuttal to?

## Key terms

- term — definition in your own words

## Connections

- [[Other Thinker]] — *why* they connect (contrast / extends / shares…)
`,
  },
  {
    title: "Template: Debate — poles & synthesis",
    tags: [TEMPLATE_TAG],
    docType: "debate",
    props: { domain: "" },
    content: `## The question

## Pole A — [[Thinker A]]

## Pole B — [[Thinker B]]

## Synthesis — where I land

## Cases that test it

- [[Case]] — what it shows
`,
  },
  {
    title: "Template: Thread / through-line",
    tags: [TEMPLATE_TAG],
    docType: "thread",
    props: { domain: "" },
    content: `*One idea traced across sources.*

## Gloss

What is the through-line, in two sentences?

## Trace

1. [[Source]] — how it appears here
2. [[Source]] — how it evolves
3. [[Source]] — where it lands

## So what
`,
  },
  {
    title: "Template: Comps answer",
    tags: [TEMPLATE_TAG],
    docType: "synthesis",
    props: { course: "" },
    content: `## Question

## Thesis

## Evidence

- [[Source]] — the point it carries

## Counterargument & rebuttal

## Bottom line
`,
  },
  {
    title: "Template: Trip report",
    tags: [TEMPLATE_TAG],
    docType: "note",
    props: { location: "", dates: "" },
    content: `*Dates:* · *Location:* · *Travelers:*

## Purpose

## Key engagements

## Takeaways

## Follow-ups

- [ ] action — owner
`,
  },
  {
    title: "Template: Decision log",
    tags: [TEMPLATE_TAG],
    docType: "note",
    props: { decided: "" },
    content: `*Date:* · *Decision:*

## Context

## Options considered

- option — tradeoff

## Rationale

## Revisit when
`,
  },
];
