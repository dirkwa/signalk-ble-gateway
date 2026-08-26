'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { decodeEnvelope, decodeLynxSmartBms, decodeOrionXs, decodeSolarCharger } = require('../lib/victron')

function advertisementFor({ keyHex, modelId = 0xa389, recordType = 2, nonce = 0x1234, clear }) {
  const key = Buffer.from(keyHex, 'hex')
  const counter = Buffer.alloc(16)
  counter.writeUInt16LE(nonce, 0)
  const cipher = crypto.createCipheriv('aes-128-ctr', key, counter)
  const encrypted = Buffer.concat([cipher.update(clear), cipher.final()])
  const manufacturer = Buffer.alloc(8 + encrypted.length)
  manufacturer[0] = 0x10
  manufacturer[1] = 0x00
  manufacturer.writeUInt16LE(modelId, 2)
  manufacturer[4] = recordType
  manufacturer.writeUInt16LE(nonce, 5)
  manufacturer[7] = key[0]
  encrypted.copy(manufacturer, 8)
  return { manufacturerData: { 737: manufacturer.toString('hex').toUpperCase() } }
}

test('decrypts a Victron manufacturer envelope', () => {
  const keyHex = '00112233445566778899AABBCCDDEEFF'
  const clear = Buffer.from('A1B2C3D4E5F6', 'hex')
  const decoded = decodeEnvelope(advertisementFor({ keyHex, clear }), keyHex)

  assert.equal(decoded.model_id, 0xa389)
  assert.equal(decoded.record_name, 'battery_monitor')
  assert.equal(decoded.decrypted_data, clear.toString('hex').toUpperCase())
})

test('rejects a key whose first byte does not match', () => {
  const advertisement = advertisementFor({
    keyHex: '00112233445566778899AABBCCDDEEFF',
    clear: Buffer.from([1, 2, 3])
  })
  assert.throws(
    () => decodeEnvelope(advertisement, '11112233445566778899AABBCCDDEEFF'),
    /key check failed/
  )
})

function writeBits(buffer, start, width, value) {
  let raw = BigInt(value)
  if (raw < 0) raw += 1n << BigInt(width)
  for (let bit = 0; bit < width; bit += 1) {
    if (raw & (1n << BigInt(bit))) {
      const target = start + bit
      buffer[Math.floor(target / 8)] |= 1 << (target % 8)
    }
  }
}

test('decodes documented Lynx Smart BMS measurements', () => {
  const data = Buffer.alloc(16)
  writeBits(data, 0, 8, 0)
  writeBits(data, 8, 16, 90)
  writeBits(data, 24, 16, 5240)
  writeBits(data, 40, 16, -123)
  writeBits(data, 56, 16, 0x1234)
  writeBits(data, 72, 18, 5)
  writeBits(data, 90, 10, 876)
  writeBits(data, 100, 20, 421)
  writeBits(data, 120, 7, 65)

  assert.deepEqual(decodeLynxSmartBms(data), {
    error: 0,
    time_to_go_s: 5400,
    battery_voltage_v: 52.4,
    battery_current_a: -12.3,
    io_status: 0x1234,
    warnings_alarms: 5,
    state_of_charge_percent: 87.60000000000001,
    consumed_ah: -42.1,
    temperature_c: 25
  })
})

test('decodes the published Orion XS instant-readout layout', () => {
  const stopped = Buffer.from('00002F0500002205000080000000', 'hex')
  assert.deepEqual(decodeOrionXs(stopped), {
    state: 0,
    error: 0,
    output_voltage_v: 13.27,
    output_current_a: 0,
    input_voltage_v: 13.14,
    input_current_a: 0,
    off_reason: 0x80,
    off_reasons: ['engine_shutdown']
  })

  const charging = Buffer.from('03004D05E8016C05E80100000000', 'hex')
  assert.deepEqual(decodeOrionXs(charging), {
    state: 3,
    error: 0,
    output_voltage_v: 13.57,
    output_current_a: 48.8,
    input_voltage_v: 13.88,
    input_current_a: 48.8,
    off_reason: 0,
    off_reasons: []
  })
})

test('decodes the documented Solar Charger layout', () => {
  const data = Buffer.alloc(12)
  data[0] = 5
  data[1] = 0
  data.writeInt16LE(1348, 2)
  data.writeInt16LE(36, 4)
  data.writeUInt16LE(93, 6)
  data.writeUInt16LE(50, 8)
  data[10] = 0x14

  assert.deepEqual(decodeSolarCharger(data), {
    charge_state: 'float',
    charger_error: 'no_error',
    battery_voltage_v: 13.48,
    battery_charging_current_a: 3.6,
    yield_today_wh: 930,
    solar_power_w: 50,
    external_device_load_a: 2
  })
})

test('recognizes and decodes an Orion XS envelope', () => {
  const keyHex = '00112233445566778899AABBCCDDEEFF'
  const clear = Buffer.from('03004D05E8016C05E80100000000', 'hex')
  const decoded = decodeEnvelope(advertisementFor({
    keyHex,
    modelId: 0xa3f8,
    recordType: 0x0f,
    clear
  }), keyHex)

  assert.equal(decoded.record_name, 'orion_xs')
  assert.equal(decoded.measurements.output_current_a, 48.8)
})
