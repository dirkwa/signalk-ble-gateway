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

SmartSolar MPPT values are published as solar, the Signal K group that defines
leaves for panel power and daily yield:

```text
electrical.solar.<id>.voltage
electrical.solar.<id>.current
electrical.solar.<id>.panelPower
electrical.solar.<id>.yieldToday
electrical.solar.<id>.loadCurrent
```

Yield is published in joules, the Signal K unit for `yieldToday`. The
advertisement carries 0.01 kWh units, which the consumer converts.

Orion Smart DC-DC converters advertise record `0x04`, which carries only
voltages:

```text
electrical.chargers.<id>.voltage
electrical.chargers.<id>.inputVoltage
```

For Issue #1 testing, please compare these values with `victron-ble read` and
report the plugin status, Signal K paths, and any errors. Do not post the
advertisement key. If raw advertisements are needed, mask the MAC address and
share only the payload and RSSI.

Operating state and charger error are published as text alongside the
measurements:

```text
electrical.solar.<id>.chargingMode
electrical.solar.<id>.chargerError
electrical.chargers.<id>.chargingMode
electrical.chargers.<id>.chargerError
```

`chargingMode` is a Signal K schema leaf. `chargerError` is an explicit
extension, as no charger error leaf is defined. Values are the names from the
VE.Direct register list, for example `bulk`, `absorption`, `float`,
`external_control` and `no_error`. A code without a settled meaning is
published as `unknown_<n>` rather than guessed.

Shutdown reason remains diagnostic-only, visible in the web application and
the status API. Unknown record types stay visible as raw data and never
produce guessed measurements.
