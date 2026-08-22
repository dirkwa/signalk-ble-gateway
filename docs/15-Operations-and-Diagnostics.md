# Operations and diagnostics

The gateway must remain diagnosable and updateable in an engine-room
installation without a permanent USB monitor.

## Prerequisite

Install Signal K Server 2.31 or newer. Earlier releases do not provide the BLE
Provider API required by the firmware and consumer. The consumer deliberately
refuses to start without `app.bleApi`.

## Install the Signal K consumer

On the Signal K host:

```sh
cd /path/to/signalk-ble-gateway/consumer-plugin
npm link
cd ~/.signalk
npm link signalk-victron-ble-consumer
```

Restart Signal K and enable the Victron consumer. Configure every consumer
device with a stable ID, display name, BLE MAC, and
32-character advertisement key. Never copy keys into firmware, logs, issues,
or diagnostic exports.

## Configure and flash the ESP32

```sh
cp firmware/secrets.example.h firmware/include/secrets.h
cd firmware
pio run -e az_delivery_devkit_v4_foundation
pio run -e az_delivery_devkit_v4_foundation -t upload
pio device monitor
```

Fill the local header with Wi-Fi, Signal K address, stable gateway ID, and
separate OTA and web passwords. Perform the first flash over USB. Use OTA only
after board, network, and credentials have been verified.

## Commissioning checklist

1. Enable the consumer and confirm that no BLE API compatibility error appears.
2. Power the ESP32 from a stable supply.
3. Confirm `scanning`, `token=available`, and `start_failures=0` on status.
4. Open Signal K's Data → BLE Manager and confirm the gateway and devices.
5. Open `/signalk-victron-ble-consumer/`.
6. Compare Lynx and Orion values with simultaneous VictronConnect readings.
7. Confirm Orion paths in the Signal K data browser.

Protected routes require an authenticated browser session or bearer token.
Read tokens invisibly in terminal scripts; never place them in shell history.

## Diagnostic layers

### Serial log

Development and first commissioning use ESP-IDF logs over USB/UART. Production
logs report state transitions, warnings, and errors, but not full advertisement
payloads or credentials.

### Authenticated SenseESP status page

The local UI reports firmware/build ID, hostname, uptime, reset reason, current
and minimum heap, Wi-Fi status/RSSI, BLE scan state, token availability,
advertisement counters, queue depth, drops, and POST outcomes.

### BLE Manager and consumer status

- Signal K's BLE Manager reports gateways, providers, devices, RSSI and GATT
  claims.
- `/plugins/signalk-victron-ble-consumer/status` reports configured devices,
  online state, last observation, decode errors, and decoded diagnostics.

The transport prefers `GATEWAY_PROVIDER_TOKEN` from ignored `secrets.h`; it can
fall back to the SenseESP Signal K token. Token values are never logged.

## OTA

```sh
GATEWAY_OTA_HOST=192.0.2.31 \
GATEWAY_OTA_PASSWORD='...' \
pio run -e az_delivery_devkit_v4_foundation_ota -t upload
```

Test updates on an accessible device first. A failed update must not remove the
physical USB recovery path.

## Recovery behavior

Transient failures use bounded retry/backoff, network reconnection, component
reinitialization, and only then a controlled restart. An offline server must
not create a reboot loop. Every automatic reset needs a visible reason.

## 0.1.0 endurance acceptance

Run at least 24 hours on stable power. At completion:

- uptime covers the complete observation period,
- no brownout or unexpected reset occurred,
- BLE remains `scanning`,
- `scan_start_failures = 0`,
- `dropped` does not increase while Signal K and WLAN are continuously
  available,
- every increase is attributable to `drop_queue`, `drop_lock`, or
  `drop_invalid`,
- `pending` repeatedly returns to zero or a small value,
- `delivered` continues to follow `received`,
- minimum heap does not trend downward.

A shorter uptime or `Brownout` reset reason fails this test. A deliberately
bounded queue is not expected to retain every BLE observation through a long
server or WLAN outage. Such an outage passes recovery testing only when losses
are visible and categorized, the retained in-flight batch is retried, and the
queue drains after connectivity returns. Do not combine those expected outage
losses with the steady-state zero-drop criterion.

Record `Gateway build` as well as the semantic firmware version. A version
without a source revision is insufficient acceptance evidence.

## Server outage test

1. Record gateway and consumer counters.
2. Stop the Signal K server.
3. Confirm the firmware retains its in-flight batch and increments failures.
4. Confirm consumer timestamps stop while the firmware queue and POST-failure
   counters respond as designed.
5. Restart Signal K.
6. Confirm queue recovery and resumed delivery.
7. Confirm repeated values do not create incorrect Signal K state.

## Upgrade and rollback

Keep the working 0.1 firmware and plugins available until the 0.2 deployment
has passed the endurance test. Rollback consists of disabling the 0.2 consumer,
flashing the 0.1 firmware, and re-enabling the 0.1 gateway provider.

## npm publication

The stable consumer is published by GitHub Actions from a release tag matching
`vMAJOR.MINOR.PATCH`. The workflow runs the consumer tests and publishes
`consumer-plugin/` with npm provenance. Before the first publication, configure
the npm package's Trusted Publisher for this GitHub repository and the
`publish-consumer.yml` workflow. No long-lived npm token is stored in GitHub.

To publish version `0.2.1`, push the matching tag after committing the version
change:

```sh
git tag v0.2.1
git push origin v0.2.1
```

## Acceptance record

Record date, firmware version, plugin commit, gateway ID, supply, duration,
reset reason, minimum heap, and final counters. Track deviations as roadmap
items rather than replacing evidence with a generic "works" statement.
