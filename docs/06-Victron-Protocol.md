# Victron BLE protocol

Victron advertisements are decrypted and decoded exclusively by a server-side
consumer. The ESP32 forwards device address, generic metadata, and raw payload;
it does not know Victron devices or keys.

Device MAC addresses and advertisement keys belong in consumer configuration.
They must never appear in firmware headers, binaries, or gateway-provider
configuration. Passive Instant Readout advertisements require no GATT session.

## Instant Readout envelope

The consumer extracts manufacturer data with company ID `0x02E1`, followed by
the product-advertisement header `0x10 0x00`, 16-bit model ID, record type,
16-bit nonce/data counter, the first advertisement-key byte as a quick check,
and the AES-128-CTR encrypted record.

The counter is written little-endian into the 128-bit CTR block. Record layouts
are implemented only with reproducible test vectors before values are mapped to
Signal K.

The published Victron specification names Lynx fields `VE_REG_BMS_IO` and
`VE_REG_BMS_WARNINGS_ALARMS` but does not document their internal bit layout.
The web application therefore displays both as raw hexadecimal values and does
not invent bit meanings.

## Record layouts and the published specification

Field offsets come from the Victron "Extra manufacturer data" specification
dated 2022-12-14. That document counts start bits from the beginning of the
whole record, whose first 32 bits are the record type, the nonce and the key
check byte. Those 32 bits are removed before decryption, so every documented
start bit appears 32 lower in the decoders, which index into the decrypted
payload.

A record type without a decoder is reported by name with no measurements. The
consumer never applies a decoder written for one record layout to a different
record type.

## Solar Charger

Record type `0x01` carries device state, charger error, battery voltage and
current, yield today, PV power, and load current. The specification expresses
yield today in 0.01 kWh; the consumer converts it to joules, the Signal K unit
for `electrical.solar.<id>.yieldToday`.

Signal K models solar controllers under `electrical.solar`, which defines
exact leaves for every advertised MPPT field. `electrical.chargers` has no
power, energy or panel leaf, so MPPT measurements are published as solar
rather than invented below the charger group.

## DC/DC converter

Record type `0x04` is the record advertised by Orion Smart DC-DC converters.
It carries device state, charger error, input voltage, output voltage, and a
32-bit off-reason field. It has no current fields, so only the two voltages
reach Signal K.

Record type `0x04` is distinct from the Orion XS record `0x0F` below. They
have different layouts, and decoding one with the other's field offsets
produces plausible but wrong voltages.

## Records decoded without hardware

Record types `0x02`, `0x03`, `0x05`, `0x06`, `0x09`, `0x0B`, `0x0C` and `0x0D`
are decoded from the published specification alone. Their tests use fixtures
built from the documented layouts rather than captured advertisements. They
are documented as untested until someone confirms them against VictronConnect
on real hardware.

Record types `0x07` and `0x08` remain unimplemented. The specification states
that both layouts are still to be determined and might change, so a decoder
would be guesswork rather than a reading of the document.

### The auxiliary field of records 0x02 and 0x0D

Both the battery monitor and the DC energy meter carry a 16-bit field whose
meaning is chosen by a 2-bit selector that appears *after* it in the record:
starter voltage, mid-point voltage, or temperature. The decoder returns only
the selected reading and leaves the others null. Interpreting the same bits
under all three meanings at once would report two values the device never
sent.

### The start-bit numbering of record 0x09

The specification tables number each record's first field from start bit 32,
because the first 32 bits are the record header. The Smart Battery Protect
table instead numbers its first field from bit 8. That is a numbering quirk in
the document rather than a gap in the data: both published reference
implementations pack the record's fields from the first bit of the decrypted
payload, so this consumer uses the same convention as every other record.

## Orion XS

The observed Orion XS model `0xA3F8` uses record type `0x0F`. Its published
layout includes operating state, error code, output voltage/current, input
voltage/current, and a 32-bit shutdown-reason field. Scaling was cross-checked
against simultaneous VictronConnect readings.

On the observed device, shutdown bit 7 (`0x80`) corresponds to VictronConnect
notification `#8 Engine shutdown`. The decoder additionally returns symbolic
reason `engine_shutdown` while preserving the full raw value. Other bits remain
unnamed until supported by reliable documentation or test evidence.
