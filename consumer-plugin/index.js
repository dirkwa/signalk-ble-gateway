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

// A record type without an entry here publishes nothing. Falling back to a
// path builder written for a different device would emit measurements under
// paths that do not describe the device that sent them.
const PATH_BUILDERS = {
  0x01: solarChargerCandidates,
  0x04: dcDcConverterCandidates,
  0x0a: lynxCandidates,
  0x0f: orionCandidates
}

function measurementDelta(device, decoded) {
  const values = decoded.measurements
  const builder = PATH_BUILDERS[decoded.record_type]
  const candidates = builder ? builder(device.id, values) : []
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

// Signal K models solar controllers under electrical.solar, which carries
// exact leaves for every MPPT advertisement field. electrical.chargers has no
// power, energy or panel leaf, so the MPPT is published as solar.
function solarChargerCandidates(id, values) {
  const base = `electrical.solar.${id}`
  return [
    [`${base}.voltage`, values.battery_voltage_v],
    [`${base}.current`, values.battery_charging_current_a],
    [`${base}.panelPower`, values.solar_power_w],
    [`${base}.yieldToday`, values.yield_today_j],
    [`${base}.loadCurrent`, values.external_device_load_a],
    [`${base}.chargingMode`, values.charge_state],
    [`${base}.chargerError`, values.charger_error]
  ]
}

// The DC/DC converter advertisement carries only voltages plus operating
// state. Output side uses the standard charger voltage leaf; the source side
// is an explicit extension, matching how the Orion XS record is published.
// chargingMode is schema-defined; chargerError is an explicit extension.
function dcDcConverterCandidates(id, values) {
  const base = `electrical.chargers.${id}`
  return [
    [`${base}.voltage`, values.output_voltage_v],
    [`${base}.inputVoltage`, values.input_voltage_v],
    [`${base}.chargingMode`, values.state_name],
    [`${base}.chargerError`, values.error_name]
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
    [`${base}.inputCurrent`, values.input_current_a],
    [`${base}.chargingMode`, values.state_name],
    [`${base}.chargerError`, values.error_name]
  ]
}

module.exports.measurementDelta = measurementDelta
