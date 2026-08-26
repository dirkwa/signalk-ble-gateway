'use strict'

const { VictronConsumer } = require('./lib/consumer')

module.exports = function createPlugin(app) {
  let consumer = null
  let listener = null

  return {
    id: 'signalk-victron-ble-consumer',
    name: 'Signal K Victron BLE Consumer',
    description: 'Decodes configured Victron BLE advertisements server-side',

    schema: {
      type: 'object',
      properties: {
        devices: {
          title: 'Victron devices',
          type: 'array',
          default: [],
          items: {
            type: 'object',
            required: ['id', 'name', 'mac', 'advertisementKey'],
            properties: {
              id: { title: 'Stable device ID', type: 'string' },
              name: { title: 'Display name', type: 'string' },
              mac: { title: 'BLE MAC address', type: 'string' },
              advertisementKey: {
                title: 'Victron advertisement key',
                type: 'string',
                minLength: 32,
                maxLength: 32
              },
              enabled: { title: 'Enabled', type: 'boolean', default: true }
            }
          }
        }
      }
    },

    start(settings = {}) {
      consumer = new VictronConsumer(Array.isArray(settings.devices) ? settings.devices : [])
      if (!app.bleApi || typeof app.bleApi.onAdvertisement !== 'function') {
        app.setPluginError(
          'Signal K BLE Provider API unavailable. This plugin requires a ' +
            'Signal K release containing BLE Provider API PR #2588.'
        )
        return
      }
      listener = advertisement => {
        const result = consumer.accept(advertisement)
        if (result?.state.decoded?.measurements) {
          app.handleMessage(this.id, measurementDelta(result.device, result.state.decoded))
        }
        const status = consumer.status()
        app.setPluginStatus(
          `Decoded ${status.decoded} Victron advertisements; ${status.errors} errors`
        )
      }
      listener = app.bleApi.onAdvertisement(this.id, listener)
      app.setPluginStatus(`Listening for ${consumer.status().devices.length} configured device(s)`)
    },

    stop() {
      if (listener) listener()
      listener = null
      consumer = null
      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router) {
      router.get('/status', (_request, response) => {
        response.status(200).json(consumer ? consumer.status() : {
          received: 0, decoded: 0, ignored: 0, errors: 0, devices: []
        })
      })
    }
  }
}

function measurementDelta(device, decoded) {
  const values = decoded.measurements
  const candidates = decoded.record_type === 0x0f
    ? orionCandidates(device.id, values)
    : decoded.record_type === 0x01
      ? solarChargerCandidates(device.id, values)
      : lynxCandidates(device.id, values)
  return {
    updates: [{
      source: { label: 'Victron BLE', src: device.id },
      timestamp: new Date().toISOString(),
      values: candidates
        .filter(([, value]) => value != null)
        .map(([path, value]) => ({ path, value }))
    }]
  }
}

function solarChargerCandidates(id, values) {
  const base = `electrical.chargers.${id}`
  return [
    [`${base}.voltage`, values.battery_voltage_v],
    [`${base}.current`, values.battery_charging_current_a],
    [`${base}.power`, values.solar_power_w],
    [`${base}.energy`, values.yield_today_wh]
  ]
}

function lynxCandidates(id, values) {
  const base = `electrical.batteries.${id}`
  return [
    [`${base}.voltage`, values.battery_voltage_v],
    [`${base}.current`, values.battery_current_a],
    [`${base}.capacity.stateOfCharge`, values.state_of_charge_percent == null
      ? null : Math.round(values.state_of_charge_percent * 10) / 1000],
    [`${base}.capacity.timeRemaining`, values.time_to_go_s],
    [`${base}.temperature`, values.temperature_c == null ? null : values.temperature_c + 273.15]
  ]
}

function orionCandidates(id, values) {
  // Signal K has no DC/DC converter group. Model the Orion as the charger it
  // functionally is. voltage/current are standard charger output qualities;
  // inputVoltage/inputCurrent are explicit extensions for the source side.
  const base = `electrical.chargers.${id}`
  return [
    [`${base}.voltage`, values.output_voltage_v],
    [`${base}.current`, values.output_current_a],
    [`${base}.inputVoltage`, values.input_voltage_v],
    [`${base}.inputCurrent`, values.input_current_a]
  ]
}

module.exports.measurementDelta = measurementDelta
