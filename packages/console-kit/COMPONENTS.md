# Component catalogue

_Generated from each component's intent declaration. Do not edit by hand._

## Foundations

### StatusDot

The indicator law's state vocabulary: state is a dot, never a word.

- **Use it when:** Any surface naming a session/agent/tool state (running, needs-you, critical, done, idle).
- **Don't use it when:** Magnitude — that is a count (zero renders nothing). Decorating inactive chrome with accent color.
- **Anatomy:** One aria-hidden circle sized by prop, colored by the status token.
- **Variants & states:** running (blue), needs-you (amber), critical (red), done (green), idle (ground)
- **Accessibility:** aria-hidden; the accompanying text names the thing, proximity carries the state.
- **Related:** Kbd
