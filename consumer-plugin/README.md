# Signal K Victron BLE Consumer

This standalone consumer receives generic advertisement events from the
gateway provider, selects configured Victron devices, and decrypts Instant
Readout data exclusively on the Signal K server.

It requires Signal K Server 2.31 or newer, which provides the official BLE
Provider API.

This consumer is designed for the new Signal K BLE Provider API and the
SensESP BLE Gateway transport. It receives
Victron advertisements through `app.bleApi`, including advertisements supplied
by remote ESP32 gateways, instead of opening a local BlueZ adapter itself. This
allows several consumers to share one BLE stream and supports coverage across
multiple vessel compartments.

## Installation

Install `signalk-victron-ble-consumer` from the Signal K AppStore, then enable
and configure it under **Server > Plugin Config**. The MPPT test build is
`0.2.2-mppt.0`; it is a development build and is not yet an AppStore release.

To test the MPPT build directly on a Signal K server:

```sh
npm install https://github.com/haipule/signalk-ble-gateway/archive/refs/heads/feat/victron-mppt-support.tar.gz
```

If installing from a checkout, use `npm link` as described below. Restart
Signal K after installation, enable the plugin, and configure the MPPT with
its 32-character Victron advertisement key. The plugin requires the official
Signal K BLE Provider API and a provider that supplies the advertisements.

## Development installation

```sh
cd consumer-plugin
npm link
cd ~/.signalk
npm link signalk-victron-ble-consumer
```

Restart Signal K, enable the plugin, and configure each device with a stable
ID, display name, BLE MAC address, and 32-character advertisement key. The
gateway provider must be enabled at the same time.

The diagnostic web application is available at:

```text
http://SIGNALK-SERVER:3000/signalk-victron-ble-consumer/
```

Keys are never returned by the status API or web application.

Lynx Smart BMS voltage, current, state of charge, time remaining, and
temperature are published below `electrical.batteries.<id>`. The web
application additionally shows consumed capacity, BMS error, I/O status, and
warning/alarm bit fields.

Orion XS is published as a charger:

```text
electrical.chargers.<id>.voltage
electrical.chargers.<id>.current
electrical.chargers.<id>.inputVoltage
electrical.chargers.<id>.inputCurrent
```

SmartSolar MPPT values are also published as a charger:

```text
electrical.chargers.<id>.voltage
electrical.chargers.<id>.current
electrical.chargers.<id>.power
electrical.chargers.<id>.energy
```

For Issue #1 testing, please compare these values with `victron-ble read` and
report the plugin status, Signal K paths, and any errors. Do not post the
advertisement key. If raw advertisements are needed, mask the MAC address and
share only the payload and RSSI.

State, error code, and shutdown reason remain diagnostic-only. Unknown record
types stay visible as raw data and never produce guessed measurements.
