# VS Code API Regression — implementation plan

Created: 2026-09-25  
Project directory: `/home/giwan/Projects/vscode-api-regression`  
Owner: Giwan  
Status: planning complete; implementation not started  
Working name: API Regression. Check Marketplace name/publisher availability before submission.

## 1. Product and buyer

A VS Code extension for backend developers who repeatedly check the same JSON endpoints after refactors, dependency upgrades or environment changes.

**Promise:** Save an API response baseline, rerun the endpoint, and inspect meaningful differences using explicit comparison rules.

Example: the baseline has `price: 19.99`; the new response has `price: "19.99"`. Report a number-to-string change while ignoring a user-selected `updatedAt` field.

The extension reports observed differences. A changed response is not necessarily a breaking change, and an unchanged response does not prove the API is correct.

## 2. Evidence and commercial hypothesis

See the [candidate assessment](../llm-wiki/reports/vscode-first-extension-candidates-2026-09-25.md). A small team explicitly reports paying for Thunder Client, but that is payment for a broader API client. API Hero already offers response comparison. Our exact offer's demand, acquisition and willingness to pay remain unmeasured.

The offer hypothesis is a focused baseline → rerun → review workflow with persistent rules, understandable differences and local data handling. Do not claim that response comparison is new or that our workflow is easier before testing it.

Proposed price: **$29 per individual for the current major version**, following a 14-day trial. Continued use of the purchased version remains available; future major upgrades may be separate purchases. Document support/update terms before selling. Price is a test hypothesis, not established WTP. This is not recurring subscription revenue.

## 3. MVP user flow

1. Open a trusted local workspace and create an API Regression configuration.
2. Add a named GET endpoint, environment base URL and optional credential reference.
3. Run the endpoint explicitly. Preview the response and choose redaction/ignore rules.
4. Save the reviewed baseline locally.
5. Change application code, then rerun that endpoint or a small selected group.
6. Inspect status and JSON differences; export a redacted Markdown report if needed.
7. Accept a replacement baseline only through an explicit action after reviewing the changes.

Never execute requests on installation, workspace open, config changes or file saves. Show the resolved environment and destination before execution. GET requests can still have server-side effects; do not describe execution as universally read-only.

## 4. MVP scope

### Included

- TypeScript desktop VS Code extension, initially for local filesystem workspaces.
- Named HTTP/HTTPS GET endpoints returning JSON; no-auth, bearer token and API-key header modes.
- Named environments with explicit endpoint identity and baseline selection.
- Baseline capture, rerun, structured diff, ignore rules, redaction and explicit baseline replacement.
- Small batch execution with progress, cancellation and individual results.
- Saved configuration and baselines; Markdown difference report.
- Trial/license state with clear terms and continued access to user-owned baseline/report files.

### Deferred

POST/PUT/PATCH/DELETE, OAuth login flows, cookies, arbitrary scripts, general `.http`/Postman import, GraphQL/gRPC/WebSockets, cloud sync, team dashboards, scheduled monitoring, CI runners, browser VS Code, remote/WSL support claims, AI explanations and custom certificate/proxy configuration.

Do not grow the MVP into a full API client. Explicitly unsupported environments should produce a clear message rather than silently executing somewhere unexpected.

## 5. Comparison semantics

- Compare HTTP status and parsed JSON. Transport errors, invalid JSON, timeouts and oversized responses are execution failures, not ordinary response differences or successful matches.
- Ignore object key order. Preserve array order by default; do not globally sort arrays.
- Distinguish missing values, `null`, empty strings, numeric values and numeric strings. Use a parser/comparison strategy that does not silently round large JSON numbers; reject unsupported numeric cases if necessary.
- Use explicit JSON Pointer-style paths for ignored values. MVP rules have no arbitrary expressions or executable code. Validate paths and show which fields each rule affects.
- Optional array matching uses a configured key within a specified array. Missing or duplicate keys make that comparison ambiguous and must be reported, not silently paired.
- Report added, removed, type-changed and value-changed paths with bounded previews and summary counts.
- Keep redaction separate from ignores: redaction prevents values being displayed/persisted; ignore rules remove a field from comparison. Show excluded paths so a match is not misleading.
- Baselines carry endpoint ID, source environment, capture time, comparison/redaction rule version and schema version. A cross-environment comparison must be explicit.
- Configuration or rule changes cannot silently reinterpret a baseline. Require review/re-capture when incompatible, and record any comparison exclusions.

## 6. Technical direction

Scaffold from the current official TypeScript extension template. Use the existing mise-managed tools, choose a compatible project runtime pin, retain the generated lockfile and select a minimum supported VS Code version based on APIs actually used. The local Node version is not the extension host's runtime guarantee. [Official starter guide](https://code.visualstudio.com/api/get-started/your-first-extension).

Proposed modules:

| Module | Responsibility |
|---|---|
| `config` | Validate versioned JSON config, endpoint/environment identity and rule definitions |
| `runner` | Resolve one explicit request, enforce bounds, cancellation and credential handling |
| `snapshot` | Redact, preview, store and load immutable baseline data |
| `compare` | Pure deterministic JSON comparison and rule application |
| `report` | Bounded redacted result models, native diff documents and Markdown export |
| `extension` | Commands, quick picks, result tree, progress and storage adapters |
| `licensing` | Trial and verified paid entitlement; no API data sent to licensing service |

Prefer native commands, a tree view and virtual diff documents first. Add a webview only if structured comparison cannot be presented clearly with native surfaces.

### Storage and credentials

- Proposed workspace config: `.api-regression/config.json`, containing endpoint definitions and references to secrets, never actual credentials.
- Keep baselines in extension-managed workspace storage by default. Export redacted baselines into the repository only through an explicit action; local does not mean safe to commit.
- Store credentials using VS Code SecretStorage, scoped in our key naming to workspace, environment, endpoint/auth profile and destination origin. Verify the exact API at implementation time.
- Never persist authorization headers, raw secrets, cookies or unreviewed raw responses in logs/reports. Automatic token masking is best-effort; the capture preview must make persisted data visible to the user.
- Request configuration must not evaluate JavaScript, run shell commands, or load executable workspace modules.
- Require Workspace Trust for network execution and workspace-config processing; enforce it at command execution, not only in menu visibility. [Trust guidance](https://code.visualstudio.com/api/extension-guides/workspace-trust).

### Network and reliability

- Proposed initial bounds: 10 endpoints per batch, sequential execution, 15-second request timeout and 2 MiB decoded response limit. Measure and revise these explicitly before release.
- Do not follow redirects automatically in MVP. Show the target/status, especially when credentials would cross origins. Keep TLS verification enabled.
- Restrict the runner to HTTP/HTTPS URLs and avoid sending secret headers to a different destination after a config change without explicit reassociation.
- Cancellation stops pending work and aborts the current request where supported. A failed/cancelled run never overwrites a baseline.
- Baseline writes are atomic where supported, with conflict detection if another operation updated the baseline. Explicit replacement is separate from comparison.
- Cap diff/report output and provide a clear truncation notice rather than freezing the editor or claiming a complete report.

## 7. Implementation checkpoints

| Phase | Deliverable | Completion check |
|---|---|---|
| A — first 2 working hours | Extension shell, synthetic local API, one baseline and comparison | Timestamp ignored; number-to-string change detected and displayed in VS Code |
| B — useful workflow | Validated config, environments, credentials, preview, persistent baselines and reports | Fresh user completes capture → rerun → review without editing extension code |
| C — release MVP | Batch bounds, failure handling, trust controls, trial/license integration | Failure/cancellation leaves baselines intact; no credential leakage; paid states work in test mode |
| D — package | VSIX, README, demo, privacy/support/license pages and listing | Fresh installation passes the advertised flow; package contains no secrets or development artifacts |

**Proposed engineering cap: 12 total working hours including Phase A, with no new paid services.** This is a feasibility/MVP cap, not a promised release date. At the cap, record completed work and blockers, then explicitly re-scope further work.

Before implementation begins, record actual start/stop dates, owner and cap in the decision ledger's `wiki/inbox.md`. This task creates the project plan only; it does not start an unattended build or publication.

## 8. Verification

- Pure comparator tests: reordered object keys, missing versus null, type changes, arrays by order/key, duplicate array keys, ignored paths, redaction and large numeric values.
- Synthetic local API tests: changing status, malformed/non-JSON responses, timeout, response limit, redirects, cancellation and authentication. No production endpoints needed.
- Persistence tests: fresh capture, restart, explicit replacement, interrupted write, conflicting updates and config/rule version mismatch.
- Security checks: untrusted workspace blocks execution; changed origins cannot inherit credentials silently; reports, storage, logs and package are free of test secrets.
- Extension-host tests: command registration, capture/rerun/diff flow, environment selection, empty states and filesystem errors.
- License tests: trial start/end, valid/invalid entitlement, interrupted activation, refund/revocation and documented offline behavior. Payment verification belongs on a backend or signed-license mechanism; client flags alone are insufficient.
- Run typecheck, lint, focused tests, build and VSIX inspection after implementation. No application tests are needed for this planning-only change.

## 9. Marketplace release and learning

Use one Marketplace listing showing a concrete baseline → API change → meaningful difference example. Candidate search phrases: “API regression”, “JSON response diff”, “API snapshot”. Search volume, listing rank and organic acquisition are unmeasured.

The extension needs its own checkout/license flow. Use the appropriate Marketplace trial label, clearly disclose pricing and implement the current publisher/package requirements. [Official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension). Publishing does not establish customer reach.

Before launch, write a dated observation window and spending/support cap. Proposed initial window: 14 days after publication, up to two hours of measurement/support and no advertising spend. Measure available listing views → installs → completed first comparison → repeat comparisons → price exposure → paid transactions. Respect VS Code telemetry settings and avoid collecting endpoint URLs, request/response contents, workspace paths or secrets. Unavailable denominators stay unknown.

A first independent payment is a learning signal, not repeatable economics. At the cap, separate no observed reach, activation failure and exposed users declining the offer. Record the result before further investment. Do not require interviews before a bounded build, or silently continue because evidence is incomplete.

Before sustained expansion, model new licenses/month × net price minus hosting/payment/refund/support costs. One-time sales require continued acquisition to sustain income; they are not MRR. State exchange-rate and tax assumptions when evaluating the owner's ₩2m/month income objective.

## 10. Current checklist

- [x] Create project directory and `plan.md`.
- [ ] Record dated implementation timebox.
- [x] Scaffold extension and synthetic local API fixture.
- [x] Complete Phase A baseline/diff checkpoint.
- [x] Implement and test the bounded workflow.
- [x] Prepare licensing, VSIX and Marketplace materials.
- [ ] Record launch experiment and publish.
- [ ] Evaluate reach, repeat use, payments and support at the cap.

**Next action:** prove one local JSON endpoint → reviewed baseline → changed response → useful VS Code diff.

## 11. Implementation status (2026-09-26)

Built through Phase D in code. Verification commands and current results:

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | passes |
| Lint | `npm run lint` | passes |
| Unit + fixture integration | `npm test` | 98 tests pass (10 files) |
| Extension host | `npm run test:host` | 5 tests pass |
| Bundle | `npm run package` | `dist/extension.js` ~61 kB |
| VSIX | `npx vsce package --no-dependencies` | 12 files, no secrets/dev artifacts |

Delivered modules match section 6: `config`, `runner`, `snapshot`, `compare`,
`report`, `extension`, `licensing`, plus `json` primitives. Highlights:

- Exact-decimal number comparison (large integers are not rounded).
- Workspace-Trust gate enforced at command execution; requests only run after an
  explicit confirmation showing the resolved URL and origin.
- Credentials in SecretStorage scoped to workspace + profile + origin; a changed
  origin cannot silently inherit a credential.
- Redirects refused, timeout/size bounds enforced, cancellation aborts in flight.
- Atomic baseline writes with etag conflict detection; rules changes cannot
  silently reinterpret a baseline.
- Offline Ed25519 signed-license verification with a 14-day trial.

Not yet done (outside code): Marketplace listing, checkout/license issuance for
real buyers, and the dated launch/observation experiment.

