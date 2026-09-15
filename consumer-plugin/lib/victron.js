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
  0x04: decodeDcDcConverter,
  0x0a: decodeLynxSmartBms,
  0x0f: decodeOrionXs
}

module.exports = {
  decodeDcDcConverter,
  decodeEnvelope,
  decodeLynxSmartBms,
  decodeOrionOffReasons,
  decodeOrionXs,
  decodeSolarCharger,
  normalizeKey,
  RECORD_DECODERS,
  RECORD_TYPES,
  VICTRON_COMPANY_ID
}
