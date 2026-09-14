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

To test the MPPT build directly on a Signal K server, install from the
`consumer-plugin` directory of a checkout. The package manifest lives there,
not at the repository root, so a branch archive URL cannot be installed
directly.

```sh
git clone -b feat/victron-mppt-support https://github.com/dirkwa/signalk-ble-gateway.git
cd ~/.signalk
npm install /path/to/signalk-ble-gateway/consumer-plugin
```

Restart Signal K after installation, enable the plugin, and configure each
device with its 32-character Victron advertisement key. The plugin requires
the official Signal K BLE Provider API and a provider that supplies the
advertisements.

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
electrical.solar.<id>.chargerState
electrical.solar.<id>.chargerError
electrical.chargers.<id>.chargingMode
electrical.chargers.<id>.chargerState
electrical.chargers.<id>.chargerError
```

`chargingMode` is a Signal K schema leaf with an enumerated vocabulary:
`bulk`, `acceptance`, `overcharge`, `float`, `equalize`, `unknown` or `other`.
VE.Direct states do not map one to one, so Victron's `absorption` is published
as `acceptance`, and a state with no Signal K equivalent, such as
`external_control`, is published as `other`.

`chargerState` and `chargerError` are explicit extensions, as the schema
defines no leaf for either. They carry the exact VE.Direct names, for example
`bulk`, `absorption`, `float`, `external_control` and `no_error`, so the
precise device state is preserved. A code without a settled meaning is
published as `unknown_<n>` rather than guessed.

Shutdown reason remains diagnostic-only, visible in the web application and
the status API. Unknown record types stay visible as raw data and never
produce guessed measurements.

## Records decoded from the specification but not yet tested

The following records are decoded from the published Victron "Extra
manufacturer data" specification, with tests built from the documented
layouts. No hardware was available, so their values are unverified.

```text
0x02  battery monitor   SmartShunt, BMV   -> electrical.batteries.<id>
0x03  inverter          Phoenix           -> electrical.inverters.<id>
0x05  SmartLithium                        -> electrical.batteries.<id>
0x06  Inverter RS                         -> electrical.inverters.<id>
0x09  Smart Battery Protect               -> diagnostic only
0x0B  Multi RS                            -> diagnostic only
0x0C  VE.Bus                              -> diagnostic only
0x0D  DC energy meter                     -> diagnostic only
```

The battery monitor and DC energy meter records carry a 16-bit auxiliary field
whose meaning depends on a 2-bit selector stored after it: starter voltage,
mid-point voltage, or temperature. Only the selected reading is returned; the
others are null, because the same bits mean different things per device
configuration. Starter and mid-point voltage have no Signal K leaf, so they
appear in the status API only. The DC energy meter has no mid-point reading,
so that selector is rejected for it rather than producing a value the record
does not carry.

SmartLithium cell voltages are reported as a bound and a voltage, because the
specification defines the two end values as thresholds rather than
measurements:

```text
{ bound: 'below', voltage_v: 2.61 }   cell is under 2.61 V, no lower bound given
{ bound: 'exact', voltage_v: 3.25 }   a measurement
{ bound: 'above', voltage_v: 3.85 }   cell is over 3.85 V, no upper bound given
null                                  not available
```

An unavailable cell keeps its position in the list, so cell numbering stays
meaningful when one reading is missing.

Records `0x07` and `0x08` are not implemented. The specification marks both
layouts as still to be determined and subject to change, so decoding them
would be guesswork.

If you have any of these devices, please compare the plugin values with
VictronConnect and report the result. Do not post advertisement keys, and mask
MAC addresses in any capture you share.
