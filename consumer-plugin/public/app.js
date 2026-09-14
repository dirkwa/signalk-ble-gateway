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
  if (decoded?.record_type === 0x02 || decoded?.record_type === 0x0d) {
    return [
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('Battery current', format(measurements?.battery_current_a, 'A')),
      field('State of charge', format(measurements?.state_of_charge_percent, '%')),
      field('Time remaining', duration(measurements?.time_to_go_s)),
      field('Consumed capacity', format(measurements?.consumed_ah, 'Ah')),
      field('Aux reading', measurements?.aux_input),
      field('Starter voltage', format(measurements?.aux_voltage_v, 'V')),
      field('Mid-point voltage', format(measurements?.mid_voltage_v, 'V')),
      field('Temperature', format(measurements?.temperature_k, 'K')),
      field('Alarm reason', hex(measurements?.alarm_reason))
    ]
  }
  if (decoded?.record_type === 0x03) {
    return [
      field('Device state', measurements?.state_name ?? measurements?.state),
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('AC voltage', format(measurements?.ac_voltage_v, 'V')),
      field('AC current', format(measurements?.ac_current_a, 'A')),
      field('AC apparent power', format(measurements?.ac_apparent_power_va, 'VA')),
      field('Alarm reason', hex(measurements?.alarm_reason))
    ]
  }
  if (decoded?.record_type === 0x06) {
    return [
      field('Device state', measurements?.state_name ?? measurements?.state),
      field('Charger error', measurements?.error_name ?? measurements?.error),
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('Battery current', format(measurements?.battery_current_a, 'A')),
      field('PV power', format(measurements?.solar_power_w, 'W')),
      field('Yield today', kilowattHours(measurements?.yield_today_j)),
      field('AC out power', format(measurements?.ac_out_power_w, 'W'))
    ]
  }
  if (decoded?.record_type === 0x05) {
    return [
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('Temperature', format(measurements?.temperature_c, '°C')),
      field('Balancer status', measurements?.balancer_status),
      field('Cell voltages', cellVoltages(measurements?.cell_voltages_v)),
      field('BMS flags', hex(measurements?.bms_flags)),
      field('Error flags', hex(measurements?.error_flags))
    ]
  }
  if (decoded?.record_type === 0x09) {
    return [
      field('Device state', measurements?.state_name ?? measurements?.state),
      field('Output state', measurements?.output_state),
      field('Error', measurements?.error_name ?? measurements?.error),
      field('Input voltage', format(measurements?.input_voltage_v, 'V')),
      field('Output voltage', format(measurements?.output_voltage_v, 'V')),
      field('Alarm reason', hex(measurements?.alarm_reason)),
      field('Warning reason', hex(measurements?.warning_reason)),
      field('Shutdown reason', offReason(measurements))
    ]
  }
  if (decoded?.record_type === 0x0b || decoded?.record_type === 0x0c) {
    return [
      field('Device state', measurements?.state_name ?? measurements?.state),
      field('Error', measurements?.error_name ?? measurements?.ve_bus_error),
      field('Battery voltage', format(measurements?.battery_voltage_v, 'V')),
      field('Battery current', format(measurements?.battery_current_a, 'A')),
      field('Active AC input', measurements?.active_ac_input),
      field('Active AC power', format(measurements?.active_ac_power_w, 'W')),
      field('AC out power', format(measurements?.ac_out_power_w, 'W')),
      field('PV power', format(measurements?.solar_power_w, 'W')),
      field('Yield today', kilowattHours(measurements?.yield_today_j)),
      field('State of charge', format(measurements?.state_of_charge_percent, '%')),
      field('Temperature', format(measurements?.temperature_c, '°C')),
      field('Alarm', measurements?.alarm)
    ]
  }
  return []
}

// Cell position is meaningful: a missing cell 3 must not make cell 4 look
// like cell 3. Unavailable cells keep their slot as a dash.
function cellVoltages(cells) {
  if (!Array.isArray(cells) || !cells.some(cell => cell != null)) return null
  return cells.map(cell => {
    if (cell == null) return '–'
    const value = cell.voltage_v.toFixed(2)
    if (cell.bound === 'below') return `<${value}`
    if (cell.bound === 'above') return `>${value}`
    return value
  }).join(' / ') + ' V'
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
