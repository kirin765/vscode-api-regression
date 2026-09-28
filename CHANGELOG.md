# Changelog

## 0.1.1

- First public Marketplace release under the `kirin765` publisher.

## 0.1.0

Initial MVP.

- Capture a reviewed, redacted JSON baseline for named GET endpoints.
- Rerun and compare status + parsed JSON in a native VS Code diff.
- Comparison rules: JSON Pointer ignores with `*` wildcards, redaction, array matching by key.
- Exact decimal number comparison — large integers are not rounded.
- Added / removed / type-changed / value-changed entries with bounded previews and summary counts.
- Batch runs with progress, cancellation and per-endpoint results.
- Redacted Markdown report export; explicit baseline export and replacement.
- Credentials in VS Code SecretStorage, scoped to workspace, profile and origin.
- Workspace Trust gate, redirect refusal, response size/timeout bounds.
- 14-day trial and offline signed-license verification.
