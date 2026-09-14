# Changelog

## 0.2.1

- Add a generic Victron BLE energy-and-radio pictogram to the WebApp favicon,
  manifest, and header.

## 0.2.0

- Promote the official Signal K BLE Provider API consumer to stable after the
  completed long-duration gateway acceptance test.
- Confirm stable operation on Signal K Server 2.31 or newer.
- Published to npm on 2026-08-22 via GitHub Actions Trusted Publishing from
  tag `v0.2.0` (workflow run `32600878628`, attempt 2).
- npm package shasum: `272adee08a5d78c153e3ff31eee13e31d3ea48a0`.

## 0.2.0-beta.1

- Subscribe to the official Signal K BLE Provider API introduced in Signal K
  Server 2.31.
- Decrypt and decode configured Victron Lynx Smart BMS advertisements.
- Decode observed Victron Orion XS Instant Readout advertisements.
- Publish validated battery and charger measurements as Signal K deltas.
- Provide a protected diagnostic web application without exposing encryption
  keys.
## 0.2.2-mppt.0

- Add experimental SmartSolar MPPT Instant Readout support (record type `0x01`).
- Publish battery voltage/current, solar power, and today's yield.
- Add test instructions for GitHub issue #1.
