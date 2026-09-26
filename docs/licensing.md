# Licensing

API Regression includes a **14-day trial**. No account is required and no API data is sent to a licensing service — verification happens offline in the extension.

## How verification works

A license key is an Ed25519-signed token in the format:

```
AR1.<base64url(payload JSON)>.<base64url(signature)>
```

The payload:

```json
{
  "v": 1,
  "product": "api-regression",
  "serial": "AR-2026-000123",
  "email": "buyer@example.com",
  "kind": "perpetual",
  "majorVersion": 0,
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

The extension verifies the signature against an **embedded public key** (`src/licensing/publicKey.ts`), then checks the product, optional expiry, revocation list and major version. The private key never ships in the extension.

## Trial behaviour

- The trial starts only when you explicitly choose **Start Trial** (or the first gated action).
- The start timestamp is stored in VS Code global state. It is local to the machine/profile.
- After 14 days, network execution is gated until a license is entered. Your baseline and report **files remain readable** — licensing never locks you out of data you own.

## Client limitations

Client-side flags alone can be reset by a determined user. This implementation is a reasonable, honest gate for a low-price tool, not tamper-proof DRM. Payment verification belongs on the issuing backend; use signed licenses plus a revocation list for refunds or chargebacks.

## Issuing licenses (publisher)

Generate a production key pair and keep the private key offline:

```bash
node tools/gen-keys.mjs        # writes .secrets/ and prints the public key
```

1. Replace `LICENSE_PUBLIC_KEY_PEM` in `src/licensing/publicKey.ts` with the production public key.
2. Set `LICENSE_MAJOR_VERSION` to match your release.
3. Issue a key with `tools/issue-license.mjs` (see the script header) or your own backend.
4. Distribute the key by email after purchase.

To revoke a serial, add it to the revocation list (see `LicenseManager.revoke`).
