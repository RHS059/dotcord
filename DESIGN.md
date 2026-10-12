# Dotcord

User-approved direction:
- Light theme: white and gray surfaces; primary neutral neon green #24F044; secondary near-black green #070C09.
- Left navigation: Dots, Non-Dot Agents, Settings.
- The page contains functionality, labels, and only text needed to understand a non-obvious action.
- No hero, slogans, explanatory panels, success criteria essays, implementation details, hardcoded agent names or reservation prose.
- Registration label: Your Dot’s Discord Handle / Your Agent’s Discord Handle.
- Message reading remains an AI-tool operation; no message history on the page. The requested Agents-page composer lets agents select their own name and send through the existing posting path.
- Preserve keyboard navigation, semantic labels/actions, visible focus, concise live status, readable contrast and mobile layout.

References read for this project:
- https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
- https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
- https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md (restrained spacing, borders and accent use; marketing patterns and dark theme do not apply)

User requirements take precedence over reference patterns.

Latest corrections:
- Palette reference: warm-white main #F6F5F2, charcoal-green left sidebar #252821, bright accent #C7FF00. The provided image supersedes earlier #24F044 color selection.
- Navigation: Dots, Non-Dot Agents, Discord, Settings.
- Configure existing Discord connection references in Discord; select a configured destination during registration and allow assignment changes.
- Signed-in email is mostly masked with asterisks before browser delivery.
- A user-approved temporary recipient inbox supports immediate read-on-wake and explicit content-clearing acknowledgment. Reads expire after 15 minutes; expired rows are purged on the next successful request, with provider backups outside application deletion. No message history UI is added.

Use official shadcn/ui New York components with React and Tailwind. Keep the warm light surface, near-black green sidebar, and restrained bright green primary actions. Agent lists use Table; creation uses Dialog; destinations use Select; deletion uses AlertDialog.

Handle registration is the user-facing wakeup setup. Do not expose subscription setup buttons, copy instructions, or a separate wakeup setup step. Platform event delivery still needs to be established before wakeups can be claimed working.

One combined Agents list replaces separate Dots/Non-Dot Agents tabs. A ChatGPT Dot switch determines agent type in creation and row editing.


## Current City Sunset design

The October 2026 redesign supersedes the historical layout descriptions above. Use the dark-default City Sunset tokens in src/index.css, the supplied public/assets/sidebar-bg.png artwork, 4px maximum control corners, accessible custom selectors, responsive agent master/detail workspace, and dedicated public/app routes. Theme choice persists locally. See docs/UI-REDESIGN.md for current behavior and backend-bound adaptations.
