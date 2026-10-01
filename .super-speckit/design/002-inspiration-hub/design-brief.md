# 002-inspiration-hub — Inspiration hub — AutoClaw pattern, monochrome adaptation

## Problem
Layout: three zones per the confirmed purpose-map wireframe — greeting header; Activity zone (recent threads across bots via runs/list recent + SpaceNavigation previews); Get-inspired gallery as the visually primary zone (horizontal card rail); first-actions cards (create agent / connect model / connect Telegram) shown only when space.hasContent is false. Gallery card anatomy: visual (bundled asset, monochrome-friendly illustration style) → case title → [Make similar] button; cards compose ui-web primitives (Card/Badge); case visuals use ink/line tints, never brand hues — bots carry the only color (identity avatar on cards where an expertKey maps one). Copy budget: greeting one line; zone titles two words; case cards title + max one line; button label fixed 'Make similar'; empty-state actions verb-first. AutoClaw reference screenshots are not in the repo (investigator-verified) — the confirmed purpose-map diagrams + constitution are the design authority; if the maintainer later supplies screenshots, adapt within these constraints. Out of pattern scope: points/credits UI, marketing banners. Adjacent cleanup in scope: Welcome.tsx hardcoded hex gradients move to semantic tokens.

## Assumptions to review

- User, hierarchy, and state behavior need product confirmation.
- Reuse the repository design system when one is declared.
- This prototype is not production code.
