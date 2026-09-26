# Security

## Reporting

Do not open a public issue for a vulnerability. Report it privately to the
repository owner through GitHub's private vulnerability reporting on this
repository, or by direct message. Include the affected path, a reproduction, and
the impact you believe it has.

## What this repository holds

- **No credentials in git.** `.env` is ignored; `.env.example` contains no real
  values. The committed key is the shape of the config, not its secrets.
- **Third-party credentials stay local.** Research, LLM, stock-footage and
  publishing tokens are read from the environment only, and a missing one
  disables the integration rather than falling back to something permissive.
- **Private repository.** Nothing here is licensed for redistribution.

## Handling secrets

If a token is ever committed by accident, treat it as compromised: revoke it at
the provider first, then remove it from history. Rewriting history does not
un-leak a token that was pushed.

## Content integrity

This project generates health-adjacent material. Two properties are treated as
security properties rather than quality properties:

- **Evidence is not optional.** A claim without supporting evidence, or one that
  states more than its evidence supports, must fail the gate rather than ship.
- **Disclosure is not optional.** Rendered video carries a synthetic-media
  disclosure and the full legal disclaimer. The disclaimer is never truncated to
  fit a frame.

A change that weakens either gate is a security change, and needs the same
review as an authentication change.
