'use strict'

const endpoint = '/plugins/signalk-victron-ble-consumer/status'
const summary = document.querySelector('#summary')
const devices = document.querySelector('#devices')
const connection = document.querySelector('#connection')
const template = document.querySelector('#device-template')

function field(term, value) {
  return `<dt>${term}</dt><dd>${value ?? '–'}</dd>`
}

function render(status) {
  summary.innerHTML = [
    ['Received', status.received], ['Decoded', status.decoded],
    ['Ignored', status.ignored], ['Errors', status.errors]
  ].map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('')

  devices.replaceChildren()
  for (const device of status.devices) {
    const card = template.content.cloneNode(true)
    card.querySelector('h3').textContent = device.name || device.id
    card.querySelector('.mac').textContent = device.mac
    const state = card.querySelector('.state')
    state.textContent = device.online ? 'Online' : 'Waiting'
    state.classList.toggle('online', device.online)
    const commonFields = [
      field('Gateway', device.gateway_id), field('RSSI', device.rssi == null ? null : `${device.rssi} dBm`),
      field('Last seen', device.last_seen ? new Date(device.last_seen).toLocaleString() : null),
      field('Key', device.key_configured ? 'configured' : 'missing'),
      field('Record', device.decoded?.record_name),
      field('Model ID', device.decoded ? `0x${device.decoded.model_id.toString(16).toUpperCase()}` : null)
    ]
    card.querySelector('dl').innerHTML = [
      ...commonFields,
      ...measurementFields(device.decoded)
    ].join('')
    const error = card.querySelector('.error')
    if (device.decode_error) { error.hidden = false; error.textContent = device.decode_error }
    devices.append(card)
  }
  if (!status.devices.length) devices.innerHTML = '<p>No devices configured yet.</p>'
}

function measurementFields(decoded) {
  const measurements = decoded?.measurements
  if (decoded?.record_type === 0x0a) {
    return [
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('Battery current', format(measurements?.battery_current_a, 'A')),
      field('State of charge', format(measurements?.state_of_charge_percent, '%')),
      field('Temperature', format(measurements?.temperature_c, '°C')),
      field('Time remaining', duration(measurements?.time_to_go_s)),
      field('Consumed capacity', format(measurements?.consumed_ah, 'Ah')),
      field('BMS error', measurements?.error),
      field('I/O status', hex(measurements?.io_status)),
      field('Warnings/alarms', hex(measurements?.warnings_alarms))
    ]
  }
  if (decoded?.record_type === 0x0f) {
    return [
      field('Charge state', measurements?.state_name ?? measurements?.state),
      field('Charger error', measurements?.error_name ?? measurements?.error),
      field('Input voltage', format(measurements?.input_voltage_v, 'V')),
      field('Input current', format(measurements?.input_current_a, 'A')),
      field('Output voltage', format(measurements?.output_voltage_v, 'V')),
      field('Output current', format(measurements?.output_current_a, 'A')),
      field('Shutdown reason', offReason(measurements))
    ]
  }
  if (decoded?.record_type === 0x01) {
    return [
      field('Charge state', measurements?.charge_state),
      field('Charger error', measurements?.charger_error),
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('Charging current', format(measurements?.battery_charging_current_a, 'A')),
      field('PV power', format(measurements?.solar_power_w, 'W')),
      field('Yield today', kilowattHours(measurements?.yield_today_j)),
      field('Load current', format(measurements?.external_device_load_a, 'A'))
    ]
  }
  if (decoded?.record_type === 0x04) {
    return [
      field('Device state', measurements?.state_name ?? measurements?.state),
      field('Charger error', measurements?.error_name ?? measurements?.error),
      field('Input voltage', format(measurements?.input_voltage_v, 'V')),
      field('Output voltage', format(measurements?.output_voltage_v, 'V')),
      field('Shutdown reason', offReason(measurements))
    ]
  }
  return []
}

// Yield is carried in joules to match the Signal K unit. Operators read daily
// yield in kWh, which is also the unit VictronConnect shows.
function kilowattHours(joules) {
  return joules == null ? null : `${(joules / 3600000).toFixed(2)} kWh`
}

function format(value, unit) {
  return value == null ? null : `${Number(value).toFixed(1)} ${unit}`
}

function hex(value) {
  return value == null ? null : `0x${Number(value).toString(16).toUpperCase()}`
}

function offReason(measurements) {
  if (measurements?.off_reason == null) return null
  const labels = (measurements.off_reasons || []).map(reason =>
    reason === 'engine_shutdown' ? '#8 Engine shutdown' : reason
  )
  return labels.length
    ? `${labels.join(', ')} (${hex(measurements.off_reason)})`
    : hex(measurements.off_reason)
}

function duration(seconds) {
  if (seconds == null) return null
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days} d ${hours} h ${minutes} min`
}

async function refresh() {
  try {
    const response = await fetch(endpoint, { credentials: 'include' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    render(await response.json())
    connection.textContent = 'Live'
    connection.classList.add('online')
  } catch (error) {
    connection.textContent = `Offline · ${error.message}`
    connection.classList.remove('online')
  }
}

refresh()
setInterval(refresh, 3000)
