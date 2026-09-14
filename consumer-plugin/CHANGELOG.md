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

- Add SmartSolar MPPT Instant Readout support (record type `0x01`), decoded to
  the published Victron "Extra manufacturer data" specification and verified
  against the victron-ble reference vectors.
- Publish MPPT measurements below `electrical.solar.<id>`, which defines
  leaves for panel power, daily yield and load current. `electrical.chargers`
  has no such leaves.
- Convert yield today from the advertised 0.01 kWh to joules, the Signal K
  unit for `yieldToday`.
- Add Orion Smart DC-DC converter support (record type `0x04`), publishing
  output and input voltage. This record is distinct from the Orion XS record
  `0x0F` and has a different layout.
- Publish nothing for record types without a verified decoder. Previously an
  unrecognized record fell through to the Lynx battery paths, which could
  publish another device's measurements below `electrical.batteries`.
- Publish operating state and charger error as text for both the solar and
  charger groups. These were previously diagnostic-only. `chargingMode` is a
  Signal K schema leaf with an enumerated vocabulary, so VE.Direct states are
  mapped onto it: `absorption` becomes `acceptance`, and a state without a
  Signal K equivalent becomes `other`. `chargerState` and `chargerError` are
  explicit extensions carrying the exact VE.Direct names, as the schema
  defines no leaf for either.
- Name the VE.Direct device states and the charger error codes that have a
  settled meaning. A live SmartSolar MPPT reported state 252, which is
  `external_control` and previously decoded as `unknown_252`.
- Add test instructions for GitHub issue #1.
- Decode the remaining record types with a published layout: battery monitor
  (`0x02`, SmartShunt and BMV), inverter (`0x03`), SmartLithium (`0x05`),
  Inverter RS (`0x06`), Smart Battery Protect (`0x09`), Multi RS (`0x0B`),
  VE.Bus (`0x0C`) and DC energy meter (`0x0D`). These are decoded from the
  specification without hardware and are documented as untested.
- Publish the battery monitor and SmartLithium below
  `electrical.batteries.<id>`, and the inverter records below
  `electrical.inverters.<id>`. Records `0x09`, `0x0B`, `0x0C` and `0x0D`
  decode but publish nothing, as Signal K has no matching group.
- Resolve the auxiliary field of records `0x02` and `0x0D` through its 2-bit
  selector, returning only the reading the device actually sent.
- Leave records `0x07` and `0x08` unimplemented; the specification marks both
  layouts undetermined.
