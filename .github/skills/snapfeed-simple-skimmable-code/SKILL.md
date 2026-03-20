---
name: snapfeed-simple-skimmable-code
description: "Makes changed Snapfeed code aggressively simple, skimmable, and strict about state. Use when simplifying a diff, reducing complexity in packages/client or packages/server, cleaning up branch changes, tightening TypeScript state, simplifying overlay or route logic, or making Snapfeed React and server code easier to scan."
---

# Snapfeed Simple Skimmable Code

## Overview

Use this skill to simplify changed code in Snapfeed so it is easy to scan, easy to reason about, and strict about state.

This skill is for simplifying existing diffs, not for broad rewrites. Work from the current branch changes and keep only the code that is strictly required.

## When to Use

Use this skill when the user asks for any of the following:

- Simplify this Snapfeed diff
- Make this branch easier to read
- Reduce complexity in changed code
- Clean up state handling
- Tighten TypeScript types
- Make this more skimmable
- Simplify client overlay or feedback code
- Simplify server route or middleware logic
- Clean up React example code without changing behavior

## Core Rules

### Optimize for Skimmability

- Write simple code that can be understood in one pass.
- Prefer fewer lines when readability stays high.
- Keep the main path visible.
- Do not introduce clever abstractions, dense helper layers, or indirect control flow.

### Keep the Diff Tight

- Work from the current branch diff.
- Remove changes that are not strictly required.
- Do not broaden the change set with unrelated cleanup.
- Preserve public behavior unless the user explicitly asked for a behavior change.
- Preserve the existing package boundaries between `packages/client`, `packages/server`, and `examples/react`.

### Minimize State

- Reduce the number of valid states the code can be in.
- Prefer required fields over optional fields when callers always provide them.
- Remove arguments, flags, and branches that are not strictly required.
- Do not pass override bags or configuration objects unless multiple call sites clearly need them.
- Do not preserve invalid states with extra fallback behavior unless the user explicitly asks for resiliency.

### Prefer Explicit State Shapes

- Use discriminated unions when they make UI or request state materially simpler.
- Replace boolean combinations and partially optional objects with one explicit tagged state when that reduces ambiguity.
- Handle known variants exhaustively.
- Fail on unknown variants instead of silently accepting them.

Example:

```ts
type CaptureState =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "ready"; screenshot: string };

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

function getStatusLabel(state: CaptureState): string {
  switch (state.kind) {
    case "idle":
      return "Idle";
    case "capturing":
      return "Capturing";
    case "ready":
      return state.screenshot;
    default:
      return assertNever(state);
  }
}
```

### Use Assertions at Boundaries

- Trust types inside the main code path.
- When crossing a boundary like request parsing, DOM lookups, plugin output, or event decoding, assert what must be true.
- Prefer explicit assertions over silent defaults that hide bad data.
- Do not add try/catch around expected success paths.

### Prefer Local Simplicity

- Use early returns to flatten nested conditionals.
- Keep event handling, route guards, and queue logic easy to follow from top to bottom.
- Extract a helper only when it removes real duplication or clearly improves readability.
- Do not split straightforward flows into many wrappers.

### Be Opinionated About Parameters

- Keep argument counts low.
- Pass the smallest useful shape.
- Remove optional parameters that are effectively required.
- Inline tiny plumbing when that makes the call path easier to scan.
- Avoid new extension hooks unless they are justified by more than one concrete caller.

## Snapfeed Repository Fit

### Follow Local Style

- Match Biome formatting and the repo's existing TypeScript style.
- Use single quotes and the repo's no-semicolon style.
- Prefer descriptive names over short names.
- Keep control flow flat and explicit.
- Reuse the repo's existing explicit interface and sectioned structure style when it helps readability.

### Client Package Guidance

- Prefer direct, readable TypeScript in `packages/client` over abstraction-heavy utility layers.
- Keep overlay, feedback, annotation, queue, adapter, and plugin flows explicit.
- Simplify DOM and event logic with early returns before reaching for reusable frameworks.
- Only introduce tagged state when it clearly reduces branching in UI or capture flow.
- Keep adapter and plugin contracts explicit and stable.

### Server Package Guidance

- Keep Hono route and middleware flow obvious.
- Prefer simple request validation and clear guard clauses.
- Keep query and filter assembly straightforward.
- Do not introduce generic server frameworks or query builders unless the current diff already needs them.
- Preserve API behavior and response shapes.

### Example App Guidance

- Keep `examples/react` code straightforward and demonstrative.
- Avoid abstractions that make the example harder to teach from.
- Preserve the example's job as an end-to-end validation harness, not a production UI system.

### Patterns to Preserve

- Configuration resolution should stay explicit, like the defaults in `packages/client/src/types.ts`.
- Middleware should stay composable and readable, like `packages/server/src/security.ts`.
- Route logic should stay focused and behavior-preserving, like `packages/server/src/routes.ts`.

## Working Style

Apply these steps in order:

1. Review only the files and hunks relevant to the current branch change.
2. Remove unnecessary code, arguments, and branches first.
3. Tighten types so invalid states are impossible or explicit.
4. Flatten control flow with early returns.
5. Replace boolean-driven or partially optional state with a discriminated union only when it reduces complexity.
6. Add assertions where request data, DOM state, or external input crosses into trusted code.
7. Delete fallback paths that only defend against impossible states.
8. Stop once the code is simple and the diff is still focused.

## Strong Preferences

- Prefer direct code over reusable abstractions.
- Prefer explicit branches over generic helper frameworks.
- Prefer required fields over optional fields.
- Prefer one obvious representation of state.
- Prefer failing fast over silently recovering from impossible inputs.
- Prefer one clear function over many tiny wrappers.

## Avoid

- Clever abstractions
- Deeply nested control flow
- Optional parameters that are actually required
- Wide state objects with loosely related fields
- Boolean flags that create invalid combinations
- Default values that hide data issues
- Try/catch around expected success paths
- Unrelated cleanup in the same diff
- Override-heavy APIs
- New helper layers that obscure client overlay or server route flow

## Output Expectations

When using this skill:

- Explain the simplifications in plain language.
- Call out where state or branching was reduced.
- Mention any assertions added at boundaries.
- Mention any exhaustive or unreachable handling that was introduced.
- Say which Snapfeed behavior or API surface was intentionally preserved.
- Keep the implementation minimal.
