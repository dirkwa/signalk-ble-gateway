# Announcement draft: distributed Victron BLE for Signal K

## Short version

`signalk-victron-ble-consumer@0.2.0` is now available on npm.

It is a Victron consumer for Signal K's official BLE Provider API. Victron BLE
advertisements are received through distributed ESP32 gateways and consumed via
`app.bleApi`, so the consumer does not need direct access to a local BlueZ
adapter. This makes it possible to cover separate engine rooms, cabins, or
other compartments while keeping one unified Signal K data stream.

## Community post

We have released `signalk-victron-ble-consumer@0.2.0`, a Victron BLE consumer
for Signal K Server 2.31 or newer.

The project combines three pieces:

- the [`dirkwa/sensesp-ble-gateway`](https://github.com/dirkwa/sensesp-ble-gateway)
  SensESP transport for distributed ESP32 BLE coverage;
- Signal K's official BLE Provider API and `app.bleApi` advertisement stream;
- a server-side Victron consumer that decrypts configured Instant Readout
  advertisements and publishes Signal K battery and charger paths.

The consumer does not open a local BlueZ adapter or scan `hci0`. Multiple
consumers can share the same BLE stream, and gateways can be placed near the
devices they receive through bulkheads or other obstructions.

The current release includes tested support for Victron Lynx Smart BMS and
Orion XS Instant Readout data. The architecture is ready for additional
device-family parsers, but new support will be added only with real captures,
device keys, and reference values from VictronConnect.

The gateway and consumer passed a 90-hour hardware endurance run with stable
power. The acceptance record is available in the repository.

Install the consumer from the Signal K AppStore or npm, configure the
advertisement key for each device, and run it with a Signal K BLE Provider. See
the project README for the gateway setup and operational requirements.

Project: https://github.com/haipule/signalk-ble-gateway
Package: https://www.npmjs.com/package/signalk-victron-ble-consumer
Release: https://github.com/haipule/signalk-ble-gateway/releases/tag/v0.2.0

We are looking for users with other Victron BLE devices who can provide
anonymized advertisement captures and corresponding VictronConnect values for
 parser development and validation. Never share encryption keys, tokens, or
 vessel-specific network details publicly.
