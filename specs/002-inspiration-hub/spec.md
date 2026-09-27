# Feature 002 — Inspiration hub (welcome/activity home)

Status: specified · design-first mandatory before implementation
Priority: 2 of 3 (user-ordered)
Base commit: d7a4e523 (atlas base)

## Problem

The app opens straight into the thread shell; a new deployment shows an empty sidebar and no
sense of what the product can do. The maintainer wants a "massive welcome screen with
activity" like AutoClaw's Inspiration Hub (reference screenshots captured 2026-09-28): a home
surface that greets the user, shows product activity/inspiration cases, and routes users into
their first useful action. It is intentionally hard to describe in words; the design phase
must study the reference pattern (AutoClaw: header + points/credits area, recent events
banners, "earn points" cards, and a "Get inspired" gallery of example cases with "Make
similar" actions) and adapt it to Ai7's monochrome, bots-carry-identity-color design system.

## Requirements

1. R1 — A welcome/home surface reachable from the shell (and shown for first sign-in / empty states), on web and desktop; mobile gets a native-pattern equivalent or a safe degradation with recorded reason.
2. R2 — The hub adapts content to the user's state: empty deployment → guided first actions (create agent, connect model, connect Telegram); active user → recent threads/activity across their bots.
3. R3 — An inspiration gallery of example cases (curated, per-deployment or bundled set) where each case can start a preconfigured task (equivalent of "Make similar") — reusing experts/seed-bot mechanics where they exist.
4. R4 — Follows the constitution UI rules: semantic tokens only, monochrome + bot identity colors, progressive disclosure, minimal copy; every visible word justified in the PR.

## Product assumptions made autonomously (reversible)

- A1: No points/credits/leaderboard system in v1 — that is AutoClaw's monetization layer, out of scope; the hub's "activity" = the user's own product activity + curated inspiration cases.
- A2: Recent-events banners are a deployment-operator content slot (configurable), not hardcoded marketing.
- A3: Gallery content ships as a versioned bundled catalog (like experts/avatars assets) with optional remote refresh later — no new hosted service in v1 (provider neutrality).

## Open questions

- Q1: Does a "credits/points" concept exist anywhere in the product we should surface (usage records exist — `UsageRecord` model), or is v1 purely activity + inspiration?
- Q2: Who curates inspiration cases for an on-prem deployment (operator-uploadable catalog?)

## Verification sketch

- V1: E2E (web) — hub renders for new user with guided actions; for active user with real recent threads.
- V2: E2E — "start from case" creates the preconfigured bot/thread.
- V3: Visual/token check — no hardcoded colors (lint + screenshot).
- V4: Mobile — recorded degradation or equivalent surface, exercised in mobile test.
