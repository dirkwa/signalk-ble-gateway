'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const createPlugin = require('../index')
const { measurementDelta } = require('../index')

function harness() {
  const app = new EventEmitter()
  const statuses = []
  app.setPluginStatus = value => statuses.push(value)
  app.setPluginError = value => statuses.push(value)
  app.handleMessage = () => {}
  const advertisementCallbacks = new Map()
  app.bleApi = {
    onAdvertisement: (pluginId, callback) => {
      advertisementCallbacks.set(pluginId, callback)
      return () => advertisementCallbacks.delete(pluginId)
    }
  }
  const routes = new Map()
  const router = { get: (path, handler) => routes.set(path, handler) }
  const plugin = createPlugin(app)
  plugin.registerWithRouter(router)
  return { app, plugin, routes, statuses, advertisementCallbacks }
}

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

test('subscribes and unsubscribes through the official BLE API', () => {
  const instance = harness()
  instance.plugin.start({ devices: [] })
  assert.equal(instance.advertisementCallbacks.has(instance.plugin.id), true)
  instance.plugin.stop()
  assert.equal(instance.advertisementCallbacks.size, 0)
})

test('reports a clear error when the BLE API is unavailable', () => {
  const instance = harness()
  delete instance.app.bleApi
  instance.plugin.start({ devices: [] })
  assert.match(instance.statuses.at(-1), /requires.*PR #2588/i)
  assert.equal(instance.advertisementCallbacks.size, 0)
})

test('status route masks configured keys', () => {
  const instance = harness()
  const key = '00112233445566778899AABBCCDDEEFF'
  instance.plugin.start({ devices: [{
    id: 'house', name: 'House', mac: 'AA:BB:CC:DD:EE:FF',
    advertisementKey: key
  }] })
  const response = responseRecorder()
  instance.routes.get('/status')({}, response)

  assert.equal(response.statusCode, 200)
  assert.equal(response.body.devices[0].key_configured, true)
  assert.equal(JSON.stringify(response.body).includes(key), false)
})

test('publishes Lynx measurements on battery paths', () => {
  const delta = measurementDelta({ id: 'house' }, {
    record_type: 0x0a,
    measurements: {
      battery_voltage_v: 13.29,
      battery_current_a: 8.7,
      state_of_charge_percent: 67.1,
      time_to_go_s: 90000,
      temperature_c: 32
    }
  })

  assert.deepEqual(delta.updates[0].values, [
    { path: 'electrical.batteries.house.voltage', value: 13.29 },
    { path: 'electrical.batteries.house.current', value: 8.7 },
    { path: 'electrical.batteries.house.capacity.stateOfCharge', value: 0.671 },
    { path: 'electrical.batteries.house.capacity.timeRemaining', value: 90000 },
    { path: 'electrical.batteries.house.temperature', value: 305.15 }
  ])
})

test('publishes Orion output and input measurements on charger paths', () => {
  const delta = measurementDelta({ id: 'orionSt' }, {
    record_type: 0x0f,
    measurements: {
      output_voltage_v: 13.57,
      output_current_a: 48.8,
      input_voltage_v: 13.88,
      input_current_a: 48.8,
      state: 3,
      error: 0,
      off_reason: 0
    }
  })

  assert.deepEqual(delta.updates[0].values, [
    { path: 'electrical.chargers.orionSt.voltage', value: 13.57 },
    { path: 'electrical.chargers.orionSt.current', value: 48.8 },
    { path: 'electrical.chargers.orionSt.inputVoltage', value: 13.88 },
    { path: 'electrical.chargers.orionSt.inputCurrent', value: 48.8 }
  ])
})

test('publishes Solar Charger measurements on charger paths', () => {
  const delta = measurementDelta({ id: 'mppt' }, {
    record_type: 0x01,
    measurements: {
      battery_voltage_v: 13.48,
      battery_charging_current_a: 3.6,
      solar_power_w: 50,
      yield_today_wh: 930
    }
  })

  assert.deepEqual(delta.updates[0].values, [
    { path: 'electrical.chargers.mppt.voltage', value: 13.48 },
    { path: 'electrical.chargers.mppt.current', value: 3.6 },
    { path: 'electrical.chargers.mppt.power', value: 50 },
    { path: 'electrical.chargers.mppt.energy', value: 930 }
  ])
})
