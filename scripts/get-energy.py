#!/usr/bin/env python3
"""
get-energy.py
Query Home Assistant SQLite database for real-time and historical PZEM-01 power telemetry.
Calculates today's and this month's energy consumption (kWh) and cost (THB).
"""

import sys
import os
import sqlite3
import datetime
import json

DB_PATH = '/home/dev/projects/lab-stack/homeassistant/config/home-assistant_v2.db'

def get_energy_data():
    if not os.path.exists(DB_PATH):
        return {"error": f"Home Assistant database not found at {DB_PATH}"}

    # Open read-only SQLite connection
    con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    cur = con.cursor()

    # 1. Real-time states
    realtime_entities = [
        'sensor.pezem01_power',
        'sensor.pezem01_volt',
        'sensor.pezem01_current',
        'sensor.pezem01_power_factor',
        'sensor.pezem01_energy',
        'sensor.pezem01_energy_cost_3'
    ]

    cur.execute(f'''
        SELECT sm.entity_id, s.state, s.last_updated_ts
        FROM states s
        JOIN states_meta sm ON s.metadata_id = sm.metadata_id
        WHERE sm.entity_id IN ({','.join('?' for _ in realtime_entities)})
        ORDER BY s.state_id DESC LIMIT 40
    ''', realtime_entities)

    rt_states = {}
    for eid, val, ts in cur.fetchall():
        if eid not in rt_states:
            try:
                rt_states[eid] = float(val)
            except:
                rt_states[eid] = val

    power_w = rt_states.get('sensor.pezem01_power', 0.0)
    volt_v = rt_states.get('sensor.pezem01_volt', 0.0)
    current_a = rt_states.get('sensor.pezem01_current', 0.0)
    pf = rt_states.get('sensor.pezem01_power_factor', 0.0)

    # 2. Statistics IDs for energy and cost
    cur.execute('''
        SELECT id, statistic_id, unit_of_measurement
        FROM statistics_meta
        WHERE statistic_id IN ('sensor.pezem01_energy', 'sensor.pezem01_energy_cost_3')
    ''')
    stat_meta = {row[1]: row[0] for row in cur.fetchall()}

    now = datetime.datetime.now()
    start_of_day = datetime.datetime(now.year, now.month, now.day, 0, 0, 0).timestamp()
    start_of_month = datetime.datetime(now.year, now.month, 1, 0, 0, 0).timestamp()

    def get_delta(meta_id):
        if not meta_id:
            return 0.0, 0.0
        # Start of day
        cur.execute('''
            SELECT sum FROM statistics
            WHERE metadata_id = ? AND start_ts >= ?
            ORDER BY start_ts ASC LIMIT 1
        ''', (meta_id, start_of_day))
        r_today = cur.fetchone()
        today_start_sum = r_today[0] if r_today and r_today[0] is not None else None

        # Start of month
        cur.execute('''
            SELECT sum FROM statistics
            WHERE metadata_id = ? AND start_ts >= ?
            ORDER BY start_ts ASC LIMIT 1
        ''', (meta_id, start_of_month))
        r_month = cur.fetchone()
        month_start_sum = r_month[0] if r_month and r_month[0] is not None else None

        # Latest
        cur.execute('''
            SELECT sum FROM statistics
            WHERE metadata_id = ?
            ORDER BY start_ts DESC LIMIT 1
        ''', (meta_id,))
        r_latest = cur.fetchone()
        latest_sum = r_latest[0] if r_latest and r_latest[0] is not None else None

        today_delta = (latest_sum - today_start_sum) if (latest_sum is not None and today_start_sum is not None) else 0.0
        month_delta = (latest_sum - month_start_sum) if (latest_sum is not None and month_start_sum is not None) else 0.0
        return today_delta, month_delta

    energy_meta_id = stat_meta.get('sensor.pezem01_energy')
    cost_meta_id = stat_meta.get('sensor.pezem01_energy_cost_3')

    today_kwh, month_kwh = get_delta(energy_meta_id)
    today_thb, month_thb = get_delta(cost_meta_id)

    # If cost delta is 0 but energy has delta, calculate by standard Thai PEA/MEA rate (~4.4 THB/kWh)
    if today_thb <= 0 and today_kwh > 0:
        today_thb = today_kwh * 4.42
    if month_thb <= 0 and month_kwh > 0:
        month_thb = month_kwh * 4.42

    days_passed = max(1, now.day)
    import calendar
    _, days_in_month = calendar.monthrange(now.year, now.month)
    projected_month_kwh = (month_kwh / days_passed) * days_in_month if days_passed else month_kwh
    projected_month_thb = (month_thb / days_passed) * days_in_month if days_passed else month_thb

    con.close()

    return {
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "device": "PZEM-01 Main Power Grid",
        "realtime": {
            "power_watts": round(power_w, 1),
            "voltage_volts": round(volt_v, 1),
            "current_amps": round(current_a, 2),
            "power_factor": round(pf, 2)
        },
        "today": {
            "energy_kwh": round(today_kwh, 3),
            "cost_thb": round(today_thb, 2)
        },
        "this_month": {
            "month_name": now.strftime("%B %Y"),
            "days_recorded": days_passed,
            "days_total": days_in_month,
            "energy_kwh": round(month_kwh, 3),
            "cost_thb": round(month_thb, 2),
            "projected_kwh": round(projected_month_kwh, 1),
            "projected_cost_thb": round(projected_month_thb, 2)
        }
    }

def main():
    data = get_energy_data()
    if "--json" in sys.argv:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    if "error" in data:
        print(f"Error: {data['error']}")
        sys.exit(1)

    rt = data["realtime"]
    td = data["today"]
    tm = data["this_month"]

    print("=" * 60)
    print(f"⚡ รายงานการใช้พลังงานไฟฟ้า: {data['device']}")
    print(f"🕒 ข้อมูล ณ วันที่: {data['timestamp']}")
    print("=" * 60)
    print("🔌 1. สถานะโหลดไฟฟ้าขณะนี้ (Real-Time):")
    print(f"   • กำลังไฟฟ้า (Power):   {rt['power_watts']:,} วัตต์ (W)")
    print(f"   • แรงดันไฟฟ้า (Voltage): {rt['voltage_volts']} โวลต์ (V)")
    print(f"   • กระแสไฟฟ้า (Current):  {rt['current_amps']} แอมป์ (A)")
    print(f"   • Power Factor:         {rt['power_factor']}")
    print("-" * 60)
    print("📅 2. การใช้ไฟฟ้า 'วันนี้' (Today):")
    print(f"   • พลังงานที่ใช้:       {td['energy_kwh']:.3f} หน่วย (kWh)")
    print(f"   • ค่าไฟวันนี้:          {td['cost_thb']:.2f} บาท (THB)")
    print("-" * 60)
    print(f"📊 3. การใช้ไฟฟ้า 'ทั้งเดือนนี้' ({tm['month_name']} - วันที่ 1 ถึง {tm['days_recorded']}):")
    print(f"   • พลังงานสะสมเดือนนี้:   {tm['energy_kwh']:.3f} หน่วย (kWh)")
    print(f"   • ค่าไฟสะสมเดือนนี้:     {tm['cost_thb']:,.2f} บาท (THB)")
    print(f"   • ประมาณการทั้งเดือน:    ~{tm['projected_kwh']:,.1f} kWh (~{tm['projected_cost_thb']:,.2f} บาท)")
    print("=" * 60)

if __name__ == '__main__':
    main()
