'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const {
  decodeDcDcConverter,
  decodeEnvelope,
  decodeLynxSmartBms,
  decodeOrionXs,
  decodeSolarCharger
} = require('../lib/victron')

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
    state_name: 'off',
    error: 0,
    error_name: 'no_error',
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
    state_name: 'bulk',
    error: 0,
    error_name: 'no_error',
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
    yield_today_j: 3348000,
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

// Reference vectors published by the victron-ble project, decoded here with
// this consumer's own envelope and record decoders.
test('decodes the reference Solar Charger advertisement', () => {
  const decoded = decodeEnvelope(
    { manufacturerData: { 0x02e1: '100242a0016207adceb37b605d7e0ee21b24df5c' } },
    'adeccb947395801a4dd45a2eaa44bf17'
  )

  assert.equal(decoded.record_type, 0x01)
  assert.equal(decoded.record_name, 'solar_charger')
  assert.equal(decoded.measurements.charge_state, 'absorption')
  assert.equal(decoded.measurements.battery_voltage_v, 13.88)
  assert.equal(Math.round(decoded.measurements.battery_charging_current_a * 10) / 10, 1.4)
  assert.equal(decoded.measurements.solar_power_w, 19)
  // Raw yield field is 3: 3 * 0.01 kWh = 0.03 kWh = 1.08e5 J
  assert.equal(decoded.measurements.yield_today_j, 108000)
})

test('decodes the documented DC/DC converter layout', () => {
  const data = Buffer.alloc(10)
  data[0] = 0
  data[1] = 0
  data.writeUInt16LE(1315, 2)
  data.writeInt16LE(1290, 4)
  data.writeUInt32LE(0x80, 6)

  assert.deepEqual(decodeDcDcConverter(data), {
    state: 0,
    state_name: 'off',
    error: 0,
    error_name: 'no_error',
    input_voltage_v: 13.15,
    output_voltage_v: 12.9,
    off_reason: 128,
    off_reasons: ['engine_shutdown']
  })
})

test('reports DC/DC converter NA sentinels as null', () => {
  const data = Buffer.alloc(10)
  data[0] = 0xff
  data[1] = 0xff
  data.writeUInt16LE(0xffff, 2)
  data.writeUInt16LE(0x7fff, 4)
  data.writeUInt32LE(0, 6)

  const decoded = decodeDcDcConverter(data)
  assert.equal(decoded.state, null)
  assert.equal(decoded.state_name, null)
  assert.equal(decoded.error, null)
  assert.equal(decoded.error_name, null)
  assert.equal(decoded.input_voltage_v, null)
  assert.equal(decoded.output_voltage_v, null)
})

// Observed on a live SmartSolar MPPT reporting VE.Smart external control.
test('names device state 252 as external control', () => {
  const data = Buffer.alloc(12)
  data[0] = 252
  data[1] = 0
  data.writeInt16LE(2615, 2)
  data.writeInt16LE(364, 4)
  data.writeUInt16LE(123, 6)
  data.writeUInt16LE(985, 8)
  data[10] = 0xff
  data[11] |= 0x01

  const decoded = decodeSolarCharger(data)
  assert.equal(decoded.charge_state, 'external_control')
  assert.equal(decoded.charger_error, 'no_error')
  assert.equal(Math.round(decoded.battery_voltage_v * 100) / 100, 26.15)
  assert.equal(decoded.solar_power_w, 985)
  assert.equal(decoded.external_device_load_a, null)
})

test('names the documented device states and charger errors', () => {
  for (const [raw, name] of [[0, 'off'], [3, 'bulk'], [4, 'absorption'], [5, 'float'], [249, 'active']]) {
    const data = Buffer.alloc(12)
    data[0] = raw
    assert.equal(decodeSolarCharger(data).charge_state, name)
  }

  const faulted = Buffer.alloc(12)
  faulted[0] = 2
  faulted[1] = 18
  assert.equal(decodeSolarCharger(faulted).charge_state, 'fault')
  assert.equal(decodeSolarCharger(faulted).charger_error, 'charger_over_current')

  const unmapped = Buffer.alloc(12)
  unmapped[0] = 99
  assert.equal(decodeSolarCharger(unmapped).charge_state, 'unknown_99')

  const na = Buffer.alloc(12)
  na[0] = 0xff
  na[1] = 0xff
  assert.equal(decodeSolarCharger(na).charge_state, null)
  assert.equal(decodeSolarCharger(na).charger_error, null)
})

test('decodes the reference DC/DC converter advertisement', () => {
  const decoded = decodeEnvelope(
    { manufacturerData: { 0x02e1: '1000c0a304121d64ca8d442b90bbdf6a8cba' } },
    '64ba49f1a8562e45197a8e1fe50d7658'
  )

  assert.equal(decoded.record_type, 0x04)
  assert.equal(decoded.record_name, 'dc_dc_converter')
  assert.equal(decoded.measurements.input_voltage_v, 13.15)
  assert.equal(decoded.measurements.output_voltage_v, null)
  assert.deepEqual(decoded.measurements.off_reasons, ['engine_shutdown'])
})

test('leaves an undecoded record type without measurements', () => {
  const keyHex = '00112233445566778899AABBCCDDEEFF'
  const advertisement = advertisementFor({
    keyHex,
    recordType: 0x02,
    clear: Buffer.alloc(12)
  })

  const decoded = decodeEnvelope(advertisement, keyHex)
  assert.equal(decoded.record_name, 'battery_monitor')
  assert.equal(decoded.measurements, null)
})
