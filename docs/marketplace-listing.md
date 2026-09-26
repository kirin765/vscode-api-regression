# Marketplace listing

Internal working copy of the Marketplace listing. Not shipped in the VSIX.
Confirm every `[ ]` item in a signed-in browser before publishing.

## Identity

- Extension name (`package.json` `name`): `api-regression`
- Display name: **API Regression**
- Fish Food required? If publishing under the shared `botmaker` publisher, leave
  `publisher` alone. Verify the publisher id and name are not taken:
  - [ ] https://marketplace.visualstudio.com/manage
  - [ ] Search `api-regression` and `json response diff` in the Marketplace UI
        (the search page is JS-rendered; a browser check is required).
- [ ] Confirm the Marketplace display-name field is not already in use.

## Short description (≤ 200 chars, shown in search)

> Save a JSON response baseline, rerun your API after a code change, and see
> exactly what changed — with explicit ignore, redaction and array-match rules.

## Long description

Start from this, then keep it consistent with `README.md` (the README is the
listing body unless a separate `description` is set).

### Heading

**See what changed in your API responses after a code change.**

### Body

Backend developers rerun the same JSON endpoints constantly during refactors,
dependency upgrades and environment changes. API Regression saves a reviewed
response baseline, reruns your GET endpoint, and shows a meaningful,
structured diff.

- **Capture → rerun → review** — a saved baseline, a native VS Code diff, and
  an explicit decision to replace the baseline.
- **Explicit rules, not magic** — ignore JSON Pointer paths (with `*`), redact
  secrets, and match array items by key. Ignored paths are listed so a "match"
  is never misleading.
- **Honest diffs** — object key order is ignored, array order is preserved,
  missing vs `null` vs `""` are distinct, and large numbers are compared as
  exact decimals (no silent rounding).
- **Local and private** — credentials live in VS Code SecretStorage, scoped to
  your workspace, profile and destination origin. No data is sent to us.
- **Safe by default** — requests never run on install, open, config change or
  save. Workspace Trust is required, and every run confirms the resolved URL
  and origin first. Redirects are not followed.

Example: the baseline has `price: 19.99`; the new response has
`price: "19.99"`. API Regression reports a number-to-string change while
ignoring the `updatedAt` field you configured.

> API Regression reports observed differences. A changed response is not
> necessarily a breaking change, and an unchanged response does not prove the
> API is correct.

**This version** supports GET requests returning JSON, no-auth / bearer /
API-key header auth, and local filesystem workspaces. See the README for the
full list of what is not yet supported.

## Pricing and trial (Marketplace metadata)

- [ ] Set the Marketplace trial label for a 14-day free trial.
- [ ] Publish the price: **one-time $29 individual license for the current
      major version**, following the 14-day trial.
- [ ] State update terms exactly as in `docs/support.md`: minor/patch updates
      within the major version are free; a future major version may be a
      separate purchase; this is not a subscription.
- The client-side trial and offline signed-license verification are already
  implemented. Real checkout/license issuance is **not** built yet — you cannot
  take a payment and hand out a key until that exists. Do not publish a paid
  listing before it does.

## Assets to capture from the smoke test

- [ ] A short GIF or 3 screenshots:
  1. API Regression view with a saved baseline.
  2. The native diff showing the `number → string` price change with
     `updatedAt` absent (ignored).
  3. The redacted Markdown report.
- [ ] Icon: `media/icon.png` (128×128) is used. Replace with a polished asset
      before a paid listing.

## Pre-publish checklist

- [ ] `npm run verify` passes.
- [ ] `npm run test:host` passes.
- [ ] `npx vsce package --no-dependencies` produces a VSIX with **no**
      `.secrets/`, source maps, `src/`, `test/`, `fixtures/` or `tools/`.
- [ ] No credentials, tokens or real response bodies appear in the VSIX,
      README, docs or listing text.
- [ ] `LICENSE`, `docs/privacy.md`, `docs/support.md`, `docs/licensing.md`
      are accurate and linked from the README.
- [ ] Version bumped in `package.json` and recorded in `CHANGELOG.md`.
- [ ] `plan.md` section 9 observation window is dated before publishing.

## Search phrases to test after publishing

Measure these manually in the Marketplace UI; volumes are unmeasured.

- `API regression`
- `JSON response diff`
- `API snapshot`
- `response baseline`
