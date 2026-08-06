# Swapify Agile Process

We build Swapify in **1-week sprints**, using the Scrum rhythm scaled down to a
single developer + AI assistant pairing.

## The rhythm

| Ceremony | When | What happens |
|---|---|---|
| Sprint planning | Monday | Pick the top 3-5 items from `docs/backlog.md` for the sprint |
| Development | All week | Each backlog item ships as a small, testable feature |
| Sprint review | Friday | Demo the working features; adjust priorities |
| Retro | Friday | What went well / what to improve / what to try next |
| Backlog grooming | As needed | Add, split, or re-prioritize items |

## Definition of Done (DoD)
Every backlog item is only "done" when all of these hold:
- [ ] Feature works locally end-to-end
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] No secrets committed; envs live in `.env` (git-ignored)
- [ ] Updated backlog status and committed with a clear message

## Working agreements
- Small commits, one concern each; feature branches reviewed before merge.
- If something takes more than a day, split it into smaller backlog items.
- Estimate in story points (1, 2, 3, 5, 8) to spot scope creep early.
- Never leave the repo broken - fix the build before ending the day.
- AI assistant (opencode) drives implementation; the user reviews and steers.

## Sprint board
Track status inline in `docs/backlog.md`:
- `[ ]` not started
- `[-]` in progress
- `[x]` done

## Current sprint
Sprint 0 - Foundations (see backlog.md)
