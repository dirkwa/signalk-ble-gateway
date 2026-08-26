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

  const measurements = recordType === 0x0a
    ? decodeLynxSmartBms(decrypted)
    : recordType === 0x0f
      ? decodeOrionXs(decrypted)
      : recordType === 0x01
        ? decodeSolarCharger(decrypted)
      : null

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
    error,
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

  const chargeStates = {
    0: 'off', 3: 'bulk', 4: 'absorption', 5: 'float', 7: 'equalization'
  }
  const errors = { 0: 'no_error' }
  return {
    charge_state: chargeState === 0xff ? null : (chargeStates[chargeState] || `unknown_${chargeState}`),
    charger_error: chargerError === 0xff ? null : (errors[chargerError] || `unknown_${chargerError}`),
    battery_voltage_v: valueUnless(batteryVoltage, 0x7fff, value => value * 0.01),
    battery_charging_current_a: valueUnless(batteryCurrent, 0x7fff, value => value * 0.1),
    yield_today_wh: valueUnless(yieldToday, 0xffff, value => value * 10),
    solar_power_w: valueUnless(solarPower, 0xffff),
    external_device_load_a: valueUnless(externalLoad, 0x1ff, value => value * 0.1)
  }
}

function decodeOrionOffReasons(value) {
  if (value === null) return []
  const reasons = []
  // Confirmed against VictronConnect notification #8 on the observed Orion XS.
  if ((value & 0x80) !== 0) reasons.push('engine_shutdown')
  return reasons
}

module.exports = {
  decodeEnvelope,
  decodeLynxSmartBms,
  decodeOrionOffReasons,
  decodeOrionXs,
  decodeSolarCharger,
  normalizeKey,
  RECORD_TYPES,
  VICTRON_COMPANY_ID
}
