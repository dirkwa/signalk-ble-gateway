# Signal K BLE Gateway

An open Victron consumer and deployment reference built on the
[`dirkwa/sensesp-ble-gateway`](https://github.com/dirkwa/sensesp-ble-gateway)
transport for distributed Signal K BLE coverage.

The project deliberately separates transport, Signal K integration, and
manufacturer-specific decoding:

```text
BLE devices -> ESP32 gateway -> official remote gateway HTTP API
            -> Signal K BLE Provider API -> consumer plugins -> Signal K
```

The ESP32 forwards raw BLE advertisements. It does not contain Victron logic,
decryption keys, or Signal K paths. Manufacturer logic runs exclusively in
server-side consumer plugins.

## Current status: 0.2.0 stable

This version requires Signal K Server 2.31 or newer and uses the official BLE
Provider API delivered by PR #2588. The working legacy implementation remains
available as `v0.1.0-rc.1` and on the 0.1 release line.

## Why this project is different

This is a Victron consumer for Signal K's new BLE Provider API, built on the
SensESP BLE Gateway transport and distributed ESP32 BLE gateways. The consumer
subscribes to `app.bleApi` advertisements; it
does not open a local BlueZ adapter, scan `hci0`, or compete with other BLE
plugins for hardware access. Gateways can be placed in separate engine rooms,
cabins, or other areas of a vessel while Signal K receives one unified stream.

The project is therefore complementary to direct local-BLE Victron plugins:
it focuses on remote, multi-gateway coverage and clean separation between BLE
transport and Victron decoding. It is a publicly documented Victron consumer
built specifically around the new Signal K BLE Provider API.

- passive BLE scanning on an ESP32,
- bounded advertisement queues and HTTP batches with retry/backoff,
- authenticated batches to Signal K's built-in remote BLE provider,
- consumer subscription through `app.bleApi`,
- server-side Victron advertisement decryption,
- Lynx Smart BMS decoding,
- Orion XS decoding,
- SmartSolar MPPT decoding,
- Orion Smart DC-DC decoding,
- Orion Signal K output paths verified on a live server,
- provider and consumer lifecycle separation verified,
- automated provider and consumer tests passing,
- ESP32 firmware build passing.

## Victron device support

Support refers to decoded BLE advertisement data and published Signal K
values. Device recognition alone is not considered support.

| Victron family | Record | Status | Signal K output |
| --- | --- | --- | --- |
| Lynx Smart BMS | `0x0A` | Supported and tested | `electrical.batteries.<device-id>` |
| Orion XS | `0x0F` | Supported and tested | `electrical.chargers.<device-id>` |
| SmartSolar MPPT | `0x01` | Decoder verified against the published specification and reference vectors | `electrical.solar.<device-id>` |
| Orion Smart DC-DC | `0x04` | Decoder verified against the published specification and reference vectors | `electrical.chargers.<device-id>` |
| SmartShunt / BMV | `0x02` | Planned; decoder not implemented | — |
| Smart Battery Sense | — | Planned; decoder not implemented | — |
| Other Victron BLE families | — | Not yet assessed | — |

Additional device families will be marked supported only after we have real
advertisement captures, a verified decoder, fixture-based tests, and confirmed
Signal K paths. See the [Victron coverage roadmap](TODO.md#priority-7-expand-victron-ble-coverage)
for the current development order.

Lynx Smart BMS values are published below:

```text
electrical.batteries.<device-id>
```

Because the current Signal K schema has no dedicated DC/DC charger group,
Orion XS values are published as a charger:

```text
electrical.chargers.<device-id>.voltage
electrical.chargers.<device-id>.current
electrical.chargers.<device-id>.inputVoltage
electrical.chargers.<device-id>.inputCurrent
electrical.chargers.<device-id>.chargingMode
electrical.chargers.<device-id>.chargerState
electrical.chargers.<device-id>.chargerError
```

The 0.2.0 release passed a 90-hour endurance run on stable power. The
acceptance record is in
[`docs/test-record-2026-08-22.md`](docs/test-record-2026-08-22.md). A
previously observed brownout was a supply reset, not a firmware stability
failure.

GATT remains outside the advertisement MVP. The gateway WebSocket will be
implemented only when a consumer needs GATT.

## Components

- `firmware/`: project firmware integration using the SensESP BLE Gateway
  transport
- `consumer-plugin/`: Victron decoder and diagnostic web application
- `docs/`: architecture, protocol, operation, testing, and roadmap

## Quick start

1. Install Signal K Server 2.31 or newer.
2. Install and configure `consumer-plugin/` for the Victron devices.
3. Copy `firmware/secrets.example.h` to
   `firmware/include/secrets.h` and enter local credentials.
4. Build and flash the ESP32 from `firmware/`.

Keep the `v0.1.x` installation available for rollback until the 0.2 firmware
has passed the long-duration hardware test.

Detailed installation and acceptance instructions are in
[`docs/15-Operations-and-Diagnostics.md`](docs/15-Operations-and-Diagnostics.md).
The release scope and remaining work are tracked in
[`docs/14-Roadmap.md`](docs/14-Roadmap.md).

## Public discussion

The repository is intentionally public to support architecture and protocol
discussion with the Signal K and marine electronics communities. Please open a
GitHub issue for reproducible defects or design proposals. Never post BLE
decryption keys, Signal K access tokens, Wi-Fi credentials, or vessel-specific
network details.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
