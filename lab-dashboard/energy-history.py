#!/usr/bin/env python3
"""
energy-history.py — ข้อมูลหน้า Energy (live + ย้อนหลัง) จาก Home Assistant SQLite (read-only)

  energy-history.py live
  energy-history.py history --range 24h|7d|30d|90d   [--start <unix> --end <unix>]

แหล่งพลังงาน (grid / solar / battery / load) กำหนดใน energy-config.json
เซนเซอร์ที่เป็น null = ยังไม่ได้ติดตั้ง → ส่งกลับเป็น available:false
ค่า battery: บวก = คายประจุ (จ่ายเข้าบ้าน), ลบ = กำลังชาร์จ
load ถ้าไม่มีเซนเซอร์ = grid + solar + battery (สมดุลพลังงาน)
"""

import sys
import os
import json
import time
import sqlite3
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, 'energy-config.json')
DEFAULT_DB = '/home/dev/projects/lab-stack/homeassistant/config/home-assistant_v2.db'

SOURCES = ('grid', 'solar', 'battery', 'load')


def load_config():
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def connect(cfg):
    db = cfg.get('db_path') or DEFAULT_DB
    return sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=3)


def fnum(v):
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def latest_states(cur, entity_ids):
    out = {}
    for eid in entity_ids:
        row = cur.execute('''
            SELECT s.state, s.last_updated_ts FROM states s
            JOIN states_meta sm ON s.metadata_id = sm.metadata_id
            WHERE sm.entity_id = ? ORDER BY s.state_id DESC LIMIT 1
        ''', (eid,)).fetchone()
        if row:
            out[eid] = {'value': fnum(row[0]), 'raw': row[0], 'ts': row[1]}
    return out


def stat_ids(cur, entity_ids):
    if not entity_ids:
        return {}
    q = ','.join('?' for _ in entity_ids)
    return {sid: mid for mid, sid in cur.execute(
        f'SELECT id, statistic_id FROM statistics_meta WHERE statistic_id IN ({q})', list(entity_ids))}


def sum_at(cur, mid, ts):
    """ค่า sum สะสม ณ เวลา ts (แถวล่าสุดที่เริ่มก่อน ts) — ใช้ short-term ถ้ามี"""
    for table, span in (('statistics_short_term', 300), ('statistics', 3600)):
        row = cur.execute(f'''SELECT sum FROM {table} WHERE metadata_id=? AND start_ts + ? <= ?
                              ORDER BY start_ts DESC LIMIT 1''', (mid, span, ts)).fetchone()
        if row and row[0] is not None:
            return row[0]
    row = cur.execute('SELECT sum FROM statistics WHERE metadata_id=? ORDER BY start_ts ASC LIMIT 1', (mid,)).fetchone()
    return row[0] if row else None


def energy_between(cur, mid, t0, t1):
    a, b = sum_at(cur, mid, t0), sum_at(cur, mid, t1)
    if a is None or b is None:
        return None
    return max(0.0, b - a)


def cycle_start(now, day):
    if now.day >= day:
        start = now.replace(day=min(day, 28))
    else:
        first = now.replace(day=1) - datetime.timedelta(days=1)
        start = first.replace(day=min(day, first.day))
    return start.replace(hour=0, minute=0, second=0, microsecond=0)


def src_entities(cfg):
    s = cfg.get('sources', {})
    return {k: (s.get(k) or {}) for k in SOURCES}


# ─────────────────────────────── live ───────────────────────────────
def cmd_live(cfg):
    con = connect(cfg)
    cur = con.cursor()
    src = src_entities(cfg)
    extra = cfg.get('grid_meter', {})
    want = set()
    for d in src.values():
        for k in ('power', 'soc'):
            if d.get(k):
                want.add(d[k])
    for v in extra.values():
        if v:
            want.add(v)
    st = latest_states(cur, sorted(want))

    def val(eid):
        return st.get(eid, {}).get('value') if eid else None

    power = {}
    for k in ('grid', 'solar', 'battery'):
        eid = src[k].get('power')
        power[k] = {'available': bool(eid), 'watts': val(eid), 'entity': eid,
                    'ts': st.get(eid, {}).get('ts') if eid else None}
    batt_soc = val(src['battery'].get('soc'))
    power['battery']['soc'] = batt_soc
    lid = src['load'].get('power')
    if lid:
        power['load'] = {'available': True, 'watts': val(lid), 'entity': lid, 'computed': False}
    else:
        total = sum((power[k]['watts'] or 0) for k in ('grid', 'solar', 'battery'))
        power['load'] = {'available': True, 'watts': total, 'entity': None, 'computed': True}

    # พลังงานวันนี้ / รอบบิล
    now = datetime.datetime.now()
    t_now = time.time()
    t_day = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    cyc = cycle_start(now, int(cfg.get('billing_cycle_day', 1)))
    t_cyc = cyc.timestamp()
    emap = {}
    for k in ('grid', 'solar'):
        if src[k].get('energy'):
            emap[k] = src[k]['energy']
    for k in ('energy_in', 'energy_out'):
        if src['battery'].get(k):
            emap['battery_' + k] = src['battery'][k]
    ids = stat_ids(cur, emap.values())
    energy = {'today': {}, 'cycle': {}}
    for key, eid in emap.items():
        mid = ids.get(eid)
        if mid is None:
            continue
        energy['today'][key] = energy_between(cur, mid, t_day, t_now + 1)
        energy['cycle'][key] = energy_between(cur, mid, t_cyc, t_now + 1)
    tariff = float(cfg.get('tariff_thb_per_kwh', 4.42))
    for p in ('today', 'cycle'):
        g = energy[p].get('grid')
        energy[p]['grid_cost_thb'] = round(g * tariff, 2) if g is not None else None

    days_total = ((cyc.replace(day=28) + datetime.timedelta(days=4)).replace(day=1) - cyc.replace(day=1)).days
    days_passed = max((t_now - t_cyc) / 86400.0, 0.04)
    g = energy['cycle'].get('grid')
    energy['cycle']['start_ts'] = t_cyc
    energy['cycle']['days_passed'] = round(days_passed, 2)
    energy['cycle']['days_total'] = days_total
    energy['cycle']['projected_kwh'] = round(g / days_passed * days_total, 1) if g is not None else None
    energy['cycle']['projected_cost_thb'] = round(g / days_passed * days_total * tariff, 0) if g is not None else None

    meter = {k: val(v) for k, v in extra.items()}
    con.close()
    return {'ok': True, 'timestamp': t_now, 'power': power, 'meter': meter,
            'energy': energy, 'tariff_thb_per_kwh': tariff, 'config': public_config(cfg)}


def public_config(cfg):
    src = src_entities(cfg)
    return {
        'sources': {k: {kk: vv for kk, vv in d.items()} for k, d in src.items()},
        'billing_cycle_day': cfg.get('billing_cycle_day', 1),
        'tariff_thb_per_kwh': cfg.get('tariff_thb_per_kwh', 4.42),
        'grid_label': cfg.get('grid_label', 'การไฟฟ้า'),
    }


# ─────────────────────────────── history ───────────────────────────────
RANGES = {'24h': 86400, '48h': 172800, '7d': 7 * 86400, '30d': 30 * 86400, '90d': 90 * 86400}


def power_series(cur, mid, t0, t1, table):
    rows = cur.execute(f'''SELECT start_ts, mean, min, max FROM {table}
                           WHERE metadata_id=? AND start_ts >= ? AND start_ts < ? ORDER BY start_ts''',
                       (mid, t0, t1)).fetchall()
    return {int(r[0]): (r[1], r[2], r[3]) for r in rows if r[1] is not None}


def energy_buckets(cur, mid, t0, t1, step, align_local_day):
    """kWh ต่อ bucket จาก sum ของ statistics รายชั่วโมง (ไม่มี = None)"""
    rows = cur.execute('''SELECT start_ts, sum FROM statistics WHERE metadata_id=? AND start_ts >= ? AND start_ts < ?
                          ORDER BY start_ts''', (mid, t0 - 3600, t1)).fetchall()
    out = {}
    prev = None
    for ts, s in rows:
        if s is None:
            continue
        if prev is not None:
            hour_start = ts
            if align_local_day:
                d = datetime.datetime.fromtimestamp(hour_start)
                key = int(d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
            else:
                key = int(hour_start // step * step)
            if key >= t0 - 86400:
                out[key] = out.get(key, 0.0) + max(0.0, s - prev)
        prev = s
    return out


def cmd_history(cfg, rng, start=None, end=None):
    con = connect(cfg)
    cur = con.cursor()
    src = src_entities(cfg)
    t1 = float(end) if end else time.time()
    t0 = float(start) if start else t1 - RANGES.get(rng, 86400)
    span = t1 - t0
    if span <= 2 * 86400 + 1:
        table, step = 'statistics_short_term', 300
    else:
        table, step = 'statistics', 3600

    pids = {k: src[k].get('power') for k in ('grid', 'solar', 'battery', 'load') if src[k].get('power')}
    if src['battery'].get('soc'):
        pids['soc'] = src['battery']['soc']
    ids = stat_ids(cur, pids.values())
    raw = {k: power_series(cur, ids[e], t0, t1, table) for k, e in pids.items() if e in ids}

    # ถ้า short-term ไม่ครอบคลุม (ช่วงก่อนเก็บ) เติมจาก hourly
    if table == 'statistics_short_term':
        for k, e in pids.items():
            if e in ids and len(raw.get(k, {})) < (span / step) * 0.5:
                hourly = power_series(cur, ids[e], t0, t1, 'statistics')
                for ts, v in hourly.items():
                    raw.setdefault(k, {}).setdefault(ts, v)

    stamps = sorted(set().union(*[set(v.keys()) for v in raw.values()])) if raw else []
    points = []
    for ts in stamps:
        p = {'t': ts}
        for k in ('grid', 'solar', 'battery', 'load', 'soc'):
            v = raw.get(k, {}).get(ts)
            p[k] = round(v[0], 1) if v else None
            if k == 'grid' and v:
                p['grid_min'] = round(v[1], 1) if v[1] is not None else None
                p['grid_max'] = round(v[2], 1) if v[2] is not None else None
        if 'load' not in raw:
            parts = [p.get(k) for k in ('grid', 'solar', 'battery')]
            p['load'] = round(sum(x or 0 for x in parts), 1) if any(x is not None for x in parts) else None
        points.append(p)

    # พลังงานต่อ bucket (รายชั่วโมงสำหรับ ≤2 วัน, รายวันมากกว่านั้น)
    daily = span > 2 * 86400 + 1
    emap = {k: src[k].get('energy') for k in ('grid', 'solar') if src[k].get('energy')}
    for k in ('energy_in', 'energy_out'):
        if src['battery'].get(k):
            emap['battery_' + k] = src['battery'][k]
    eids = stat_ids(cur, emap.values())
    eb = {k: energy_buckets(cur, eids[e], t0, t1, 3600, daily) for k, e in emap.items() if e in eids}
    keys = sorted(set().union(*[set(v.keys()) for v in eb.values()])) if eb else []
    tariff = float(cfg.get('tariff_thb_per_kwh', 4.42))
    bars = []
    for k in keys:
        b = {'t': k}
        for name, series in eb.items():
            b[name] = round(series.get(k, 0.0), 3)
        b['grid_cost_thb'] = round(b.get('grid', 0) * tariff, 2)
        bars.append(b)

    totals = {}
    for name in eb:
        totals[name] = round(sum(b.get(name, 0) for b in bars if t0 - (86400 if daily else 3600) < b['t'] < t1), 3)
    if 'grid' in totals:
        totals['grid_cost_thb'] = round(totals['grid'] * tariff, 2)
    peak = max(points, key=lambda p: p.get('grid_max') or p.get('load') or 0) if points else None

    con.close()
    return {'ok': True, 'range': rng, 'start': t0, 'end': t1, 'step': step,
            'bucket': 'day' if daily else 'hour', 'points': points, 'bars': bars, 'totals': totals,
            'peak': {'t': peak['t'], 'watts': peak.get('grid_max') or peak.get('load')} if peak else None,
            'available': {k: bool(src[k].get('power')) for k in ('grid', 'solar', 'battery')},
            'tariff_thb_per_kwh': tariff}


def main(argv):
    cfg = load_config()
    if len(argv) < 2 or argv[1] == 'live':
        res = cmd_live(cfg)
    elif argv[1] == 'history':
        args = {argv[i]: argv[i + 1] for i in range(2, len(argv) - 1, 2)}
        res = cmd_history(cfg, args.get('--range', '24h'), args.get('--start'), args.get('--end'))
    else:
        res = {'ok': False, 'error': 'unknown command'}
    print(json.dumps(res, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main(sys.argv)
    except Exception as e:  # ส่ง JSON เสมอ ให้ฝั่ง UI แสดงข้อความได้
        print(json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False))
