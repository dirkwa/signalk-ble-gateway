'use strict'

const crypto = require('node:crypto')
const { parseHex } = require('./ble-advertisement')

const VICTRON_COMPANY_ID = 0x02e1
const RECORD_TYPES = {
  0x00: 'test', 0x01: 'solar_charger', 0x02: 'battery_monitor',
  0x03: 'inverter', 0x04: 'dc_dc_converter', 0x05: 'smart_lithium',
  0x06: 'inverter_rs', 0x07: 'gx_device', 0x08: 'ac_charger',
  0x09: 'battery_protect', 0x0a: 'lynx_smart_bms', 0x0b: 'multi_rs',
  0x0c: 've_bus', 0x0d: 'dc_energy_meter', 0x0f: 'orion_xs'
}

function normalizeKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{32}$/.test(value)) {
    throw new Error('advertisement key must contain exactly 32 hex characters')
  }
  return Buffer.from(value, 'hex')
}

function decodeEnvelope(advertisement, keyValue) {
  const manufacturerHex = advertisement?.manufacturerData?.[VICTRON_COMPANY_ID]
  if (manufacturerHex === undefined) return null
  const payload = parseHex(manufacturerHex)
  if (payload.length < 9) throw new Error('Victron manufacturer payload is too short')
  if (payload[0] !== 0x10) throw new Error('unsupported Victron manufacturer record')

  const key = normalizeKey(keyValue)
  const modelId = payload.readUInt16LE(2)
  const recordType = payload[4]
  const nonce = payload.readUInt16LE(5)
  const keyCheck = payload[7]
  if (keyCheck !== key[0]) throw new Error('advertisement key check failed')

  const counter = Buffer.alloc(16)
  counter.writeUInt16LE(nonce, 0)
  const decipher = crypto.createDecipheriv('aes-128-ctr', key, counter)
  const decrypted = Buffer.concat([decipher.update(payload.subarray(8)), decipher.final()])

  const decoder = RECORD_DECODERS[recordType]
  const measurements = decoder ? decoder(decrypted) : null

  return {
    company_id: VICTRON_COMPANY_ID,
    model_id: modelId,
    record_type: recordType,
    record_name: RECORD_TYPES[recordType] || 'unknown',
    nonce,
    decrypted_data: decrypted.toString('hex').toUpperCase(),
    measurements
  }
}

function readBits(buffer, start, width, signed = false) {
  if (start + width > buffer.length * 8) return null
  let value = 0n
  for (let bit = 0; bit < width; bit += 1) {
    const source = start + bit
    if ((buffer[Math.floor(source / 8)] >> (source % 8)) & 1) value |= 1n << BigInt(bit)
  }
  if (signed && (value & (1n << BigInt(width - 1)))) value -= 1n << BigInt(width)
  return Number(value)
}

function valueUnless(raw, unavailable, convert = value => value) {
  return raw === null || raw === unavailable ? null : convert(raw)
}

/**
 * Read a signed field whose NA value is the all-ones bit pattern.
 *
 * A sign-extended read can never equal such a sentinel: all-ones reads back as
 * -1, not as the unsigned value the specification names. The field is
 * therefore read unsigned, compared against the sentinel, and only then
 * sign-extended.
 */
function signedUnlessAllOnes(buffer, start, width, convert = value => value) {
  const raw = readBits(buffer, start, width)
  if (raw === null || raw === (2 ** width) - 1) return null
  const signed = raw & (1 << (width - 1)) ? raw - 2 ** width : raw
  return convert(signed)
}

function decodeLynxSmartBms(data) {
  const error = readBits(data, 0, 8)
  const ttg = readBits(data, 8, 16)
  const voltage = readBits(data, 24, 16, true)
  const current = readBits(data, 40, 16, true)
  const ioStatus = readBits(data, 56, 16)
  const warningsAlarms = readBits(data, 72, 18)
  const soc = readBits(data, 90, 10)
  const consumedAh = readBits(data, 100, 20)
  const temperature = readBits(data, 120, 7)

  return {
    error,
    time_to_go_s: valueUnless(ttg, 0xffff, value => value * 60),
    battery_voltage_v: valueUnless(voltage, 0x7fff, value => value * 0.01),
    battery_current_a: valueUnless(current, 0x7fff, value => value * 0.1),
    io_status: ioStatus,
    warnings_alarms: warningsAlarms,
    state_of_charge_percent: valueUnless(soc, 0x3ff, value => value * 0.1),
    consumed_ah: valueUnless(consumedAh, 0xfffff, value => -value * 0.1),
    temperature_c: valueUnless(temperature, 0x7f, value => value - 40)
  }
}

/**
 * Decode the observed Orion XS 0x0f instant-readout record.
 *
 * Layout published by Victron staff for instant-readout record type 0x0f.
 */
function decodeOrionXs(data) {
  const state = readBits(data, 0, 8)
  const error = readBits(data, 8, 8)
  const outputVoltage = readBits(data, 16, 16, true)
  const outputCurrent = readBits(data, 32, 16, true)
  const inputVoltage = readBits(data, 48, 16)
  const inputCurrent = readBits(data, 64, 16)
  const offReason = readBits(data, 80, 32)

  return {
    state,
    state_name: deviceState(state),
    error,
    error_name: chargerErrorName(error),
    output_voltage_v: valueUnless(outputVoltage, 0x7fff, value => value / 100),
    output_current_a: valueUnless(outputCurrent, 0x7fff, value => value / 10),
    input_voltage_v: valueUnless(inputVoltage, 0xffff, value => value / 100),
    input_current_a: valueUnless(inputCurrent, 0xffff, value => value / 10),
    off_reason: offReason,
    off_reasons: decodeOrionOffReasons(offReason)
  }
}

function decodeSolarCharger(data) {
  const chargeState = readBits(data, 0, 8)
  const chargerError = readBits(data, 8, 8)
  const batteryVoltage = readBits(data, 16, 16, true)
  const batteryCurrent = readBits(data, 32, 16, true)
  const yieldToday = readBits(data, 48, 16)
  const solarPower = readBits(data, 64, 16)
  const externalLoad = readBits(data, 80, 9)

  return {
    charge_state: deviceState(chargeState),
    charger_error: chargerErrorName(chargerError),
    battery_voltage_v: valueUnless(batteryVoltage, 0x7fff, value => value * 0.01),
    battery_charging_current_a: valueUnless(batteryCurrent, 0x7fff, value => value * 0.1),
    // Specification unit is 0.01 kWh; 1 kWh is 3.6e6 J.
    yield_today_j: valueUnless(yieldToday, 0xffff, value => value * 0.01 * 3600000),
    solar_power_w: valueUnless(solarPower, 0xffff),
    external_device_load_a: valueUnless(externalLoad, 0x1ff, value => value * 0.1)
  }
}

/**
 * VE_REG_DEVICE_STATE. Values observed on live hardware and cross-checked
 * against the VE.Direct state list. 0xFF is the specified NA value.
 */
const DEVICE_STATES = {
  0: 'off',
  1: 'low_power',
  2: 'fault',
  3: 'bulk',
  4: 'absorption',
  5: 'float',
  6: 'storage',
  7: 'equalize_manual',
  9: 'inverting',
  11: 'power_supply',
  245: 'starting_up',
  246: 'repeated_absorption',
  247: 'recondition',
  248: 'battery_safe',
  249: 'active',
  252: 'external_control'
}

function deviceState(value) {
  if (value === null || value === 0xff) return null
  return DEVICE_STATES[value] || `unknown_${value}`
}

/**
 * VE_REG_CHR_ERROR_CODE. Only the codes with a settled meaning are named; any
 * other code is reported numerically rather than guessed.
 */
const CHARGER_ERRORS = {
  0: 'no_error',
  1: 'battery_temperature_high',
  2: 'battery_voltage_high',
  17: 'charger_temperature_high',
  18: 'charger_over_current',
  20: 'bulk_time_limit_exceeded',
  26: 'charger_terminals_overheated',
  33: 'input_voltage_high',
  34: 'input_current_high'
}

function chargerErrorName(value) {
  if (value === null || value === 0xff) return null
  return CHARGER_ERRORS[value] || `unknown_${value}`
}

/**
 * VE_REG_BMV_AUX_INPUT. Selects how the 16-bit aux field of the battery
 * monitor and DC energy meter records is interpreted.
 */
const AUX_INPUTS = { 0: 'aux_voltage', 1: 'mid_voltage', 2: 'temperature', 3: 'none' }

/**
 * Decode the 16-bit polymorphic aux field shared by records 0x02 and 0x0D.
 * The selector sits after the field in the record, so it is read separately
 * and passed in. Only the selected reading is returned; the others would be
 * a reinterpretation of bits that do not mean what they appear to mean.
 */
function decodeAuxInput(raw, selector) {
  const name = AUX_INPUTS[selector] ?? null
  const result = {
    aux_input: name,
    aux_voltage_v: null,
    mid_voltage_v: null,
    temperature_k: null
  }
  if (raw === null || name === null || name === 'none') return result
  if (name === 'aux_voltage') {
    const signed = raw & 0x8000 ? raw - 0x10000 : raw
    result.aux_voltage_v = valueUnless(signed, 0x7fff, value => value * 0.01)
  } else if (name === 'mid_voltage') {
    result.mid_voltage_v = valueUnless(raw, 0xffff, value => value * 0.01)
  } else {
    result.temperature_k = valueUnless(raw, 0xffff, value => value * 0.01)
  }
  return result
}

/**
 * Decode the battery monitor record (type 0x02), used by SmartShunt and BMV.
 *
 * spec bit 32  -> 0    time to go        16 bits, minutes,          NA 0xFFFF
 * spec bit 48  -> 16   battery voltage   16 bits, signed, 0.01 V,   NA 0x7FFF
 * spec bit 64  -> 32   alarm reason      16 bits
 * spec bit 80  -> 48   aux field         16 bits, meaning per selector
 * spec bit 96  -> 64   aux input          2 bits, selector,         NA 0x3
 * spec bit 98  -> 66   battery current   22 bits, signed, 0.001 A,  NA 0x3FFFFF
 * spec bit 120 -> 88   consumed Ah       20 bits, 0.1 Ah,           NA 0xFFFFF
 * spec bit 140 -> 108  state of charge   10 bits, 0.1 %,            NA 0x3FF
 *
 * Consumed Ah is stored negated: the specification states
 * "Consumed Ah = -Record value".
 */
function decodeBatteryMonitor(data) {
  const timeToGo = readBits(data, 0, 16)
  const voltage = readBits(data, 16, 16, true)
  const alarmReason = readBits(data, 32, 16)
  const auxRaw = readBits(data, 48, 16)
  const auxSelector = readBits(data, 64, 2)
  const consumedAh = readBits(data, 88, 20)
  const soc = readBits(data, 108, 10)

  return {
    time_to_go_s: valueUnless(timeToGo, 0xffff, value => value * 60),
    battery_voltage_v: valueUnless(voltage, 0x7fff, value => value * 0.01),
    alarm_reason: alarmReason,
    ...decodeAuxInput(auxRaw, auxSelector),
    battery_current_a: signedUnlessAllOnes(data, 66, 22, value => value * 0.001),
    consumed_ah: valueUnless(consumedAh, 0xfffff, value => -value * 0.1),
    state_of_charge_percent: valueUnless(soc, 0x3ff, value => value * 0.1)
  }
}

/**
 * Decode the DC energy meter record (type 0x0D).
 *
 * spec bit 32  -> 0    BMV monitor mode  16 bits, signed
 * spec bit 48  -> 16   battery voltage   16 bits, signed, 0.01 V,   NA 0x7FFF
 * spec bit 64  -> 32   alarm reason      16 bits
 * spec bit 80  -> 48   aux field         16 bits, meaning per selector
 * spec bit 96  -> 64   aux input          2 bits, selector,         NA 0x3
 * spec bit 98  -> 66   battery current   22 bits, signed, 0.001 A,  NA 0x3FFFFF
 *
 * The specification lists no mid-voltage reading for this record, but the aux
 * selector shares the battery monitor encoding.
 */
function decodeDcEnergyMeter(data) {
  const monitorMode = readBits(data, 0, 16, true)
  const voltage = readBits(data, 16, 16, true)
  const alarmReason = readBits(data, 32, 16)
  const auxRaw = readBits(data, 48, 16)
  const auxSelector = readBits(data, 64, 2)

  return {
    bmv_monitor_mode: monitorMode,
    battery_voltage_v: valueUnless(voltage, 0x7fff, value => value * 0.01),
    alarm_reason: alarmReason,
    ...decodeAuxInput(auxRaw, auxSelector),
    battery_current_a: signedUnlessAllOnes(data, 66, 22, value => value * 0.001)
  }
}

/**
 * Decode the inverter record (type 0x03).
 *
 * spec bit 32  -> 0    device state       8 bits,                   NA 0xFF
 * spec bit 40  -> 8    alarm reason      16 bits
 * spec bit 56  -> 24   battery voltage   16 bits, signed, 0.01 V,   NA 0x7FFF
 * spec bit 72  -> 40   AC apparent power 16 bits, VA,               NA 0xFFFF
 * spec bit 88  -> 56   AC voltage        15 bits, 0.01 V,           NA 0x7FFF
 * spec bit 103 -> 71   AC current        11 bits, 0.1 A,            NA 0x7FF
 */
function decodeInverter(data) {
  const state = readBits(data, 0, 8)
  const alarmReason = readBits(data, 8, 16)
  const batteryVoltage = readBits(data, 24, 16, true)
  const apparentPower = readBits(data, 40, 16)
  const acVoltage = readBits(data, 56, 15)
  const acCurrent = readBits(data, 71, 11)

  return {
    state,
    state_name: deviceState(state),
    alarm_reason: alarmReason,
    battery_voltage_v: valueUnless(batteryVoltage, 0x7fff, value => value * 0.01),
    ac_apparent_power_va: valueUnless(apparentPower, 0xffff),
    ac_voltage_v: valueUnless(acVoltage, 0x7fff, value => value * 0.01),
    ac_current_a: valueUnless(acCurrent, 0x7ff, value => value * 0.1)
  }
}

/**
 * Decode the Inverter RS record (type 0x06).
 *
 * spec bit 32  -> 0    device state       8 bits,                   NA 0xFF
 * spec bit 40  -> 8    charger error      8 bits,                   NA 0xFF
 * spec bit 48  -> 16   battery voltage   16 bits, signed, 0.01 V,   NA 0x7FFF
 * spec bit 64  -> 32   battery current   16 bits, signed, 0.1 A,    NA 0x7FFF
 * spec bit 80  -> 48   PV power          16 bits, W,                NA 0xFFFF
 * spec bit 96  -> 64   yield today       16 bits, 0.01 kWh,         NA 0xFFFF
 * spec bit 112 -> 80   AC out power      16 bits, signed, W,        NA 0x7FFF
 */
function decodeInverterRs(data) {
  const state = readBits(data, 0, 8)
  const error = readBits(data, 8, 8)
  const batteryVoltage = readBits(data, 16, 16, true)
  const batteryCurrent = readBits(data, 32, 16, true)
  const pvPower = readBits(data, 48, 16)
  const yieldToday = readBits(data, 64, 16)
  const acOutPower = readBits(data, 80, 16, true)

  return {
    state,
    state_name: deviceState(state),
    error,
    error_name: chargerErrorName(error),
    battery_voltage_v: valueUnless(batteryVoltage, 0x7fff, value => value * 0.01),
    battery_current_a: valueUnless(batteryCurrent, 0x7fff, value => value * 0.1),
    solar_power_w: valueUnless(pvPower, 0xffff),
    yield_today_j: valueUnless(yieldToday, 0xffff, value => value * 0.01 * 3600000),
    ac_out_power_w: valueUnless(acOutPower, 0x7fff)
  }
}

/**
 * Decode the SmartLithium record (type 0x05).
 *
 * spec bit 32  -> 0    BMS flags         32 bits
 * spec bit 64  -> 32   error flags       16 bits
 * spec bit 80  -> 48   cells 1..8         7 bits each, 0.01 V,      NA 0x7F
 * spec bit 136 -> 104  battery voltage   12 bits, 0.01 V,           NA 0x0FFF
 * spec bit 148 -> 116  balancer status    4 bits,                   NA 0x0F
 * spec bit 152 -> 120  temperature        7 bits, 1 C, offset -40,  NA 0x7F
 *
 * Cell voltages are offset: the specification defines 0 as below 2.61 V and
 * each step as 0.01 V from there, so the reading is 2.60 V + value * 0.01.
 */
function decodeSmartLithium(data) {
  const bmsFlags = readBits(data, 0, 32)
  const errorFlags = readBits(data, 32, 16)
  const cells = []
  for (let index = 0; index < 8; index += 1) {
    const raw = readBits(data, 48 + index * 7, 7)
    cells.push(valueUnless(raw, 0x7f, value => Math.round((2.6 + value * 0.01) * 100) / 100))
  }
  const voltage = readBits(data, 104, 12)
  const balancer = readBits(data, 116, 4)
  const temperature = readBits(data, 120, 7)

  return {
    bms_flags: bmsFlags,
    error_flags: errorFlags,
    cell_voltages_v: cells,
    battery_voltage_v: valueUnless(voltage, 0x0fff, value => value * 0.01),
    balancer_status: valueUnless(balancer, 0x0f),
    temperature_c: valueUnless(temperature, 0x7f, value => value - 40)
  }
}

/**
 * Decode the Smart Battery Protect record (type 0x09).
 *
 * The specification table numbers this record's fields from start bit 8 while
 * every other record starts at 32. That is a numbering quirk in the document,
 * not a leading gap in the data: both published reference implementations
 * pack these fields from the first bit of the decrypted payload, so the same
 * convention as every other record applies here.
 *
 * 0    device state       8 bits,                   NA 0xFF
 * 8    output state       8 bits,                   NA 0xFF
 * 16   error code         8 bits,                   NA 0xFF
 * 24   alarm reason      16 bits
 * 40   warning reason    16 bits
 * 56   input voltage     16 bits, signed, 0.01 V,   NA 0x7FFF
 * 72   output voltage    16 bits, 0.01 V,           NA 0xFFFF
 * 88   off reason        32 bits
 */
function decodeBatteryProtect(data) {
  const state = readBits(data, 0, 8)
  const outputState = readBits(data, 8, 8)
  const error = readBits(data, 16, 8)
  const alarmReason = readBits(data, 24, 16)
  const warningReason = readBits(data, 40, 16)
  const inputVoltage = readBits(data, 56, 16, true)
  const outputVoltage = readBits(data, 72, 16)
  const offReason = readBits(data, 88, 32)

  return {
    state,
    state_name: deviceState(state),
    output_state: valueUnless(outputState, 0xff),
    error,
    error_name: chargerErrorName(error),
    alarm_reason: alarmReason,
    warning_reason: warningReason,
    input_voltage_v: valueUnless(inputVoltage, 0x7fff, value => value * 0.01),
    output_voltage_v: valueUnless(outputVoltage, 0xffff, value => value * 0.01),
    off_reason: offReason,
    off_reasons: decodeOrionOffReasons(offReason)
  }
}

/** VE_REG_AC_IN_ACTIVE, shared by the Multi RS and VE.Bus records. */
const ACTIVE_AC_INPUTS = { 0: 'ac_in_1', 1: 'ac_in_2', 2: 'not_connected', 3: 'unknown' }

/**
 * Decode the Multi RS record (type 0x0B).
 *
 * spec bit 32  -> 0    device state       8 bits,                   NA 0xFF
 * spec bit 40  -> 8    charger error      8 bits,                   NA 0xFF
 * spec bit 48  -> 16   battery current   16 bits, signed, 0.1 A,    NA 0x7FFF
 * spec bit 64  -> 32   battery voltage   14 bits, 0.01 V,           NA 0x3FFF
 * spec bit 78  -> 46   active AC in       2 bits,                   NA 0x3
 * spec bit 80  -> 48   active AC power   16 bits, signed, W,        NA 0x7FFF
 * spec bit 96  -> 64   AC out power      16 bits, signed, W,        NA 0x7FFF
 * spec bit 112 -> 80   PV power          16 bits, W,                NA 0xFFFF
 * spec bit 128 -> 96   yield today       16 bits, 0.01 kWh,         NA 0xFFFF
 */
function decodeMultiRs(data) {
  const state = readBits(data, 0, 8)
  const error = readBits(data, 8, 8)
  const current = readBits(data, 16, 16, true)
  const voltage = readBits(data, 32, 14)
  const activeAcIn = readBits(data, 46, 2)
  const activeAcPower = readBits(data, 48, 16, true)
  const acOutPower = readBits(data, 64, 16, true)
  const pvPower = readBits(data, 80, 16)
  const yieldToday = readBits(data, 96, 16)

  return {
    state,
    state_name: deviceState(state),
    error,
    error_name: chargerErrorName(error),
    battery_current_a: valueUnless(current, 0x7fff, value => value * 0.1),
    battery_voltage_v: valueUnless(voltage, 0x3fff, value => value * 0.01),
    active_ac_input: activeAcIn === null ? null : (ACTIVE_AC_INPUTS[activeAcIn] || null),
    active_ac_power_w: valueUnless(activeAcPower, 0x7fff),
    ac_out_power_w: valueUnless(acOutPower, 0x7fff),
    solar_power_w: valueUnless(pvPower, 0xffff),
    yield_today_j: valueUnless(yieldToday, 0xffff, value => value * 0.01 * 3600000)
  }
}

/**
 * Decode the VE.Bus record (type 0x0C).
 *
 * spec bit 32  -> 0    device state       8 bits,                   NA 0xFF
 * spec bit 40  -> 8    VE.Bus error       8 bits,                   NA 0xFF
 * spec bit 48  -> 16   battery current   16 bits, signed, 0.1 A,    NA 0x7FFF
 * spec bit 64  -> 32   battery voltage   14 bits, 0.01 V,           NA 0x3FFF
 * spec bit 78  -> 46   active AC in       2 bits,                   NA 0x3
 * spec bit 80  -> 48   active AC power   19 bits, signed, W,        NA 0x3FFFF
 * spec bit 99  -> 67   AC out power      19 bits, signed, W,        NA 0x3FFFF
 * spec bit 118 -> 86   alarm              2 bits, 3 = NA
 * spec bit 120 -> 88   temperature        7 bits, 1 C, offset -40,  NA 0x7F
 * spec bit 127 -> 95   state of charge    7 bits, 1 %,              NA 0x7F
 */
function decodeVeBus(data) {
  const state = readBits(data, 0, 8)
  const error = readBits(data, 8, 8)
  const current = readBits(data, 16, 16, true)
  const voltage = readBits(data, 32, 14)
  const activeAcIn = readBits(data, 46, 2)
  const activeAcPower = readBits(data, 48, 19, true)
  const acOutPower = readBits(data, 67, 19, true)
  const alarm = readBits(data, 86, 2)
  const temperature = readBits(data, 88, 7)
  const soc = readBits(data, 95, 7)

  const alarms = { 0: 'no_alarm', 1: 'warning', 2: 'alarm' }
  return {
    state,
    state_name: deviceState(state),
    ve_bus_error: valueUnless(error, 0xff),
    battery_current_a: valueUnless(current, 0x7fff, value => value * 0.1),
    battery_voltage_v: valueUnless(voltage, 0x3fff, value => value * 0.01),
    active_ac_input: activeAcIn === null ? null : (ACTIVE_AC_INPUTS[activeAcIn] || null),
    active_ac_power_w: valueUnless(activeAcPower, 0x3ffff),
    ac_out_power_w: valueUnless(acOutPower, 0x3ffff),
    alarm: alarm === null || alarm === 3 ? null : (alarms[alarm] || null),
    temperature_c: valueUnless(temperature, 0x7f, value => value - 40),
    state_of_charge_percent: valueUnless(soc, 0x7f)
  }
}

/**
 * Decode the DC/DC converter record (type 0x04).
 *
 * Layout from the published Victron "Extra manufacturer data" specification
 * (2022-12-14). Specification start bits are counted from the beginning of the
 * whole record, whose first 32 bits are the record type, nonce and key check
 * byte. Those 32 bits are stripped before decryption, so each documented start
 * bit appears here 32 lower.
 *
 * spec bit 32 -> 0    device state      8 bits, NA 0xFF
 * spec bit 40 -> 8    charger error     8 bits, NA 0xFF
 * spec bit 48 -> 16   input voltage    16 bits, unsigned, 0.01 V, NA 0xFFFF
 * spec bit 64 -> 32   output voltage   16 bits, signed,   0.01 V, NA 0x7FFF
 * spec bit 80 -> 48   off reason       32 bits
 */
function decodeDcDcConverter(data) {
  const state = readBits(data, 0, 8)
  const error = readBits(data, 8, 8)
  const inputVoltage = readBits(data, 16, 16)
  const outputVoltage = readBits(data, 32, 16, true)
  const offReason = readBits(data, 48, 32)

  return {
    state: valueUnless(state, 0xff),
    state_name: deviceState(state),
    error: valueUnless(error, 0xff),
    error_name: chargerErrorName(error),
    input_voltage_v: valueUnless(inputVoltage, 0xffff, value => value * 0.01),
    output_voltage_v: valueUnless(outputVoltage, 0x7fff, value => value * 0.01),
    off_reason: offReason,
    off_reasons: decodeOrionOffReasons(offReason)
  }
}

function decodeOrionOffReasons(value) {
  if (value === null) return []
  const reasons = []
  // Confirmed against VictronConnect notification #8 on the observed Orion XS.
  if ((value & 0x80) !== 0) reasons.push('engine_shutdown')
  return reasons
}

/**
 * Decoders for the record types this consumer has validated. A record type
 * that is absent here is reported by name with `measurements: null` rather
 * than decoded by a decoder written for a different layout.
 */
const RECORD_DECODERS = {
  0x01: decodeSolarCharger,
  0x02: decodeBatteryMonitor,
  0x03: decodeInverter,
  0x04: decodeDcDcConverter,
  0x05: decodeSmartLithium,
  0x06: decodeInverterRs,
  0x09: decodeBatteryProtect,
  0x0a: decodeLynxSmartBms,
  0x0b: decodeMultiRs,
  0x0c: decodeVeBus,
  0x0d: decodeDcEnergyMeter,
  0x0f: decodeOrionXs
}

module.exports = {
  decodeAuxInput,
  decodeBatteryMonitor,
  decodeBatteryProtect,
  decodeDcDcConverter,
  decodeDcEnergyMeter,
  decodeEnvelope,
  decodeInverter,
  decodeInverterRs,
  decodeLynxSmartBms,
  decodeMultiRs,
  decodeOrionOffReasons,
  decodeOrionXs,
  decodeSmartLithium,
  decodeSolarCharger,
  decodeVeBus,
  normalizeKey,
  RECORD_DECODERS,
  RECORD_TYPES,
  VICTRON_COMPANY_ID
}
