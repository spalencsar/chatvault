# ChatVault — Strict UI/UX Redesign Based on Reference Mockup

## Objective

Redesign the existing ChatVault application to match the attached reference mockup as closely as technically possible.

**The reference image is the authoritative visual specification, not merely an inspiration.**

This is a UI/UX implementation task, not a product redesign or an opportunity to invent a different interface.

The goal is to reproduce the mockup's layout, visual hierarchy, proportions, spacing, typography, colors, component styling, and interaction patterns while preserving ChatVault's existing functionality.

## 1. Inspect the Existing Application First

Before modifying any files:

- Analyze the current project structure and frontend architecture.
- Identify the existing UI components, layouts, styles, and design tokens.
- Identify application state management, navigation, and data flows.
- Understand the existing conversation archive, workspace organization, search, filtering, and export functionality.
- Reuse the existing framework, component architecture, and dependencies wherever reasonable.

Do not begin implementation until you understand how the existing frontend connects to the application logic.

## 2. Mandatory Visual Reference

The reference mockup is `.agents/mockup.png` (1586×992). Use it as the
primary and binding reference.

Do not reinterpret, simplify, or replace its visual design.

### Overall Layout

Implement the four-region desktop layout shown in the reference: a global
top bar plus the three columns beneath it.

**Top bar — global header (full width, above all three columns)**

- ChatVault logo and branding at the left.
- Centered search field with placeholder and `Ctrl`+`K` shortcut hint.
- Settings control at the right.
- Dark background with a subtle bottom border; compact height.

**Left sidebar — Workspace and Source Navigation**

- Workspaces section with folder icons and conversation counts.
- Selected workspace highlighted with an amber accent.
- Sources section with recognizable provider icons and counts.
- Archive status indicator at the bottom.
- Dark background, subtle borders, and compact spacing.

**Middle column — Conversation Browser**

- Selected workspace title and associated project path.
- Filter controls: All, Starred, Archived.
- Scrollable conversation list.
- Conversation cards displaying title, source, timestamp, and preview.
- Active conversation clearly highlighted with an amber border and subtle background.
- Conversation count at the bottom.

**Right column — Conversation Reader**

- Breadcrumb navigation displaying workspace and conversation title.
- Export and continuation controls at the top.
- Scrollable conversation content.
- Clear distinction between user and assistant messages.
- Source-specific icons and readable message metadata.
- Support for formatted message content, including code blocks and tool interactions.
- Bottom composer/action area for conversation continuation and handoff.

### Visual Design

Match the reference as closely as possible:

- Dark charcoal/near-black surfaces.
- Warm amber/gold as the primary accent.
- Thin, restrained borders and subtle surface contrasts.
- Compact controls and carefully aligned elements.
- Rounded components matching the reference.
- Clear typography hierarchy.
- Consistent spacing, padding, and component dimensions.
- Subtle hover, focus, selected, and active states.

Do not introduce gradients, oversized cards, additional decorative elements, unrelated accent colors, or alternative layouts unless they are explicitly visible in the mockup.

## 3. Preserve Existing Functionality

This redesign must not break or remove existing ChatVault features.

In particular:

- Preserve all supported conversation sources and their import/read functionality.
- Preserve the existing archive database, schema, and indexing mechanisms.
- Preserve workspace organization and conversation navigation.
- Preserve search, filtering, starring, and archiving behavior.
- Preserve existing export capabilities and supported formats.
- Preserve existing conversation continuation and handoff functionality where implemented.
- Preserve settings and other existing application features even if they are not directly represented in the screenshot.

The mockup defines the appearance of the interface, not a replacement for the underlying application behavior.

Do not introduce mock data, hardcoded conversation counts, fake functionality, or nonfunctional placeholder buttons in the production interface.

## 4. Component and Styling Architecture

- Adapt existing components where appropriate rather than duplicating them.
- Extract reusable UI components for navigation items, conversation entries, filters, message headers, and action controls.
- Define centralized design tokens for colors, spacing, borders, radii, and typography.
- Preserve accessibility, keyboard navigation, and appropriate focus states.
- Keep the implementation maintainable and consistent with the existing project conventions.
- Do not add a new UI framework without a compelling technical reason.

## 5. Responsive Behavior

The screenshot is the authoritative desktop reference.

At the reference viewport dimensions, reproduce the three-column layout as closely as possible.

For smaller viewport widths, implement a usable responsive adaptation while retaining the same visual language.

Do not compromise desktop fidelity to accommodate mobile layouts.

## 6. Implementation and Visual Verification

Work in the following order:

1. Inspect and understand the existing frontend.
2. Identify the components requiring modification.
3. Implement the overall layout and design tokens.
4. Implement the sidebar and workspace navigation.
5. Implement the conversation browser.
6. Implement the conversation reader and action controls.
7. Connect all redesigned components to existing application behavior.
8. Run the project's available checks and tests.
9. Start the application and compare the actual rendered interface against the reference image.
10. Correct visual discrepancies before considering the task complete.

Pay particular attention to:

- Column widths and proportions.
- Alignment and component positioning.
- Header heights.
- Vertical and horizontal spacing.
- Typography and text truncation.
- Border thickness and colors.
- Selected states.
- Scroll behavior.
- Bottom-anchored interface elements.

If screenshot or browser-based verification is available, use it rather than relying exclusively on code inspection.

## 7. Strict Constraints

**DO NOT:**

- Redesign the supplied mockup.
- Substitute your own preferred visual style.
- Change the application's business logic unnecessarily.
- Rewrite database or import mechanisms.
- Remove functionality because it is not visible in the screenshot.
- Introduce unrelated dependencies.
- Replace working functionality with placeholders.
- Declare success based solely on successful compilation.

**DO:**

- Treat the mockup as the visual source of truth.
- Preserve existing application capabilities.
- Implement the design consistently across the interface.
- Verify both visual fidelity and functional correctness.

## Definition of Done

The task is complete only when:

1. The desktop UI closely matches the supplied mockup.
2. All existing functionality remains available and operational.
3. The implementation uses the real application data and state.
4. The existing project checks and tests pass.
5. Visual differences from the reference have been inspected and addressed.

At completion, provide a concise report of modified components, functional verification results, and any remaining differences from the reference.

**Primary priority: visual fidelity to the provided mockup.**

**Secondary priority: maintainability without compromising existing behavior.**

## Mandatory Execution Discipline — No Overthinking

**Priority: CRITICAL**

The agent must prioritize measurable implementation progress over prolonged reasoning, repetitive analysis, or unnecessary perfectionism.

These rules are mandatory for all implementation, debugging, refactoring, and UI/UX tasks.

### 1. Strict Reasoning Boundaries

- Analyze only what is necessary to make the next implementation decision.
- Do not repeatedly reconsider decisions without new technical evidence.
- Never repeat substantially identical reasoning, calculations, or observations.
- Do not restart an analysis simply because the result is imperfect.
- Once a technically reasonable solution is identified, implement it.
- Do not attempt to eliminate every uncertainty before writing code.

**Hard rule:** If the same problem has been analyzed twice without new evidence, stop analyzing and proceed with the best supported solution.

### 2. Mandatory Progress

Every investigation must lead to at least one of the following:

- A concrete code modification.
- A test or verification step.
- A documented technical blocker.
- A necessary decision that enables implementation.

Do not continue investigating indefinitely without producing one of these outcomes.

Before additional analysis, ask:

"Will this investigation materially change my next implementation step?"

If the answer is no, stop investigating.

### 3. UI/UX and Visual Reconstruction

When implementing a UI from a reference image:

- Prioritize overall layout, proportions, visual hierarchy, spacing, and color consistency.
- Use visual approximations for minor decorative elements.
- Do not perform pixel-by-pixel reconstruction unless explicitly requested.
- Do not analyze antialiasing, ASCII pixel maps, or individual image pixels to reconstruct simple icons.
- Use existing icon libraries, SVG primitives, or simple geometric paths where appropriate.
- Do not spend disproportionate effort on details that are barely visible at normal rendering size.

**Hard rule:** A small decorative element must never block implementation of the primary interface.

### 4. Anti-Loop Detection

Immediately stop the current reasoning approach if any of these conditions occur:

- The same hypothesis is reconsidered multiple times.
- Calculations are repeated without changing the implementation decision.
- The agent repeatedly alternates between equivalent solutions.
- An investigation produces progressively more detail but no actionable result.
- The agent acknowledges uncertainty yet continues the same unsuccessful analysis.

When detected:

1. Stop the current investigation.
2. State the remaining uncertainty in one sentence.
3. Select the simplest technically sound approach.
4. Implement or test that approach.
5. Continue with the next task.

Do not restart the same reasoning process.

### 5. Bounded Investigation

Use the following limits as workflow constraints:

- Maximum two analytical approaches per isolated problem before implementing or testing.
- Maximum one additional investigation without new evidence.
- Maximum two attempts to refine a minor visual detail before moving on.
- Do not repeatedly inspect unchanged files or reproduce identical tool outputs.
- If a task remains blocked, report the specific blocker instead of endlessly exploring alternatives.

These limits do not prohibit necessary debugging when new errors, test failures, or evidence emerge.

### 6. Implementation Before Perfection

Prefer a working, maintainable implementation that meets the actual requirements over an indefinitely analyzed ideal solution.

For UI work, prioritize:

1. Functional correctness.
2. Overall layout fidelity.
3. Component structure and visual consistency.
4. Interaction states and accessibility.
5. Minor decorative refinements.

Do not optimize item 5 while items 1–4 remain incomplete.

### 7. Completion Discipline

After implementing a solution:

- Run relevant checks.
- Fix concrete failures.
- Avoid speculative improvements.
- Do not reopen completed decisions without evidence of a defect.
- Proceed to the next unfinished requirement.

**Fundamental rule:**

Reason to decide. Implement to validate. Test to verify.

Never substitute prolonged reasoning for implementation.
