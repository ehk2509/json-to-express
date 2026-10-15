# P8 external pilot outreach kit

This is an **opt-in recruitment pack**, not proof of outside adoption.
The maintainers can copy/edit the messages below and share them in communities
that explicitly allow developer project showcases or pilot invitations.
Do not mass-DM strangers, comment on unrelated issues, or claim that these
posts were already published.

**Primary CTA:** https://github.com/ehk2509/json-to-express/issues/57

**Low-friction preview:** https://github.com/ehk2509/json-to-express/blob/main/docs/P8-GET-STARTED.md

**Pinned pilot source:** `dc964d701dc7236bf9dc7a586b6c1e7e78e066f2`.
`0.2.0-beta.3` was released from a different commit, so the public beta is
for general exploration, not interchangeable with the P8 cohort.

## Short developer post (X / Bluesky / Discord)

> I'm building **json-to-express**, an open-source JSON-first generator
> for Node.js APIs (Express/Fastify × MongoDB/PostgreSQL).
>
> Internal E2E tests are passing. Now I need feedback from developers
> outside my own repo. Would you try a small, isolated API pilot?
>
> No 72-hour commitment just to express interest.
> Start here: https://github.com/ehk2509/json-to-express/issues/57

## LinkedIn / dev community introduction

> I'm looking for 3 independent developers or teams to evaluate an open-source
> Node.js project I've been building: **json-to-express**.
>
> Instead of writing boilerplate, you describe an API in JSON and generate an
> Express or Fastify app backed by MongoDB or PostgreSQL. The project has a
> repeatable CI matrix and packaged-consumer integration tests.
>
> That's not the same thing as knowing whether it works in an independently
> operated service. I want to learn about onboarding friction, generated-code
> quality, migrations, recovery, observability and actual deployment issues.
>
> If you build Node.js APIs, even a five-minute read-only evaluation or a
> disposable staging experiment would be useful. You don't need to commit
> to a formal production pilot to ask questions or give early feedback.
>
> Code, short preview and volunteer thread:
> https://github.com/ehk2509/json-to-express/issues/57
>
> If you do later participate in the formal validation cohort, we will ask
> for a small independently operated workload, a tested recovery drill,
> 72 hours of observation and a redacted technical report. No credentials
> or private customer data.

## Developer forum: request for feedback, not a launch claim

**Suggested title:** I built a JSON-to-API generator for Express/Fastify — looking for independent Node.js pilot testers

> Hi! I've been working on an open-source generator that takes a declarative
> JSON spec and produces a runnable Node.js API. It supports native Fastify
> and Express with MongoDB/Mongoose or PostgreSQL/Prisma.
>
> Internal tests already cover the database/framework combinations, but I'm
> trying to validate the developer experience beyond my own fixtures.
>
> I'd particularly value feedback on:
> 1. Is the JSON spec understandable and maintainable?
> 2. Is the generated code something you'd be comfortable owning and reviewing?
> 3. Where does setup, deployment or migration experience break down?
>
> You can inspect the pinned code and generate a preview without connecting a
> database. No commitment is needed to say you're interested.
>
> Pilot thread and preview: https://github.com/ehk2509/json-to-express/issues/57
>
> I'm interested in *critical feedback*, not just stars. The formal program
> needs 3 independent services and currently has zero verified pilot results.

## Personal invitation (only to an existing contact who might be interested)

> Hey, I've been working on a Node.js API generator called
> json-to-express (Express/Fastify, MongoDB/Postgres).
>
> I'm looking for external eyes now that the packaged integration tests pass.
> You're familiar with Node backends, so I'd value your opinion on the
> generated code and whether the JSON approach feels usable.
>
> If you have a few minutes, would you be willing to look at the
> [quick preview](https://github.com/ehk2509/json-to-express/blob/main/docs/P8-GET-STARTED.md)?
> No pressure to commit to the full pilot. Feedback and questions are welcome
> in [the recruitment issue](https://github.com/ehk2509/json-to-express/issues/57).

## Handling replies

- **Interested but busy:** Thank them, offer the database-free preview, and
  don't count them as a confirmed pilot.
- **Can provide a real staging environment:** Direct them to the formal
  [application](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-application.yml)
  and help agree on a safe scope.
- **Found a reproducible defect:** Open a dedicated issue, acknowledge
  severity, request only redacted logs and stop affected deployments.
- **Completed 72+ hours:** Direct them to the separate
  [evidence form](https://github.com/ehk2509/json-to-express/issues/new?template=p8-pilot-evidence.yml);
  use independent review before updating the attestation index.
- **No response:** Avoid repeated unsolicited follow-up. A single respectful
  reply in the original conversation is enough.

## Measure the recruitment funnel without inflating success

Keep these distinct:

| Stage | Evidence | Counts toward production validation? |
| --- | --- | --- |
| Reach | Project page and permitted public posts | No |
| Interested | Volunteer reply in issue #57 | No |
| Application | Separate application issue | No |
| Staging | Operator confirms a disposable test | No |
| Observation | Independent service operated for 72h | Not yet |
| Evidence | Redacted technical report submitted | Not until reviewed |
| Verified | Separate human reviewer approved pinned-SHA evidence | Yes |

Never fabricate endorsements, pilot identities or production results.
Do not automatically post to community sites without the maintainer's
permission and the community's posting rules.
