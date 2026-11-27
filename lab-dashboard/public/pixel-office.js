/*
 * Homelab Pixel Company — Interactive 2D Pixel-Art Office Engine
 * Classic IIFE using window.PixelOfficeArt (pure Canvas 2D, zero external assets).
 * Exports: window.HomelabPixelOffice = { mount }
 * Dispatches: window Event 'homelab:pixeloffice-ready'
 */
(function (root) {
  'use strict';

  var TILE = 16;
  var WORLD_W_TILES = 64;
  var WORLD_H_TILES = 40;
  var WORLD_W = WORLD_W_TILES * TILE; // 1024
  var WORLD_H = WORLD_H_TILES * TILE; // 640

  // ---------------------------------------------------------------------------
  // 1. Departments & Office Layout (64 x 40 tiles)
  // ---------------------------------------------------------------------------
  var DEPTS = {
    all:    { id: 'all',    label: '🏢 ภาพรวมทั้งบริษัท', color: '#6b7799' },
    ai:     { id: 'ai',     label: '🤖 ฝ่าย AI Chat',      color: '#6d4bc4' },
    video:  { id: 'video',  label: '🎬 ฝ่ายผลิตวิดีโอ',    color: '#d9667a' },
    cron:   { id: 'cron',   label: '⏰ ฝ่ายงานตั้งเวลา',   color: '#c9a23a' },
    hub:    { id: 'hub',    label: '🖥️ ฝ่าย IT / Hub',     color: '#3d6fb6' },
    ops:    { id: 'ops',    label: '🛡️ ฝ่ายปฏิบัติการ',    color: '#3f8f6a' },
    lounge: { id: 'lounge', label: '☕ โถงพักผ่อนและสวน',  color: '#8a6a4a' }
  };

  // Walkable corridors linking all 20 rooms seamlessly
  var CORRIDORS = [
    { id: 'H1', x: 1,  y: 10, w: 62, h: 2 }, // Between Row 1 (AI+Hub) and Row 2 (Video)
    { id: 'H2', x: 1,  y: 20, w: 62, h: 2 }, // Video Pipeline Boulevard (yellow arrows)
    { id: 'H3', x: 1,  y: 30, w: 50, h: 2 }, // Lower Hallway (Cron, Ops, Lobby, Cafe, Games, Gym, Garden)
    { id: 'VC', x: 25, y: 10, w: 2,  h: 22 } // Central Vertical Hallway linking H1 <-> H2 <-> H3
  ];

  // Yellow directional pipeline arrows painted on corridor floors
  var PIPELINE_ARROWS = [
    // AI Chat pipeline on H1 (y = 10.65)
    { x: 9.2,  y: 10.55, dir: 'right', dept: 'ai',    stageFrom: 'ai_router',    stageTo: 'ai_architect' },
    { x: 19.2, y: 10.55, dir: 'right', dept: 'ai',    stageFrom: 'ai_architect', stageTo: 'ai_workers' },
    { x: 33.2, y: 10.55, dir: 'right', dept: 'ai',    stageFrom: 'ai_workers',   stageTo: 'ai_review' },
    { x: 43.2, y: 10.55, dir: 'right', dept: 'hub',   stageFrom: 'ai_review',    stageTo: 'hub_dispatch' },
    { x: 52.2, y: 10.55, dir: 'right', dept: 'hub',   stageFrom: 'hub_dispatch', stageTo: 'hub_workers' },
    // Video Studio 5-stage pipeline on H2 (y = 20.55)
    { x: 10.8, y: 20.55, dir: 'right', dept: 'video', stageFrom: 'vid_script',   stageTo: 'vid_art' },
    { x: 22.8, y: 20.55, dir: 'right', dept: 'video', stageFrom: 'vid_art',      stageTo: 'vid_tts' },
    { x: 28.0, y: 20.55, dir: 'right', dept: 'video', stageFrom: 'vid_art',      stageTo: 'vid_tts' },
    { x: 36.8, y: 20.55, dir: 'right', dept: 'video', stageFrom: 'vid_tts',      stageTo: 'vid_edit' },
    { x: 48.8, y: 20.55, dir: 'right', dept: 'video', stageFrom: 'vid_edit',     stageTo: 'vid_publish' },
    // Cron scheduler -> Morning News on H3
    { x: 10.8, y: 30.55, dir: 'right', dept: 'cron',  stageFrom: 'cron_sched',   stageTo: 'cron_news' }
  ];

  // 20 rooms across 6 departments on 64x40 tile grid
  var LAYOUT = {
    widthTiles: WORLD_W_TILES,
    heightTiles: WORLD_H_TILES,
    tile: TILE,
    corridors: CORRIDORS,
    arrows: PIPELINE_ARROWS,
    rooms: [
      // ===================== ROW 1: AI CHAT (4 rooms) =====================
      {
        deptId: 'ai',
        roomId: 'ai_router',
        label: '🤖 เราเตอร์ AI',
        desc: 'คัดกรองและกระจายคำสั่งแชท AI',
        rect: { x: 1, y: 2, w: 10, h: 8 },
        floor: 'carpet',
        floorColor: 'ai',
        doors: [{ x: 5, y: 9 }],
        seats: [{ x: 5, y: 5, dir: 'down', deskX: 4.5, deskY: 5.55 }],
        handoffSpot: { x: 8, y: 7 },
        idleSpots: [{ x: 8, y: 6, dir: 'down' }],
        furniture: [
          { type: 'window_city', x: 3.2, y: 3.05, layer: 'static' },
          { type: 'plant',       x: 8.6, y: 3.15, layer: 'static' },
          { type: 'cabinet',     x: 1.5, y: 3.2,  layer: 'static' },
          { type: 'chair',       x: 5.05, y: 5.05, layer: 'static' },
          { type: 'desk',        x: 4.5, y: 5.55, layer: 'fg', solid: [{ x: 4, y: 6 }, { x: 5, y: 6 }] },
          { type: 'dual_monitor', x: 4.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#8d7bff' }
        ]
      },
      {
        deptId: 'ai',
        roomId: 'ai_architect',
        label: '📐 สถาปนิก',
        desc: 'วางพิมพ์เขียวและแตกงานย่อย (ด่าน 1)',
        rect: { x: 11, y: 2, w: 10, h: 8 },
        floor: 'carpet',
        floorColor: 'ai',
        doors: [{ x: 15, y: 9 }],
        seats: [{ x: 15, y: 5, dir: 'down', deskX: 14.5, deskY: 5.55 }],
        handoffSpot: { x: 18, y: 7 },
        idleSpots: [{ x: 18, y: 5, dir: 'up', kind: 'read_book' }],
        furniture: [
          { type: 'whiteboard', x: 12.6, y: 3.05, layer: 'static' },
          { type: 'bookshelf',  x: 18.0, y: 3.05, layer: 'static' },
          { type: 'chair',      x: 15.05, y: 5.05, layer: 'static' },
          { type: 'desk',       x: 14.5, y: 5.55, layer: 'fg', solid: [{ x: 14, y: 6 }, { x: 15, y: 6 }] },
          { type: 'dual_monitor', x: 14.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#a47eff' }
        ]
      },
      {
        deptId: 'ai',
        roomId: 'ai_workers',
        label: '⚡ เวิร์กเกอร์',
        desc: 'ทีมลงมือเขียนโค้ดและแก้บั๊ก (ด่าน 2)',
        rect: { x: 21, y: 2, w: 14, h: 8 },
        floor: 'wood',
        doors: [{ x: 27, y: 9 }],
        seats: [
          { x: 23, y: 5, dir: 'down', deskX: 22.5, deskY: 5.55 },
          { x: 27, y: 5, dir: 'down', deskX: 26.5, deskY: 5.55 },
          { x: 31, y: 5, dir: 'down', deskX: 30.5, deskY: 5.55 }
        ],
        handoffSpot: { x: 29, y: 7 },
        idleSpots: [{ x: 25, y: 7, dir: 'down' }],
        furniture: [
          { type: 'kanban_board', x: 22.2, y: 3.05, layer: 'static' },
          { type: 'window_city',  x: 26.4, y: 3.05, layer: 'static' },
          { type: 'kanban_board', x: 30.8, y: 3.05, layer: 'static' },
          { type: 'chair', x: 23.05, y: 5.05, layer: 'static' },
          { type: 'chair', x: 27.05, y: 5.05, layer: 'static' },
          { type: 'chair', x: 31.05, y: 5.05, layer: 'static' },
          { type: 'desk',  x: 22.5, y: 5.55, layer: 'fg', solid: [{ x: 22, y: 6 }, { x: 23, y: 6 }] },
          { type: 'desk',  x: 26.5, y: 5.55, layer: 'fg', solid: [{ x: 26, y: 6 }, { x: 27, y: 6 }] },
          { type: 'desk',  x: 30.5, y: 5.55, layer: 'fg', solid: [{ x: 30, y: 6 }, { x: 31, y: 6 }] },
          { type: 'dual_monitor', x: 22.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#38e8c6' },
          { type: 'dual_monitor', x: 26.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#59c7ff' },
          { type: 'dual_monitor', x: 30.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#b785ff' }
        ]
      },
      {
        deptId: 'ai',
        roomId: 'ai_review',
        label: '🔍 รีวิว/QC',
        desc: 'ตรวจคุณภาพ โค้ดรีวิว และทดสอบ (ด่าน 3)',
        rect: { x: 35, y: 2, w: 10, h: 8 },
        floor: 'carpet',
        floorColor: 'ai',
        doors: [{ x: 39, y: 9 }],
        seats: [{ x: 39, y: 5, dir: 'down', deskX: 38.5, deskY: 5.55 }],
        handoffSpot: { x: 41, y: 7 },
        idleSpots: [{ x: 37, y: 7, dir: 'down' }],
        furniture: [
          { type: 'whiteboard', x: 36.6, y: 3.05, layer: 'static' },
          { type: 'plant',      x: 42.6, y: 3.15, layer: 'static' },
          { type: 'printer',    x: 42.2, y: 6.4,  layer: 'static' },
          { type: 'chair',      x: 39.05, y: 5.05, layer: 'static' },
          { type: 'desk',       x: 38.5, y: 5.55, layer: 'fg', solid: [{ x: 38, y: 6 }, { x: 39, y: 6 }] },
          { type: 'dual_monitor', x: 38.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#4de09d' }
        ]
      },

      // ===================== ROW 1 RIGHT: IT / AGENT HUB (2 rooms) =====================
      {
        deptId: 'hub',
        roomId: 'hub_dispatch',
        label: '📡 ดิสแพตช์',
        desc: 'จัดคิวและจ่ายงานหนักไปลูกข่าย Agent Hub',
        rect: { x: 45, y: 2, w: 9, h: 8 },
        floor: 'tile',
        doors: [{ x: 49, y: 9 }],
        seats: [{ x: 48, y: 5, dir: 'down', deskX: 47.5, deskY: 5.55 }],
        handoffSpot: { x: 51, y: 7 },
        idleSpots: [{ x: 51, y: 6, dir: 'left' }],
        furniture: [
          { type: 'window_city', x: 46.2, y: 3.05, layer: 'static' },
          { type: 'server_rack', x: 51.4, y: 3.1,  layer: 'static', rack: true },
          { type: 'chair',       x: 48.05, y: 5.05, layer: 'static' },
          { type: 'desk',        x: 47.5, y: 5.55, layer: 'fg', solid: [{ x: 47, y: 6 }, { x: 48, y: 6 }] },
          { type: 'dual_monitor', x: 47.65, y: 5.35, layer: 'fg', screen: true, screenCol: '#4fc3ff' }
        ]
      },
      {
        deptId: 'hub',
        roomId: 'hub_workers',
        label: '🖥️ เซิร์ฟเวอร์',
        desc: 'เครื่องลูกข่าย GPU/CPU (asridaytrade, servergigi)',
        rect: { x: 54, y: 2, w: 9, h: 8 },
        floor: 'concrete',
        doors: [{ x: 58, y: 9 }],
        seats: [
          { x: 56, y: 5, dir: 'down', deskX: 55.4, deskY: 5.6 },
          { x: 60, y: 5, dir: 'down', deskX: 59.4, deskY: 5.6 }
        ],
        handoffSpot: { x: 58, y: 7 },
        idleSpots: [{ x: 58, y: 6, dir: 'up' }],
        furniture: [
          { type: 'server_rack', x: 55.2, y: 3.05, layer: 'static', rack: true },
          { type: 'server_rack', x: 57.6, y: 3.05, layer: 'static', rack: true },
          { type: 'server_rack', x: 60.0, y: 3.05, layer: 'static', rack: true },
          { type: 'chair', x: 56.05, y: 5.1, layer: 'static' },
          { type: 'chair', x: 60.05, y: 5.1, layer: 'static' },
          { type: 'desk',  x: 55.4, y: 5.6, layer: 'fg', opts: { w: 28 }, solid: [{ x: 55, y: 6 }] },
          { type: 'desk',  x: 59.4, y: 5.6, layer: 'fg', opts: { w: 28 }, solid: [{ x: 59, y: 6 }] },
          { type: 'pc',    x: 55.7, y: 5.35, layer: 'fg', screen: true, screenCol: '#38e8c6' },
          { type: 'pc',    x: 59.7, y: 5.35, layer: 'fg', screen: true, screenCol: '#38e8c6' }
        ]
      },

      // ===================== ROW 2: VIDEO STUDIO PIPELINE (5 rooms) =====================
      {
        deptId: 'video',
        roomId: 'vid_script',
        label: '📝 สคริปต์',
        desc: 'วิจัยข้อมูลและเขียนบทวิดีโอ (ขั้น 1)',
        rect: { x: 1, y: 12, w: 12, h: 8 },
        floor: 'carpet',
        floorColor: 'video',
        doors: [{ x: 6, y: 19 }],
        seats: [{ x: 6, y: 15, dir: 'down', deskX: 5.5, deskY: 15.55 }],
        handoffSpot: { x: 9, y: 17 },
        idleSpots: [{ x: 9, y: 16, dir: 'up', kind: 'read_book' }],
        furniture: [
          { type: 'whiteboard', x: 2.6,  y: 13.05, layer: 'static' },
          { type: 'bookshelf',  x: 9.6,  y: 13.05, layer: 'static' },
          { type: 'plant',      x: 1.6,  y: 16.5,  layer: 'static' },
          { type: 'chair',      x: 6.05, y: 15.05, layer: 'static' },
          { type: 'desk',       x: 5.5,  y: 15.55, layer: 'fg', solid: [{ x: 5, y: 16 }, { x: 6, y: 16 }] },
          { type: 'pc',         x: 5.9,  y: 15.35, layer: 'fg', screen: true, screenCol: '#ff96ad' }
        ]
      },
      {
        deptId: 'video',
        roomId: 'vid_art',
        label: '🎨 วาดภาพ',
        desc: 'ออกแบบฉาก สตอรี่บอร์ด และภาพประกอบ (ขั้น 2)',
        rect: { x: 13, y: 12, w: 12, h: 8 },
        floor: 'wood',
        doors: [{ x: 18, y: 19 }],
        seats: [{ x: 18, y: 15, dir: 'down', deskX: 17.5, deskY: 15.55 }],
        handoffSpot: { x: 21, y: 17 },
        idleSpots: [{ x: 21, y: 15, dir: 'left' }],
        furniture: [
          { type: 'easel',      x: 21.4, y: 13.3,  layer: 'static' },
          { type: 'whiteboard', x: 14.4, y: 13.05, layer: 'static' },
          { type: 'plant',      x: 13.6, y: 16.5,  layer: 'static' },
          { type: 'chair',      x: 18.05, y: 15.05, layer: 'static' },
          { type: 'desk',       x: 17.5, y: 15.55, layer: 'fg', solid: [{ x: 17, y: 16 }, { x: 18, y: 16 }] },
          { type: 'dual_monitor', x: 17.65, y: 15.35, layer: 'fg', screen: true, screenCol: '#ff7ea5' }
        ]
      },
      {
        deptId: 'video',
        roomId: 'vid_tts',
        label: '🎙️ อัดเสียง',
        desc: 'พากย์เสียงไทย TTS และซิงค์คำบรรยาย (ขั้น 3)',
        rect: { x: 27, y: 12, w: 12, h: 8 },
        floor: 'carpet',
        floorColor: 'video',
        doors: [{ x: 32, y: 19 }],
        seats: [{ x: 32, y: 15, dir: 'down', deskX: 31.5, deskY: 15.55 }],
        handoffSpot: { x: 35, y: 17 },
        idleSpots: [{ x: 35, y: 16, dir: 'left' }],
        furniture: [
          { type: 'mic_booth',      x: 35.4, y: 13.15, layer: 'static' },
          { type: 'clock',          x: 28.4, y: 13.15, layer: 'static' },
          { type: 'plant',          x: 27.6, y: 16.5,  layer: 'static' },
          { type: 'chair',          x: 32.05, y: 15.05, layer: 'static' },
          { type: 'mixing_console', x: 31.5, y: 15.55, layer: 'fg', solid: [{ x: 31, y: 16 }, { x: 32, y: 16 }] }
        ]
      },
      {
        deptId: 'video',
        roomId: 'vid_edit',
        label: '✂️ ตัดต่อ',
        desc: 'เรนเดอร์ Remotion + มิกซ์เสียง BGM/SFX (ขั้น 4)',
        rect: { x: 39, y: 12, w: 12, h: 8 },
        floor: 'tile',
        doors: [{ x: 44, y: 19 }],
        seats: [{ x: 44, y: 15, dir: 'down', deskX: 43.5, deskY: 15.55 }],
        handoffSpot: { x: 47, y: 17 },
        idleSpots: [{ x: 47, y: 16, dir: 'left' }],
        furniture: [
          { type: 'film_camera',  x: 47.8, y: 13.4,  layer: 'static' },
          { type: 'kanban_board', x: 40.5, y: 13.05, layer: 'static' },
          { type: 'chair',        x: 44.05, y: 15.05, layer: 'static' },
          { type: 'desk',         x: 43.5, y: 15.55, layer: 'fg', solid: [{ x: 43, y: 16 }, { x: 44, y: 16 }] },
          { type: 'dual_monitor', x: 43.65, y: 15.35, layer: 'fg', screen: true, screenCol: '#ffd05c' }
        ]
      },
      {
        deptId: 'video',
        roomId: 'vid_publish',
        label: '🚀 เผยแพร่',
        desc: 'QC ตรวจสอบ ส่ง Telegram และโพสต์โซเชียล (ขั้น 5)',
        rect: { x: 51, y: 12, w: 12, h: 8 },
        floor: 'carpet',
        floorColor: 'video',
        doors: [{ x: 56, y: 19 }],
        seats: [{ x: 56, y: 15, dir: 'down', deskX: 55.5, deskY: 15.55 }],
        handoffSpot: { x: 59, y: 17 },
        idleSpots: [{ x: 59, y: 16, dir: 'left' }],
        furniture: [
          { type: 'rocket_antenna', x: 59.6, y: 13.15, layer: 'static' },
          { type: 'kanban_board',   x: 52.5, y: 13.05, layer: 'static' },
          { type: 'plant',          x: 51.6, y: 16.5,  layer: 'static' },
          { type: 'chair',          x: 56.05, y: 15.05, layer: 'static' },
          { type: 'desk',           x: 55.5, y: 15.55, layer: 'fg', solid: [{ x: 55, y: 16 }, { x: 56, y: 16 }] },
          { type: 'dual_monitor',   x: 55.65, y: 15.35, layer: 'fg', screen: true, screenCol: '#ff7096' }
        ]
      },

      // ===================== ROW 3A LEFT: CRON & SCHEDULER (2 rooms) =====================
      {
        deptId: 'cron',
        roomId: 'cron_sched',
        label: '⏰ ตั้งเวลา',
        desc: 'จัดการตารางงาน Cron อัตโนมัติทั้งระบบ',
        rect: { x: 1, y: 22, w: 12, h: 8 },
        floor: 'wood',
        doors: [{ x: 6, y: 29 }],
        seats: [{ x: 6, y: 25, dir: 'down', deskX: 5.5, deskY: 25.55 }],
        handoffSpot: { x: 9, y: 27 },
        idleSpots: [{ x: 9, y: 26, dir: 'down' }],
        furniture: [
          { type: 'calendar_board', x: 2.5,  y: 23.05, layer: 'static' },
          { type: 'clock',          x: 9.8,  y: 23.15, layer: 'static' },
          { type: 'cabinet',        x: 10.2, y: 26.2,  layer: 'static' },
          { type: 'chair',          x: 6.05, y: 25.05, layer: 'static' },
          { type: 'desk',           x: 5.5,  y: 25.55, layer: 'fg', solid: [{ x: 5, y: 26 }, { x: 6, y: 26 }] },
          { type: 'pc',             x: 5.9,  y: 25.35, layer: 'fg', screen: true, screenCol: '#f2c94c' }
        ]
      },
      {
        deptId: 'cron',
        roomId: 'cron_news',
        label: '📰 ข่าวเช้า',
        desc: 'ผลิตคลิปรายการข่าวเช้า Daily News Broadcast v2',
        rect: { x: 13, y: 22, w: 12, h: 8 },
        floor: 'carpet',
        floorColor: 'cron',
        doors: [{ x: 18, y: 29 }],
        seats: [{ x: 18, y: 25, dir: 'down', deskX: 17.5, deskY: 25.55 }],
        handoffSpot: { x: 21, y: 27 },
        idleSpots: [{ x: 21, y: 26, dir: 'left' }],
        furniture: [
          { type: 'whiteboard',  x: 14.5, y: 23.05, layer: 'static' },
          { type: 'film_camera', x: 21.8, y: 23.4,  layer: 'static' },
          { type: 'printer',     x: 14.0, y: 26.8,  layer: 'static' },
          { type: 'chair',       x: 18.05, y: 25.05, layer: 'static' },
          { type: 'desk',        x: 17.5, y: 25.55, layer: 'fg', solid: [{ x: 17, y: 26 }, { x: 18, y: 26 }] },
          { type: 'dual_monitor', x: 17.65, y: 25.35, layer: 'fg', screen: true, screenCol: '#ffd966' }
        ]
      },

      // ===================== ROW 3B LEFT: OPERATIONS / INFRA (2 rooms) =====================
      {
        deptId: 'ops',
        roomId: 'ops_monitor',
        label: '🛡️ มอนิเตอร์',
        desc: 'เฝ้าระวัง Docker, PM2, Kuma และสุขภาพเซิร์ฟเวอร์',
        rect: { x: 1, y: 32, w: 12, h: 7 },
        floor: 'concrete',
        doors: [{ x: 2, y: 32 }],
        seats: [{ x: 6, y: 35, dir: 'down', deskX: 5.5, deskY: 35.55 }],
        handoffSpot: { x: 4, y: 34 },
        idleSpots: [{ x: 9, y: 35, dir: 'left' }],
        furniture: [
          { type: 'server_rack', x: 10.2, y: 33.15, layer: 'static', rack: true },
          { type: 'plant',       x: 1.6,  y: 35.8,  layer: 'static' },
          { type: 'chair',       x: 6.05, y: 35.05, layer: 'static' },
          { type: 'desk',        x: 5.5,  y: 35.55, layer: 'fg', solid: [{ x: 5, y: 36 }, { x: 6, y: 36 }] },
          { type: 'dual_monitor', x: 5.65, y: 35.35, layer: 'fg', screen: true, screenCol: '#4de09d' }
        ]
      },
      {
        deptId: 'ops',
        roomId: 'ops_energy',
        label: '⚡ พลังงาน',
        desc: 'ติดตามมิเตอร์ไฟฟ้า PZEM-01 และค่าไฟแบบเรียลไทม์',
        rect: { x: 13, y: 32, w: 12, h: 7 },
        floor: 'tile',
        doors: [{ x: 23, y: 32 }],
        seats: [{ x: 18, y: 35, dir: 'down', deskX: 17.5, deskY: 35.55 }],
        handoffSpot: { x: 21, y: 34 },
        idleSpots: [{ x: 15, y: 35, dir: 'right' }],
        furniture: [
          { type: 'cabinet', x: 14.0, y: 33.2,  layer: 'static' },
          { type: 'clock',   x: 21.8, y: 33.3,  layer: 'static' },
          { type: 'plant',   x: 22.8, y: 35.8,  layer: 'static' },
          { type: 'chair',   x: 18.05, y: 35.05, layer: 'static' },
          { type: 'desk',    x: 17.5, y: 35.55, layer: 'fg', solid: [{ x: 17, y: 36 }, { x: 18, y: 36 }] },
          { type: 'dual_monitor', x: 17.65, y: 35.35, layer: 'fg', screen: true, screenCol: '#59e5a8' }
        ]
      },

      // ===================== ROW 3 CENTER & RIGHT: LOUNGE & RECREATION (5 areas) =====================
      {
        deptId: 'lounge',
        roomId: 'lounge_cafe',
        label: '☕ คาเฟ่',
        desc: 'มุมชงกาแฟ ตู้ขนม และโซฟาพักสายตา',
        rect: { x: 27, y: 22, w: 12, h: 8 },
        floor: 'wood',
        doors: [{ x: 32, y: 29 }],
        seats: [],
        handoffSpot: { x: 32, y: 27 },
        idleSpots: [
          { x: 29, y: 25, dir: 'up',    kind: 'coffee' },
          { x: 31, y: 25, dir: 'up',    kind: 'coffee' },
          { x: 36, y: 25, dir: 'up',    kind: 'snack' },
          { x: 30, y: 27, dir: 'down',  kind: 'sofa_nap' },
          { x: 34, y: 27, dir: 'right', kind: 'hallway_chat_group' },
          { x: 36, y: 27, dir: 'left',  kind: 'hallway_chat_group' }
        ],
        furniture: [
          { type: 'rug',             x: 28.5, y: 25.6,  layer: 'static', opts: { color: '#7a5238' } },
          { type: 'coffee_machine',  x: 28.8, y: 23.15, layer: 'static' },
          { type: 'vending_machine', x: 35.8, y: 23.05, layer: 'static' },
          { type: 'plant',           x: 27.6, y: 23.3,  layer: 'static' },
          { type: 'clock',           x: 32.6, y: 23.25, layer: 'static' },
          { type: 'sofa',            x: 29.0, y: 26.6,  layer: 'fg', solid: [{ x: 29, y: 27 }] }
        ]
      },
      {
        deptId: 'lounge',
        roomId: 'lounge_games',
        label: '🃏 มุมเกม',
        desc: 'โต๊ะไพ่ โต๊ะปิงปอง และมุมหนังสือคลายเครียด',
        rect: { x: 39, y: 22, w: 12, h: 8 },
        floor: 'carpet',
        floorColor: 'lounge',
        doors: [{ x: 44, y: 29 }],
        seats: [],
        handoffSpot: { x: 44, y: 27 },
        idleSpots: [
          // 4 seats around card table (group card game!)
          { x: 41, y: 25, dir: 'right', kind: 'cards_group' },
          { x: 43, y: 25, dir: 'left',  kind: 'cards_group' },
          { x: 42, y: 24, dir: 'down',  kind: 'cards_group' },
          { x: 42, y: 27, dir: 'up',    kind: 'cards_group' },
          // 2 spots facing across pingpong table (group pingpong!)
          { x: 46, y: 26, dir: 'right', kind: 'pingpong_group' },
          { x: 49, y: 26, dir: 'left',  kind: 'pingpong_group' },
          // Bookshelf reading spot
          { x: 47, y: 24, dir: 'up',    kind: 'read_book' }
        ],
        furniture: [
          { type: 'rug',            x: 40.5, y: 24.4,  layer: 'static', opts: { color: '#5c4b6e', w: 56, h: 42 } },
          { type: 'bookshelf',      x: 46.8, y: 23.02, layer: 'static' },
          { type: 'plant',          x: 49.4, y: 23.2,  layer: 'static' },
          { type: 'card_table',     x: 41.3, y: 24.8,  layer: 'fg', solid: [{ x: 42, y: 25 }] },
          { type: 'pingpong_table', x: 46.6, y: 25.4,  layer: 'fg', solid: [{ x: 47, y: 26 }, { x: 48, y: 26 }] }
        ]
      },
      {
        deptId: 'lounge',
        roomId: 'lounge_lobby',
        label: '🛎️ ต้อนรับ',
        desc: 'โถงต้อนรับหน้าบริษัท ประตูทางเข้าหลัก',
        rect: { x: 25, y: 32, w: 14, h: 7 },
        floor: 'tile',
        doors: [
          { x: 26, y: 32 },
          { x: 36, y: 32 }
        ],
        frontEntrance: { x: 31, y: 38, w: 2 },
        seats: [{ x: 28, y: 35, dir: 'down', deskX: 27.5, deskY: 35.6 }],
        handoffSpot: { x: 32, y: 35 },
        idleSpots: [
          { x: 34, y: 34, dir: 'right', kind: 'water_chat_group' },
          { x: 36, y: 34, dir: 'left',  kind: 'water_chat_group' },
          { x: 31, y: 36, dir: 'up',    kind: 'lobby_chat' }
        ],
        furniture: [
          { type: 'rug',          x: 30.5, y: 35.6,  layer: 'static', opts: { w: 48, h: 36, color: '#9c2d3a' } },
          { type: 'water_cooler', x: 34.8, y: 33.15, layer: 'static' },
          { type: 'plant',        x: 26.0, y: 36.1,  layer: 'static' },
          { type: 'plant',        x: 37.0, y: 36.1,  layer: 'static' },
          { type: 'chair',        x: 28.05, y: 35.1, layer: 'static' },
          { type: 'desk',         x: 27.5, y: 35.6,  layer: 'fg', opts: { color: '#a86b3a' }, solid: [{ x: 27, y: 36 }, { x: 28, y: 36 }] },
          { type: 'pc',           x: 27.8, y: 35.35, layer: 'fg', screen: true, screenCol: '#ffd966' }
        ]
      },
      {
        deptId: 'lounge',
        roomId: 'lounge_gym',
        label: '🏋️ ฟิตเนส',
        desc: 'ลู่วิ่งไฟฟ้า ดัมเบล และมุมออกกำลังกาย',
        rect: { x: 39, y: 32, w: 12, h: 7 },
        floor: 'concrete',
        doors: [{ x: 40, y: 32 }],
        seats: [],
        handoffSpot: { x: 42, y: 34 },
        idleSpots: [
          { x: 43, y: 34, dir: 'right', kind: 'treadmill' },
          { x: 46, y: 34, dir: 'right', kind: 'treadmill' },
          { x: 43, y: 36, dir: 'down',  kind: 'dumbbell' },
          { x: 47, y: 36, dir: 'down',  kind: 'dumbbell' }
        ],
        furniture: [
          { type: 'water_cooler', x: 49.0, y: 33.15, layer: 'static' },
          { type: 'plant',        x: 49.2, y: 36.0,  layer: 'static' },
          { type: 'treadmill',    x: 42.3, y: 34.15, layer: 'static' },
          { type: 'treadmill',    x: 45.3, y: 34.15, layer: 'static' },
          { type: 'dumbbell',     x: 42.6, y: 36.6,  layer: 'static' },
          { type: 'dumbbell',     x: 46.6, y: 36.6,  layer: 'static' }
        ]
      },
      {
        deptId: 'lounge',
        roomId: 'lounge_garden',
        label: '🌳 สวนพักผ่อน',
        desc: 'สวนสีเขียวกลางแจ้ง ต้นไม้ และม้านั่งรับลม',
        rect: { x: 51, y: 22, w: 12, h: 17 },
        floor: 'grass',
        isOutdoor: true,
        doors: [
          { x: 51, y: 30, orient: 'vertical' },
          { x: 51, y: 31, orient: 'vertical' }
        ],
        seats: [],
        handoffSpot: { x: 53, y: 30 },
        idleSpots: [
          { x: 55, y: 26, dir: 'down',  kind: 'garden_bench' },
          { x: 57, y: 33, dir: 'down',  kind: 'garden_bench' },
          { x: 54, y: 28, dir: 'right', kind: 'garden_stroll' },
          { x: 58, y: 29, dir: 'down',  kind: 'garden_stroll' },
          { x: 55, y: 35, dir: 'left',  kind: 'garden_stroll' },
          { x: 59, y: 35, dir: 'up',    kind: 'garden_stroll' }
        ],
        furniture: [
          { type: 'tree',  x: 52.3, y: 23.2, layer: 'fg', solid: [{ x: 53, y: 24 }] },
          { type: 'tree',  x: 59.5, y: 23.3, layer: 'fg', solid: [{ x: 60, y: 24 }] },
          { type: 'bench', x: 54.6, y: 25.5, layer: 'static' },
          { type: 'tree',  x: 59.5, y: 29.8, layer: 'fg', solid: [{ x: 60, y: 31 }] },
          { type: 'bench', x: 56.4, y: 32.5, layer: 'static' },
          { type: 'tree',  x: 52.3, y: 35.0, layer: 'fg', solid: [{ x: 53, y: 36 }] },
          { type: 'plant', x: 59.8, y: 36.0, layer: 'static' }
        ]
      }
    ]
  };

  // ---------------------------------------------------------------------------
  // 2. Agent Roster (19 Distinct Thai Agents)
  // ---------------------------------------------------------------------------
  var AGENT_SPECS = [
    // AI Chat (6)
    { id: 'ai_router',    name: 'น้องเราเตอร์',      role: 'คัดกรองและส่งต่อแชท AI',        deptId: 'ai',     homeRoom: 'ai_router',    seatIdx: 0, look: { shirt: '#7b5be0', accessory: 'headset' } },
    { id: 'ai_architect', name: 'น้องสถาปนิก',      role: 'วางพิมพ์เขียวระบบ (ด่าน 1)',    deptId: 'ai',     homeRoom: 'ai_architect', seatIdx: 0, look: { shirt: '#6d4bc4', accessory: 'glasses' } },
    { id: 'ai_worker_1',  name: 'น้องเวิร์กเกอร์ 1', role: 'เขียนโค้ดและสร้างฟีเจอร์ #1',  deptId: 'ai',     homeRoom: 'ai_workers',   seatIdx: 0, look: { shirt: '#8b6ae6', accessory: 'none' } },
    { id: 'ai_worker_2',  name: 'น้องเวิร์กเกอร์ 2', role: 'เขียนโค้ดและสร้างฟีเจอร์ #2',  deptId: 'ai',     homeRoom: 'ai_workers',   seatIdx: 1, look: { shirt: '#5e3eb8', accessory: 'glasses' } },
    { id: 'ai_worker_3',  name: 'น้องเวิร์กเกอร์ 3', role: 'เขียนโค้ดและสร้างฟีเจอร์ #3',  deptId: 'ai',     homeRoom: 'ai_workers',   seatIdx: 2, look: { shirt: '#9c7ef0', accessory: 'cap' } },
    { id: 'ai_review',    name: 'น้องรีวิว',        role: 'ตรวจคุณภาพโค้ดและ QA (ด่าน 3)', deptId: 'ai',     homeRoom: 'ai_review',    seatIdx: 0, look: { shirt: '#5941a9', accessory: 'glasses' } },
    // Video Studio (5)
    { id: 'vid_script',   name: 'น้องสคริปต์',      role: 'วิจัยข้อมูลและเขียนสคริปต์',     deptId: 'video',  homeRoom: 'vid_script',   seatIdx: 0, look: { shirt: '#d9667a', accessory: 'glasses' } },
    { id: 'vid_art',      name: 'น้องอาร์ต',        role: 'ออกแบบภาพและสตอรี่บอร์ด',       deptId: 'video',  homeRoom: 'vid_art',      seatIdx: 0, look: { shirt: '#e57a8d', accessory: 'cap' } },
    { id: 'vid_tts',      name: 'น้องพากย์',        role: 'พากย์เสียงไทยและซิงค์ซับ',       deptId: 'video',  homeRoom: 'vid_tts',      seatIdx: 0, look: { shirt: '#c85268', accessory: 'headset' } },
    { id: 'vid_edit',     name: 'น้องตัดต่อ',       role: 'ตัดต่อ Remotion & มิกซ์เสียง',   deptId: 'video',  homeRoom: 'vid_edit',     seatIdx: 0, look: { shirt: '#df6e82', accessory: 'headset' } },
    { id: 'vid_publish',  name: 'น้องโปรดิวเซอร์',   role: 'ตรวจ QC และเผยแพร่โซเชียล',     deptId: 'video',  homeRoom: 'vid_publish',  seatIdx: 0, look: { shirt: '#b8485e', accessory: 'none' } },
    // Cron (2)
    { id: 'cron_sched',   name: 'น้องตั้งเวลา',     role: 'ดูแลตารางงานอัตโนมัติ Cron',     deptId: 'cron',   homeRoom: 'cron_sched',   seatIdx: 0, look: { shirt: '#c9a23a', accessory: 'glasses' } },
    { id: 'cron_news',    name: 'น้องข่าวเช้า',     role: 'ผู้ประกาศข่าวเช้า v2',           deptId: 'cron',   homeRoom: 'cron_news',    seatIdx: 0, look: { shirt: '#d9b34a', accessory: 'headset' } },
    // IT / Agent Hub (3)
    { id: 'hub_dispatch', name: 'น้องดิสแพตช์',     role: 'กระจายงานหนักไป Agent Hub',      deptId: 'hub',    homeRoom: 'hub_dispatch', seatIdx: 0, look: { shirt: '#3d6fb6', accessory: 'headset' } },
    { id: 'hub_srv_1',    name: 'น้องเซิร์ฟเวอร์ 1', role: 'ดูแลโหนด asridaytrade',         deptId: 'hub',    homeRoom: 'hub_workers',  seatIdx: 0, look: { shirt: '#2e5c9e', accessory: 'cap' } },
    { id: 'hub_srv_2',    name: 'น้องเซิร์ฟเวอร์ 2', role: 'ดูแลโหนด servergigi',           deptId: 'hub',    homeRoom: 'hub_workers',  seatIdx: 1, look: { shirt: '#4e82cc', accessory: 'glasses' } },
    // Operations / Infra (2)
    { id: 'ops_monitor',  name: 'น้องมอนิเตอร์',    role: 'เฝ้าระวังเซอร์วิสและแจ้งเตือน',  deptId: 'ops',    homeRoom: 'ops_monitor',  seatIdx: 0, look: { shirt: '#3f8f6a', accessory: 'glasses' } },
    { id: 'ops_energy',   name: 'น้องพลังงาน',      role: 'วัดไฟ PZEM-01 และสรุปค่าไฟ',     deptId: 'ops',    homeRoom: 'ops_energy',   seatIdx: 0, look: { shirt: '#337a59', accessory: 'cap' } },
    // Lobby Reception (1)
    { id: 'lounge_host',  name: 'พี่ต้อนรับ',       role: 'ประชาสัมพันธ์หน้าบริษัท',        deptId: 'lounge', homeRoom: 'lounge_lobby', seatIdx: 0, look: { shirt: '#a86d42', accessory: 'none' } }
  ];

  // ---------------------------------------------------------------------------
  // 3. Idle Activities (>= 14 rich activities, including group activities!)
  // ---------------------------------------------------------------------------
  var IDLE_ACTIVITIES = [
    { id: 'coffee',             label: 'ชงกาแฟหอมๆ',         roomId: 'lounge_cafe',   spotKind: 'coffee',             pose: 'drink', bubble: '☕', minSec: 8,  maxSec: 15, weight: 14 },
    { id: 'snack',              label: 'กดขนมตู้จำหน่าย',     roomId: 'lounge_cafe',   spotKind: 'snack',              pose: 'idle',  bubble: '🍪', minSec: 6,  maxSec: 11, weight: 9  },
    { id: 'sofa_nap',           label: 'งีบพักสายตาบนโซฟา',  roomId: 'lounge_cafe',   spotKind: 'sofa_nap',           pose: 'sleep', bubble: '💤', minSec: 10, maxSec: 18, weight: 8  },
    { id: 'cards_group',        label: 'เล่นไพ่กับเพื่อน',    roomId: 'lounge_games',  spotKind: 'cards_group',        pose: 'cards', bubble: '🃏', minSec: 11, maxSec: 20, weight: 13, group: true, maxGroup: 4 },
    { id: 'pingpong_group',     label: 'ตีปิงปองคลายเครียด',  roomId: 'lounge_games',  spotKind: 'pingpong_group',     pose: 'talk',  bubble: '🏓', minSec: 10, maxSec: 18, weight: 11, group: true, maxGroup: 2 },
    { id: 'treadmill',          label: 'วิ่งลู่วิ่งฟิตเนส',   roomId: 'lounge_gym',    spotKind: 'treadmill',          pose: 'walk',  bubble: '🏃', minSec: 9,  maxSec: 16, weight: 10 },
    { id: 'dumbbell',           label: 'ยกดัมเบลออกกำลัง',   roomId: 'lounge_gym',    spotKind: 'dumbbell',           pose: 'lift',  bubble: '💪', minSec: 8,  maxSec: 15, weight: 10 },
    { id: 'water_chat_group',   label: 'คุยเล่นหน้าตู้กดน้ำ', roomId: 'lounge_lobby',  spotKind: 'water_chat_group',   pose: 'talk',  bubble: '💬', minSec: 8,  maxSec: 14, weight: 10, group: true, maxGroup: 2 },
    { id: 'garden_stroll',      label: 'เดินเล่นรับลมในสวน', roomId: 'lounge_garden', spotKind: 'garden_stroll',      pose: 'walk',  bubble: '🌿', minSec: 8,  maxSec: 14, weight: 11, wander: true },
    { id: 'garden_bench',       label: 'นั่งชิลม้านั่งสวน',  roomId: 'lounge_garden', spotKind: 'garden_bench',       pose: 'sit',   bubble: '🌸', minSec: 9,  maxSec: 16, weight: 9  },
    { id: 'read_book',          label: 'อ่านหนังสือหาไอเดีย', roomId: 'lounge_games',  spotKind: 'read_book',          pose: 'idle',  bubble: '📖', minSec: 9,  maxSec: 15, weight: 8  },
    { id: 'lobby_chat',         label: 'แวะทักทายหน้าบริษัท', roomId: 'lounge_lobby',  spotKind: 'lobby_chat',         pose: 'talk',  bubble: '👋', minSec: 6,  maxSec: 12, weight: 7  },
    { id: 'hallway_chat_group', label: 'จับกลุ่มเม้าท์มอย',   roomId: 'lounge_cafe',   spotKind: 'hallway_chat_group', pose: 'talk',  bubble: '😄', minSec: 8,  maxSec: 15, weight: 10, group: true, maxGroup: 2 },
    { id: 'desk_chill',         label: 'พักฟังเพลงที่โต๊ะ',   roomId: null,            spotKind: 'home_seat',          pose: 'sit',   bubble: '🎵', minSec: 7,  maxSec: 13, weight: 8  }
  ];

  // Work bubble icons per department
  var WORK_BUBBLES = {
    ai:     ['💻', '🧠', '⚡', '✨'],
    video:  ['🎬', '🎨', '🎙️', '✂️'],
    cron:   ['⏰', '📰', '📡'],
    hub:    ['🖥️', '⚙️', '🚀'],
    ops:    ['🛡️', '📊', '⚡'],
    lounge: ['🛎️', '😊', '👋']
  };

  // ---------------------------------------------------------------------------
  // 4. Utility Helpers & Walkable Grid / 4-Dir A* Pathfinding
  // ---------------------------------------------------------------------------
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function truncateText(str, maxLen) {
    var s = String(str == null ? '' : str).trim();
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(1, maxLen - 1)) + '…';
  }

  function randRange(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  function buildRoomMap() {
    var byId = {};
    for (var i = 0; i < LAYOUT.rooms.length; i++) {
      byId[LAYOUT.rooms[i].roomId] = LAYOUT.rooms[i];
    }
    return byId;
  }

  function buildWalkableGrid() {
    var grid = new Uint8Array(WORLD_W_TILES * WORLD_H_TILES);
    var idx = function (x, y) { return y * WORLD_W_TILES + x; };
    var setWalk = function (x, y, val) {
      if (x >= 0 && x < WORLD_W_TILES && y >= 0 && y < WORLD_H_TILES) {
        grid[idx(x, y)] = val ? 1 : 0;
      }
    };

    // 1) Corridors are walkable
    for (var c = 0; c < LAYOUT.corridors.length; c++) {
      var cor = LAYOUT.corridors[c];
      for (var cy = cor.y; cy < cor.y + cor.h; cy++) {
        for (var cx = cor.x; cx < cor.x + cor.w; cx++) {
          setWalk(cx, cy, 1);
        }
      }
    }

    // 2) Room interiors are walkable; walls remain 0 except door tiles
    for (var i = 0; i < LAYOUT.rooms.length; i++) {
      var r = LAYOUT.rooms[i];
      var rc = r.rect;
      for (var ry = rc.y + 1; ry < rc.y + rc.h - 1; ry++) {
        for (var rx = rc.x + 1; rx < rc.x + rc.w - 1; rx++) {
          setWalk(rx, ry, 1);
        }
      }
      // Doors open through perimeter wall
      for (var d = 0; d < r.doors.length; d++) {
        var dr = r.doors[d];
        setWalk(dr.x, dr.y, 1);
      }
    }

    // 3) Solid furniture footprints (skipping doors/seats/idleSpots)
    var protectedSet = {};
    var markProtected = function (x, y) { protectedSet[x + ',' + y] = true; };
    for (var p = 0; p < LAYOUT.rooms.length; p++) {
      var pr = LAYOUT.rooms[p];
      for (var pd = 0; pd < pr.doors.length; pd++) {
        var d0 = pr.doors[pd];
        markProtected(d0.x, d0.y);
        markProtected(d0.x, d0.y - 1);
        markProtected(d0.x, d0.y + 1);
        markProtected(d0.x - 1, d0.y);
        markProtected(d0.x + 1, d0.y);
      }
      for (var ps = 0; ps < pr.seats.length; ps++) {
        markProtected(pr.seats[ps].x, pr.seats[ps].y);
      }
      if (pr.handoffSpot) markProtected(pr.handoffSpot.x, pr.handoffSpot.y);
      for (var pi = 0; pi < pr.idleSpots.length; pi++) {
        markProtected(pr.idleSpots[pi].x, pr.idleSpots[pi].y);
      }
    }

    for (var f = 0; f < LAYOUT.rooms.length; f++) {
      var fr = LAYOUT.rooms[f];
      for (var fi = 0; fi < fr.furniture.length; fi++) {
        var item = fr.furniture[fi];
        if (!item.solid) continue;
        for (var si = 0; si < item.solid.length; si++) {
          var st = item.solid[si];
          if (!protectedSet[st.x + ',' + st.y]) {
            setWalk(st.x, st.y, 0);
          }
        }
      }
    }

    return grid;
  }

  // Fast 4-directional A* on 64x40 grid
  function findPath(grid, sx, sy, gx, gy) {
    sx = clamp(sx | 0, 0, WORLD_W_TILES - 1);
    sy = clamp(sy | 0, 0, WORLD_H_TILES - 1);
    gx = clamp(gx | 0, 0, WORLD_W_TILES - 1);
    gy = clamp(gy | 0, 0, WORLD_H_TILES - 1);
    if (sx === gx && sy === gy) return [];

    var total = WORLD_W_TILES * WORLD_H_TILES;
    var startIdx = sy * WORLD_W_TILES + sx;
    var goalIdx = gy * WORLD_W_TILES + gx;

    // If start or goal happens to be non-walkable, nudge to closest walkable neighbor
    var dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ];
    if (!grid[goalIdx]) {
      for (var nd = 0; nd < 4; nd++) {
        var ngx = gx + dirs[nd][0];
        var ngy = gy + dirs[nd][1];
        if (ngx >= 0 && ngx < WORLD_W_TILES && ngy >= 0 && ngy < WORLD_H_TILES && grid[ngy * WORLD_W_TILES + ngx]) {
          gx = ngx;
          gy = ngy;
          goalIdx = gy * WORLD_W_TILES + gx;
          break;
        }
      }
    }

    var gScore = new Int32Array(total);
    var fScore = new Int32Array(total);
    var cameFrom = new Int32Array(total);
    var state = new Uint8Array(total); // 0=unvisited, 1=open, 2=closed
    for (var i = 0; i < total; i++) {
      gScore[i] = 999999;
      cameFrom[i] = -1;
    }

    gScore[startIdx] = 0;
    fScore[startIdx] = Math.abs(gx - sx) + Math.abs(gy - sy);
    state[startIdx] = 1;

    // Binary min-heap of open node indices
    var heap = [startIdx];
    function heapPush(node) {
      heap.push(node);
      var pos = heap.length - 1;
      while (pos > 0) {
        var parent = (pos - 1) >> 1;
        if (fScore[heap[pos]] < fScore[heap[parent]]) {
          var tmp = heap[pos];
          heap[pos] = heap[parent];
          heap[parent] = tmp;
          pos = parent;
        } else break;
      }
    }
    function heapPop() {
      var top = heap[0];
      var last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        var pos = 0;
        var len = heap.length;
        while (true) {
          var l = (pos << 1) + 1;
          var r = l + 1;
          var smallest = pos;
          if (l < len && fScore[heap[l]] < fScore[heap[smallest]]) smallest = l;
          if (r < len && fScore[heap[r]] < fScore[heap[smallest]]) smallest = r;
          if (smallest !== pos) {
            var tmp = heap[pos];
            heap[pos] = heap[smallest];
            heap[smallest] = tmp;
            pos = smallest;
          } else break;
        }
      }
      return top;
    }

    var found = false;
    var iter = 0;
    while (heap.length > 0 && iter < 4000) {
      iter++;
      var cur = heapPop();
      if (state[cur] === 2) continue;
      if (cur === goalIdx) {
        found = true;
        break;
      }
      state[cur] = 2;

      var cx = cur % WORLD_W_TILES;
      var cy = (cur / WORLD_W_TILES) | 0;
      var baseG = gScore[cur] + 1;

      for (var d = 0; d < 4; d++) {
        var nx = cx + dirs[d][0];
        var ny = cy + dirs[d][1];
        if (nx < 0 || nx >= WORLD_W_TILES || ny < 0 || ny >= WORLD_H_TILES) continue;
        var nIdx = ny * WORLD_W_TILES + nx;
        if (state[nIdx] === 2) continue;
        if (!grid[nIdx] && nIdx !== goalIdx) continue;
        if (baseG < gScore[nIdx]) {
          cameFrom[nIdx] = cur;
          gScore[nIdx] = baseG;
          fScore[nIdx] = baseG + Math.abs(gx - nx) + Math.abs(gy - ny);
          state[nIdx] = 1;
          heapPush(nIdx);
        }
      }
    }

    if (!found) return null;

    var path = [];
    var node = goalIdx;
    while (node !== -1 && node !== startIdx) {
      path.push({ x: node % WORLD_W_TILES, y: (node / WORLD_W_TILES) | 0 });
      node = cameFrom[node];
    }
    path.reverse();
    return path;
  }

  // ---------------------------------------------------------------------------
  // 5. Video Job Stage Detection (Reused concept from workshop-3d.js, no import)
  // ---------------------------------------------------------------------------
  var VIDEO_STAGE_ROOMS = ['vid_script', 'vid_art', 'vid_tts', 'vid_edit', 'vid_publish'];
  var VIDEO_STAGE_AGENTS = ['vid_script', 'vid_art', 'vid_tts', 'vid_edit', 'vid_publish'];
  var AI_PIPELINE_ROOMS = ['ai_router', 'ai_architect', 'ai_workers', 'ai_review'];

  function detectVideoStageIndex(job) {
    if (!job || typeof job !== 'object') return 0;
    var status = String(job.status || '').toLowerCase();
    var stage = String(job.stage || job.currentStep || job.stepLabel || '').toLowerCase();
    var combined = status + ' ' + stage;

    if (/(publish|upload|social|telegram|post|qc)/.test(combined)) return 4;
    if (/(render|mix|edit|remotion|ffmpeg|preview|compos|encode)/.test(combined)) return 3;
    if (/(tts|voice|audio|narrat|speech|พากย์|เสียง)/.test(combined)) return 2;
    if (/(art|image|visual|story|scene|draw|extract|download|asset|ภาพ)/.test(combined)) return 1;
    if (/(script|research|plan|draft|analyz|queue|สคริปต์)/.test(combined)) return 0;

    var pct = Number(job.progress != null ? job.progress : (job.pct != null ? job.pct : 0));
    if (pct >= 88) return 4;
    if (pct >= 58) return 3;
    if (pct >= 38) return 2;
    if (pct >= 18) return 1;
    return 0;
  }

  function isVideoJobActive(job) {
    if (!job || typeof job !== 'object') return false;
    if (job.alive || job.factoryCol === 'running') return true;
    var st = String(job.status || '').toLowerCase();
    return (
      st === 'researching' || st === 'scripting' || st === 'tts' ||
      st === 'rendering' || st === 'mixing' || st === 'previewing' ||
      st === 'editing' || st === 'building' || st === 'running'
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Static World Offscreen Layer Renderer (1 pass per theme!)
  // ---------------------------------------------------------------------------
  function drawSkyAndBuildingShell(ctx, Art, themeName) {
    var pal = Art.getTheme(themeName);
    var isLight = themeName === 'light';

    // Sky backdrop (top 2 tiles = 32px + thin left/right margins)
    var grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    grad.addColorStop(0, pal.skyTop);
    grad.addColorStop(0.12, pal.skyBottom);
    grad.addColorStop(0.15, isLight ? '#5c8c4a' : '#121829');
    grad.addColorStop(1, isLight ? '#4b7a3d' : '#0f1422');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Pixel clouds (light) or stars (dark) in sky strip y=0..30
    if (isLight) {
      var clouds = [
        [40, 6, 36], [190, 9, 44], [380, 5, 34], [620, 8, 46], [830, 6, 38], [950, 10, 30]
      ];
      for (var c = 0; c < clouds.length; c++) {
        var cx = clouds[c][0], cy = clouds[c][1], cw = clouds[c][2];
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx + 4, cy, cw - 8, 6);
        ctx.fillRect(cx, cy + 3, cw, 5);
        ctx.fillStyle = '#d7ecff';
        ctx.fillRect(cx + 2, cy + 6, cw - 4, 2);
      }
    } else {
      for (var s = 0; s < 42; s++) {
        var sx = ((s * 97 + 19) % (WORLD_W - 12)) + 6;
        var sy = ((s * 37 + 5) % 24) + 2;
        ctx.fillStyle = (s % 3 === 0) ? '#ffe89e' : '#b8d8ff';
        ctx.fillRect(sx, sy, (s % 5 === 0) ? 2 : 1, 1);
      }
    }

    // Distant pixel cityscape silhouettes along left & right roof shoulders
    var cityCol = isLight ? '#6e8db0' : '#15203b';
    var cityHi = isLight ? '#8aa8c9' : '#1f2e52';
    var winCol = isLight ? '#d8eeff' : '#ffd966';
    var skyline = [
      [10, 14, 18], [32, 8, 24], [60, 16, 16], [82, 10, 22], [110, 15, 17],
      [880, 12, 20], [906, 8, 24], [936, 14, 18], [960, 10, 22], [988, 13, 19]
    ];
    for (var b = 0; b < skyline.length; b++) {
      var bx = skyline[b][0], by = skyline[b][1], bw = skyline[b][2];
      var bh = 34 - by;
      ctx.fillStyle = (b % 2 === 0) ? cityCol : cityHi;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = winCol;
      for (var wy = by + 3; wy < 30; wy += 4) {
        for (var wx = bx + 3; wx < bx + bw - 3; wx += 4) {
          if (((wx + wy + b) & 1) === 0) ctx.fillRect(wx, wy, 2, 2);
        }
      }
    }

    // Outer architectural building shell with beveled roof cornice
    var bLeft = TILE - 6;
    var bTop = TILE * 2 - 6;
    var bWidth = WORLD_W - (TILE - 6) * 2;
    var bHeight = WORLD_H - TILE - bTop + 4;
    ctx.fillStyle = pal.outline;
    ctx.fillRect(bLeft - 2, bTop - 2, bWidth + 4, bHeight + 4);
    ctx.fillStyle = pal.buildingShell;
    ctx.fillRect(bLeft, bTop, bWidth, bHeight);
    // Roof top bevel trim
    ctx.fillStyle = pal.buildingTrim;
    ctx.fillRect(bLeft + 2, bTop + 1, bWidth - 4, 3);

    // Company Roof Marquee Banner
    Art.drawRoomSign(ctx, WORLD_W / 2, 6, '🏢 HOMELAB PIXEL COMPANY', isLight ? '#2b4a78' : '#25375e', {
      theme: themeName,
      fontSize: 10,
      padX: 14,
      h: 19
    });

    // Front outdoor sidewalk + lawn strip at y = 39 (624..640)
    Art.drawFloor(ctx, 0, 39 * TILE, WORLD_W, TILE, 'tile', {
      theme: themeName,
      color: isLight ? '#d3cec4' : '#32384b',
      tileSize: 8
    });
    // Green planters / grass flanking front entrance
    Art.drawFloor(ctx, 0, 39 * TILE + 2, 24 * TILE, TILE - 2, 'grass', { theme: themeName });
    Art.drawFloor(ctx, 39 * TILE, 39 * TILE + 2, 25 * TILE, TILE - 2, 'grass', { theme: themeName });
    // Entrance stone walkway leading out from lobby front doors (x = 30..34)
    ctx.fillStyle = pal.outline;
    ctx.fillRect(30 * TILE - 1, 39 * TILE, 4 * TILE + 2, TILE);
    ctx.fillStyle = isLight ? '#e4ded2' : '#4a526a';
    ctx.fillRect(30 * TILE, 39 * TILE, 4 * TILE, TILE);
    ctx.fillStyle = '#9c2d3a';
    ctx.fillRect(31 * TILE, 39 * TILE, 2 * TILE, TILE - 3);
    ctx.fillStyle = '#c94a58';
    ctx.fillRect(31 * TILE + 2, 39 * TILE, 2 * TILE - 4, TILE - 5);
  }

  function drawYellowArrow(ctx, xPx, yPx, dir, glowAlpha) {
    var ix = xPx | 0;
    var iy = yPx | 0;
    var out = '#38250a';
    var fill = glowAlpha > 0 ? '#ffe76b' : '#f2c144';
    var hi = '#fff7b2';

    if (glowAlpha > 0) {
      ctx.fillStyle = 'rgba(255, 224, 92, ' + glowAlpha.toFixed(2) + ')';
      ctx.fillRect(ix - 2, iy - 2, 24, 14);
    }

    if (dir === 'right') {
      // Shaft + arrowhead pointing right (20x10 px)
      ctx.fillStyle = out;
      ctx.fillRect(ix, iy + 2, 13, 6);
      ctx.fillRect(ix + 11, iy, 3, 10);
      ctx.fillRect(ix + 14, iy + 1, 2, 8);
      ctx.fillRect(ix + 16, iy + 2, 2, 6);
      ctx.fillRect(ix + 18, iy + 3, 2, 4);

      ctx.fillStyle = fill;
      ctx.fillRect(ix + 1, iy + 3, 12, 4);
      ctx.fillRect(ix + 12, iy + 1, 2, 8);
      ctx.fillRect(ix + 14, iy + 2, 2, 6);
      ctx.fillRect(ix + 16, iy + 3, 2, 4);
      ctx.fillRect(ix + 18, iy + 4, 1, 2);

      ctx.fillStyle = hi;
      ctx.fillRect(ix + 2, iy + 3, 10, 1);
      ctx.fillRect(ix + 12, iy + 2, 2, 1);
    }
  }

  function renderStaticLayer(Art, themeName) {
    var off = document.createElement('canvas');
    off.width = WORLD_W;
    off.height = WORLD_H;
    var ctx = off.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    var pal = Art.getTheme(themeName);
    var isLight = themeName === 'light';

    // 1) Sky, skyline, roof banner, building shell, sidewalk
    drawSkyAndBuildingShell(ctx, Art, themeName);

    // 2) Corridors floor
    for (var c = 0; c < LAYOUT.corridors.length; c++) {
      var cor = LAYOUT.corridors[c];
      Art.drawFloor(ctx, cor.x * TILE, cor.y * TILE, cor.w * TILE, cor.h * TILE, 'tile', {
        theme: themeName,
        color: pal.corridor,
        tileSize: 16
      });
      // Subtle hallway center runner stripe
      ctx.fillStyle = isLight ? 'rgba(95, 86, 72, 0.12)' : 'rgba(130, 155, 210, 0.10)';
      if (cor.w > cor.h) {
        ctx.fillRect(cor.x * TILE + 4, cor.y * TILE + TILE - 2, cor.w * TILE - 8, 4);
      } else {
        ctx.fillRect(cor.x * TILE + TILE - 2, cor.y * TILE + 4, 4, cor.h * TILE - 8);
      }
    }

    // 3) Pipeline yellow arrows on corridor floors
    for (var a = 0; a < LAYOUT.arrows.length; a++) {
      var arr = LAYOUT.arrows[a];
      drawYellowArrow(ctx, arr.x * TILE, arr.y * TILE, arr.dir, 0);
    }

    // 4) Draw each room: floor -> walls -> doors (closed base) -> signs -> static furniture
    for (var i = 0; i < LAYOUT.rooms.length; i++) {
      var r = LAYOUT.rooms[i];
      var rx = r.rect.x * TILE;
      var ry = r.rect.y * TILE;
      var rw = r.rect.w * TILE;
      var rh = r.rect.h * TILE;

      // Interior floor (full room rect, walls draw over perimeter)
      Art.drawFloor(ctx, rx, ry, rw, rh, r.floor, {
        theme: themeName,
        color: r.floorColor || undefined
      });

      // Garden stone footpath overlay
      if (r.isOutdoor) {
        ctx.fillStyle = isLight ? '#d8cfc0' : '#4a4f5e';
        ctx.fillRect(rx + 6, 30 * TILE + 2, 5 * TILE, 2 * TILE - 4);
        ctx.fillRect(rx + 4 * TILE, 26 * TILE, 2 * TILE, 10 * TILE);
        ctx.fillStyle = isLight ? '#ece5d8' : '#5e6475';
        for (var sy = 26 * TILE + 3; sy < 36 * TILE; sy += 12) {
          ctx.fillRect(rx + 4 * TILE + 3, sy, 2 * TILE - 6, 8);
        }
      }

      // Build door lookup so walls skip doorways cleanly
      var doorSet = {};
      for (var d = 0; d < r.doors.length; d++) {
        doorSet[r.doors[d].x + ',' + r.doors[d].y] = r.doors[d];
      }
      if (r.frontEntrance) {
        for (var fe = 0; fe < r.frontEntrance.w; fe++) {
          doorSet[(r.frontEntrance.x + fe) + ',' + r.frontEntrance.y] = { front: true };
        }
      }

      // Top wall (segmented around any top doors)
      var topWallColor = r.isOutdoor ? '#6b5036' : r.deptId;
      var tx = r.rect.x;
      while (tx < r.rect.x + r.rect.w) {
        if (doorSet[tx + ',' + r.rect.y]) {
          tx++;
          continue;
        }
        var segStart = tx;
        while (tx < r.rect.x + r.rect.w && !doorSet[tx + ',' + r.rect.y]) tx++;
        Art.drawWall(ctx, segStart * TILE, ry, (tx - segStart) * TILE, TILE, topWallColor, {
          theme: themeName
        });
      }

      // Left & right side walls (thin 6px architectural partition walls)
      var sideCol = r.isOutdoor ? '#785a3d' : r.deptId;
      var leftWallX = rx;
      var rightWallX = rx + rw - 5;
      // Left wall segmented around vertical doors
      var ly = r.rect.y + 1;
      while (ly < r.rect.y + r.rect.h - 1) {
        if (doorSet[r.rect.x + ',' + ly]) {
          ly++;
          continue;
        }
        var lStart = ly;
        while (ly < r.rect.y + r.rect.h - 1 && !doorSet[r.rect.x + ',' + ly]) ly++;
        Art.drawWall(ctx, leftWallX, lStart * TILE, 5, (ly - lStart) * TILE, sideCol, {
          theme: themeName,
          shadow: false
        });
      }
      Art.drawWall(ctx, rightWallX, ry + TILE, 5, rh - TILE * 2, sideCol, {
        theme: themeName,
        shadow: false
      });

      // Bottom wall (lower 8px parapet so interior stays super open & readable!)
      var botY = ry + rh - 10;
      var bx = r.rect.x;
      while (bx < r.rect.x + r.rect.w) {
        if (doorSet[bx + ',' + (r.rect.y + r.rect.h - 1)]) {
          bx++;
          continue;
        }
        var bStart = bx;
        while (bx < r.rect.x + r.rect.w && !doorSet[bx + ',' + (r.rect.y + r.rect.h - 1)]) bx++;
        Art.drawWall(ctx, bStart * TILE, botY, (bx - bStart) * TILE, 10, topWallColor, {
          theme: themeName
        });
      }

      // Draw lobby front glass double entrance doors
      if (r.frontEntrance) {
        var fx = r.frontEntrance.x * TILE;
        var fy = r.frontEntrance.y * TILE + 2;
        Art.drawDoor(ctx, fx, fy, false, {
          theme: themeName,
          w: TILE,
          h: 14,
          color: '#3a6289',
          frameColor: '#2a3448'
        });
        Art.drawDoor(ctx, fx + TILE, fy, false, {
          theme: themeName,
          w: TILE,
          h: 14,
          color: '#3a6289',
          frameColor: '#2a3448'
        });
      }

      // Static furniture inside room (skipping animated racks/fg items)
      for (var fi = 0; fi < r.furniture.length; fi++) {
        var item = r.furniture[fi];
        if (item.layer !== 'static') continue;
        var fOpts = Object.assign({ theme: themeName, on: true, glow: false, frame: 0 }, item.opts || {});
        Art.drawFurniture(ctx, item.type, item.x * TILE, item.y * TILE, fOpts);
      }

      // Room Sign Plaque centered on top wall!
      Art.drawRoomSign(ctx, rx + rw / 2, ry + 1, r.label, r.deptId, {
        theme: themeName,
        fontSize: 9,
        padX: 6,
        h: 15
      });
    }

    return off;
  }

  // ---------------------------------------------------------------------------
  // 7. Mount Controller
  // ---------------------------------------------------------------------------
  function mount(hostEl, opts) {
    if (!hostEl) throw new Error('HomelabPixelOffice.mount requires hostEl');
    var Art = root.PixelOfficeArt;
    if (!Art) throw new Error('PixelOfficeArt must be loaded before pixel-office.js');

    var options = opts || {};
    var tooltipEl = options.tooltipEl || null;
    var onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;

    var themeName = options.theme ||
      (typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme')) ||
      'dark';
    themeName = themeName === 'light' ? 'light' : 'dark';

    var demoMode = Boolean(options.demoMode);
    var active = true;
    var destroyed = false;

    // Reduced motion preference
    var mqlReduced = (typeof window !== 'undefined' && window.matchMedia)
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    var reducedMotion = Boolean(mqlReduced && mqlReduced.matches);

    // Canvas setup inside hostEl
    var canvas = document.createElement('canvas');
    canvas.className = 'ov3-po__canvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.imageRendering = 'pixelated';
    canvas.style.cursor = 'pointer';
    hostEl.innerHTML = '';
    hostEl.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var dpr = 1;
    var viewW = WORLD_W;
    var viewH = WORLD_H;

    // Offscreen static cache
    var staticCanvas = renderStaticLayer(Art, themeName);

    // World structures
    var roomById = buildRoomMap();
    var walkableGrid = buildWalkableGrid();

    // Collect foreground props & animated props for fast dynamic pass
    var fgFurniture = [];
    var screenFurniture = [];
    var rackFurniture = [];
    var allDoors = [];
    for (var ri = 0; ri < LAYOUT.rooms.length; ri++) {
      var rm = LAYOUT.rooms[ri];
      for (var di = 0; di < rm.doors.length; di++) {
        allDoors.push({
          roomId: rm.roomId,
          deptId: rm.deptId,
          x: rm.doors[di].x,
          y: rm.doors[di].y,
          orient: rm.doors[di].orient || 'horizontal',
          openTimer: 0
        });
      }
      for (var fi = 0; fi < rm.furniture.length; fi++) {
        var fItem = rm.furniture[fi];
        var sz = Art.FURNITURE_SIZES[fItem.type] || { w: 16, h: 16 };
        var entry = {
          roomId: rm.roomId,
          deptId: rm.deptId,
          type: fItem.type,
          x: fItem.x * TILE,
          y: fItem.y * TILE,
          sortY: fItem.y * TILE + sz.h,
          opts: fItem.opts || {},
          screen: Boolean(fItem.screen),
          screenCol: fItem.screenCol || '#38e8c6',
          rack: Boolean(fItem.rack)
        };
        if (fItem.layer === 'fg') fgFurniture.push(entry);
        if (fItem.screen) screenFurniture.push(entry);
        if (fItem.rack) rackFurniture.push(entry);
      }
    }

    // Room runtime state
    var roomState = {};
    for (var rs = 0; rs < LAYOUT.rooms.length; rs++) {
      var rObj = LAYOUT.rooms[rs];
      roomState[rObj.roomId] = {
        active: false,
        alert: false,
        statusText: 'ว่าง',
        detail: rObj.desc || '',
        pulse: 0
      };
    }

    // Spot reservation map for idle activities so agents spread out nicely
    var spotClaims = {}; // key: "roomId:idx" -> agentId

    function releaseSpot(agent) {
      if (agent.claimedSpotKey && spotClaims[agent.claimedSpotKey] === agent.id) {
        delete spotClaims[agent.claimedSpotKey];
      }
      agent.claimedSpotKey = null;
    }

    // Initialize 19 agents at their home seats
    var agents = [];
    var agentById = {};
    for (var ai = 0; ai < AGENT_SPECS.length; ai++) {
      var sp = AGENT_SPECS[ai];
      var home = roomById[sp.homeRoom];
      var seat = (home && home.seats && home.seats[sp.seatIdx]) || { x: home.rect.x + 3, y: home.rect.y + 4, dir: 'down' };
      var look = Art.randomLook(sp.id, sp.look);
      var startPx = (seat.x + 0.5) * TILE;
      var startPy = (seat.y + 0.85) * TILE;

      var ag = {
        id: sp.id,
        name: sp.name,
        role: sp.role,
        deptId: sp.deptId,
        homeRoom: sp.homeRoom,
        seat: seat,
        look: look,
        // Position (pixels, foot-center)
        px: startPx,
        py: startPy,
        tx: seat.x,
        ty: seat.y,
        dir: seat.dir || 'down',
        pose: 'sit',
        frameOffset: (ai * 7) % 32,
        // State machine: 'working' | 'handoff' | 'returning' | 'idle'
        state: 'idle',
        subState: 'at_spot', // 'walking' | 'at_spot' | 'delivering'
        assignedWork: false,
        workDetail: '',
        workBubble: '',
        // Pathfinding
        path: [],
        pathIdx: 0,
        speed: 58, // px/sec (~3.6 tiles/sec)
        // Handoff state
        handoffTargetRoom: null,
        handoffLabel: '',
        handoffColor: '#f2c14e',
        handoffPause: 0,
        // Idle activity state
        activity: null,
        activityTimer: randRange(1.5, 6.5),
        claimedSpotKey: null,
        bubble: '',
        currentRoomId: sp.homeRoom
      };
      agents.push(ag);
      agentById[ag.id] = ag;
    }

    // Camera state (world-space center + zoom)
    var cam = {
      x: WORLD_W / 2,
      y: WORLD_H / 2,
      zoom: 1,
      targetX: WORLD_W / 2,
      targetY: WORLD_H / 2,
      targetZoom: 1,
      focusedDept: 'all',
      focusedRoomId: null
    };

    // Hover & Selection state
    var hoverAgent = null;
    var hoverRoom = null;
    var mouseWorldX = -1;
    var mouseWorldY = -1;
    var mouseClientX = 0;
    var mouseClientY = 0;
    var pointerInside = false;

    // Live data & transition tracking
    var lastPayload = null;
    var prevVideoStage = -1;
    var prevAiStage = -1;
    var prevHubActive = false;
    var prevCronNewsActive = false;
    var liveHeadline = '';
    var hasLiveWork = false;
    var hubOfflineAlert = false;
    var opsAlert = false;

    // Demo choreographer timers
    var demoClock = 0;
    var demoVideoStage = 0;
    var demoAiStage = 0;
    var demoStageTimer = 0;
    var demoAiTimer = 3.2;

    // -----------------------------------------------------------------------
    // Helper: Room lookup at tile / pixel
    // -----------------------------------------------------------------------
    function getRoomAtPixel(wx, wy) {
      var tx = wx / TILE;
      var ty = wy / TILE;
      for (var i = 0; i < LAYOUT.rooms.length; i++) {
        var rc = LAYOUT.rooms[i].rect;
        if (tx >= rc.x && tx < rc.x + rc.w && ty >= rc.y && ty < rc.y + rc.h) {
          return LAYOUT.rooms[i];
        }
      }
      return null;
    }

    function getAgentAtPixel(wx, wy) {
      var best = null;
      var bestDist = 15;
      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];
        var dx = wx - a.px;
        var dy = wy - (a.py - 9);
        var d = Math.hypot(dx, dy);
        if (d < bestDist) {
          bestDist = d;
          best = a;
        }
      }
      return best;
    }

    // -----------------------------------------------------------------------
    // Agent Path & State Transitions
    // -----------------------------------------------------------------------
    function setAgentDestination(agent, gx, gy, speed) {
      var sx = clamp(Math.floor(agent.px / TILE), 0, WORLD_W_TILES - 1);
      var sy = clamp(Math.floor(agent.py / TILE), 0, WORLD_H_TILES - 1);
      var p = findPath(walkableGrid, sx, sy, gx, gy);
      if (p && p.length > 0) {
        agent.path = p;
        agent.pathIdx = 0;
        agent.subState = 'walking';
        agent.speed = speed || 62;
        return true;
      }
      agent.path = [];
      agent.pathIdx = 0;
      agent.subState = 'at_spot';
      return false;
    }

    function sendAgentToWork(agent, detail, bubble) {
      agent.assignedWork = true;
      agent.workDetail = detail || agent.role;
      agent.workBubble = bubble || WORK_BUBBLES[agent.deptId][0];
      if (agent.state === 'handoff') return; // let handoff finish first!

      releaseSpot(agent);
      agent.activity = null;
      var seatPx = (agent.seat.x + 0.5) * TILE;
      var seatPy = (agent.seat.y + 0.85) * TILE;
      var dist = Math.hypot(agent.px - seatPx, agent.py - seatPy);

      if (dist <= 6) {
        agent.px = seatPx;
        agent.py = seatPy;
        agent.state = 'working';
        agent.subState = 'at_spot';
        agent.dir = agent.seat.dir || 'down';
        agent.pose = 'type';
        agent.bubble = agent.workBubble;
      } else {
        agent.state = 'returning';
        agent.pose = 'walk';
        agent.bubble = '⚡';
        setAgentDestination(agent, agent.seat.x, agent.seat.y, 92);
      }
    }

    function releaseAgentFromWork(agent) {
      agent.assignedWork = false;
      agent.workDetail = '';
      if (agent.state === 'working') {
        agent.state = 'idle';
        agent.subState = 'at_spot';
        agent.pose = 'sit';
        agent.activity = null;
        agent.activityTimer = randRange(1.2, 4.0);
        agent.bubble = '😌';
      }
    }

    function triggerHandoff(fromAgentId, toRoomId, label, folderColor) {
      var agent = agentById[fromAgentId];
      var destRoom = roomById[toRoomId];
      if (!agent || !destRoom) return;
      if (agent.state === 'handoff') return;

      releaseSpot(agent);
      agent.activity = null;
      agent.state = 'handoff';
      agent.handoffTargetRoom = toRoomId;
      agent.handoffLabel = label || ('ส่งงานไป ' + destRoom.label);
      agent.handoffColor = folderColor || '#f2c14e';
      agent.handoffPause = 0;
      agent.pose = 'carry';
      agent.bubble = '📦';

      var spot = destRoom.handoffSpot || destRoom.doors[0] || { x: destRoom.rect.x + 3, y: destRoom.rect.y + 4 };
      setAgentDestination(agent, spot.x, spot.y, 88);
    }

    function pickIdleActivity(agent) {
      releaseSpot(agent);

      // Receptionist stays near front lobby 70% of the time so front desk feels welcoming
      if (agent.id === 'lounge_host' && Math.random() < 0.72) {
        agent.activity = {
          id: 'lobby_duty',
          label: 'ต้อนรับแขกหน้าบริษัท',
          pose: 'sit',
          bubble: Math.random() < 0.5 ? '👋' : '😊'
        };
        agent.activityTimer = randRange(8, 16);
        var sx = agent.seat.x;
        var sy = agent.seat.y;
        var dist = Math.hypot(agent.px - (sx + 0.5) * TILE, agent.py - (sy + 0.85) * TILE);
        if (dist > 6) {
          agent.pose = 'walk';
          setAgentDestination(agent, sx, sy, 56);
        } else {
          agent.subState = 'at_spot';
          agent.dir = 'down';
          agent.pose = 'sit';
          agent.bubble = agent.activity.bubble;
        }
        return;
      }

      // Check if an existing group activity has an open buddy slot (encourages lively group play!)
      if (Math.random() < 0.45) {
        for (var g = 0; g < IDLE_ACTIVITIES.length; g++) {
          var gAct = IDLE_ACTIVITIES[g];
          if (!gAct.group) continue;
          var gRoom = roomById[gAct.roomId];
          if (!gRoom) continue;
          var activeCount = 0;
          var freeSpotIdx = -1;
          for (var si = 0; si < gRoom.idleSpots.length; si++) {
            if (gRoom.idleSpots[si].kind !== gAct.spotKind) continue;
            var key = gAct.roomId + ':' + si;
            if (spotClaims[key]) activeCount++;
            else if (freeSpotIdx === -1) freeSpotIdx = si;
          }
          if (activeCount >= 1 && activeCount < (gAct.maxGroup || 2) && freeSpotIdx !== -1) {
            assignIdleSpot(agent, gAct, gRoom, freeSpotIdx);
            return;
          }
        }
      }

      // Weighted random pick from IDLE_ACTIVITIES
      var totalW = 0;
      for (var w = 0; w < IDLE_ACTIVITIES.length; w++) totalW += IDLE_ACTIVITIES[w].weight;
      var attempts = 6;
      while (attempts-- > 0) {
        var r = Math.random() * totalW;
        var chosen = IDLE_ACTIVITIES[0];
        for (var k = 0; k < IDLE_ACTIVITIES.length; k++) {
          r -= IDLE_ACTIVITIES[k].weight;
          if (r <= 0) { chosen = IDLE_ACTIVITIES[k]; break; }
        }

        if (chosen.spotKind === 'home_seat') {
          agent.activity = chosen;
          agent.activityTimer = randRange(chosen.minSec, chosen.maxSec);
          setAgentDestination(agent, agent.seat.x, agent.seat.y, 58);
          agent.bubble = '';
          return;
        }

        var targetRoom = roomById[chosen.roomId];
        if (!targetRoom) continue;
        // Find free matching spot
        var candidates = [];
        for (var j = 0; j < targetRoom.idleSpots.length; j++) {
          if (targetRoom.idleSpots[j].kind !== chosen.spotKind) continue;
          var sKey = targetRoom.roomId + ':' + j;
          if (!spotClaims[sKey]) candidates.push(j);
        }
        if (candidates.length > 0) {
          var pickIdx = candidates[(Math.random() * candidates.length) | 0];
          assignIdleSpot(agent, chosen, targetRoom, pickIdx);
          return;
        }
      }

      // Fallback: stroll to garden or home seat
      agent.activity = IDLE_ACTIVITIES[IDLE_ACTIVITIES.length - 1];
      agent.activityTimer = randRange(6, 11);
      setAgentDestination(agent, agent.seat.x, agent.seat.y, 55);
    }

    function assignIdleSpot(agent, act, room, spotIdx) {
      var spot = room.idleSpots[spotIdx];
      var key = room.roomId + ':' + spotIdx;
      spotClaims[key] = agent.id;
      agent.claimedSpotKey = key;
      agent.activity = act;
      agent.activityTimer = randRange(act.minSec, act.maxSec);
      agent.targetDir = spot.dir || 'down';
      agent.bubble = '';
      setAgentDestination(agent, spot.x, spot.y, randRange(50, 64));
    }

    // -----------------------------------------------------------------------
    // Live Data Mapper (Strict null/undefined defensive checks)
    // -----------------------------------------------------------------------
    function applyLiveMapping(payload) {
      var data = payload || {};
      var ov = (data.overviewData && typeof data.overviewData === 'object') ? data.overviewData : {};
      var fs = (data.factoryState && typeof data.factoryState === 'object') ? data.factoryState : {};
      var sq = data.socialQueue;
      var crons = Array.isArray(data.cronJobs) ? data.cronJobs : [];

      // Reset room flags (preserve brief pulse)
      for (var rKey in roomState) {
        if (!Object.prototype.hasOwnProperty.call(roomState, rKey)) continue;
        roomState[rKey].active = false;
        roomState[rKey].alert = false;
        roomState[rKey].statusText = 'พักผ่อน/พร้อม';
        roomState[rKey].detail = roomById[rKey].desc;
      }

      var workAssign = {}; // agentId -> { detail, bubble }
      var assign = function (agId, detail, bubble) {
        workAssign[agId] = { detail: detail, bubble: bubble };
        var ag = agentById[agId];
        if (ag && roomState[ag.homeRoom]) {
          roomState[ag.homeRoom].active = true;
          roomState[ag.homeRoom].statusText = '⚡ กำลังทำงาน';
          if (detail) roomState[ag.homeRoom].detail = detail;
        }
      };

      // ---- 1) AI Chat Mapping ----
      var aiObj = (ov.ai && typeof ov.ai === 'object') ? ov.ai : {};
      var aiRunningList = Array.isArray(aiObj.running) ? aiObj.running : [];
      var aiRunningCount = Number(aiObj.runningCount != null ? aiObj.runningCount : aiRunningList.length) || 0;
      var curAiStage = -1;

      if (aiRunningCount > 0 || aiRunningList.length > 0) {
        var firstRun = aiRunningList[0] || {};
        var stepRaw = String(firstRun.stepText || firstRun.stage || firstRun.title || '').toLowerCase();
        var chatTitle = truncateText(firstRun.title || firstRun.stepText || 'AI กำลังประมวลผล', 28);

        if (/(ด่าน\s*3|review|รีวิว|qc|ตรวจ|verify|test)/.test(stepRaw)) {
          curAiStage = 3;
          assign('ai_review', 'รีวิว: ' + chatTitle, '🔍');
        } else if (/(ด่าน\s*2|worker|เวิร์กเกอร์|build|code|เขียน|implement)/.test(stepRaw)) {
          curAiStage = 2;
          assign('ai_worker_1', 'ด่าน 2: ' + chatTitle, '💻');
          assign('ai_worker_2', 'ด่าน 2: ' + chatTitle, '⚡');
          assign('ai_worker_3', 'ด่าน 2: ' + chatTitle, '🛠️');
        } else if (/(ด่าน\s*1|architect|สถาปนิก|plan|วางแผน|blueprint)/.test(stepRaw)) {
          curAiStage = 1;
          assign('ai_architect', 'วางแผน: ' + chatTitle, '📐');
        } else {
          curAiStage = 0;
          assign('ai_router', 'รับงาน: ' + chatTitle, '🤖');
          assign('ai_worker_1', 'ประมวลผล: ' + chatTitle, '💻');
          if (aiRunningCount >= 2) assign('ai_worker_2', 'แชทซ้อน #' + aiRunningCount, '⚡');
          if (aiRunningCount >= 3) assign('ai_worker_3', 'แชทซ้อน #' + aiRunningCount, '⚡');
        }

        // Trigger physical handoff on AI stage transition
        if (prevAiStage >= 0 && curAiStage > prevAiStage && curAiStage < AI_PIPELINE_ROOMS.length) {
          var fromAiAgent = prevAiStage === 0 ? 'ai_router'
            : (prevAiStage === 1 ? 'ai_architect' : 'ai_worker_1');
          triggerHandoff(fromAiAgent, AI_PIPELINE_ROOMS[curAiStage], 'ส่งงาน AI → ' + roomById[AI_PIPELINE_ROOMS[curAiStage]].label, '#9b7eff');
        }
      }
      prevAiStage = curAiStage;

      // ---- 2) Video Studio Pipeline Mapping ----
      var jobs = Array.isArray(fs.jobs) ? fs.jobs : [];
      var socialItems = Array.isArray(sq) ? sq : (sq && Array.isArray(sq.items) ? sq.items : []);
      var runningVideoJob = null;
      for (var ji = 0; ji < jobs.length; ji++) {
        if (isVideoJobActive(jobs[ji])) {
          runningVideoJob = jobs[ji];
          break;
        }
      }
      var socialActive = socialItems.some(function (it) {
        var st = String((it && it.status) || '').toLowerCase();
        return st === 'uploading' || st === 'posting' || st === 'running';
      });
      var qcPending = jobs.filter(function (j) {
        return j && j.status === 'done' && String(j.qcStatus || 'pending') === 'pending';
      }).length;
      var ovVidActive = Number(ov.videos && ov.videos.activeCount || 0);

      var curVidStage = -1;
      if (runningVideoJob) {
        curVidStage = detectVideoStageIndex(runningVideoJob);
        var vTitle = truncateText(runningVideoJob.topic || runningVideoJob.title || runningVideoJob.slug || runningVideoJob.id || 'คลิปวิดีโอ', 26);
        var vPct = Number(runningVideoJob.progress != null ? runningVideoJob.progress : (runningVideoJob.pct || 0));
        var vBubbles = ['📝', '🎨', '🎙️', '✂️', '🚀'];
        assign(VIDEO_STAGE_AGENTS[curVidStage], vTitle + (vPct > 0 ? ' (' + Math.round(vPct) + '%)' : ''), vBubbles[curVidStage]);

        if (prevVideoStage >= 0 && curVidStage !== prevVideoStage && curVidStage > prevVideoStage) {
          triggerHandoff(
            VIDEO_STAGE_AGENTS[prevVideoStage],
            VIDEO_STAGE_ROOMS[curVidStage],
            'ส่งต่อคลิป → ' + roomById[VIDEO_STAGE_ROOMS[curVidStage]].label,
            '#ff8fa3'
          );
        }
      } else if (ovVidActive > 0) {
        curVidStage = 3;
        assign('vid_edit', 'กำลังเรนเดอร์วิดีโอ (' + ovVidActive + ' งาน)', '✂️');
      }

      if (socialActive) {
        assign('vid_publish', 'กำลังอัปโหลด/โพสต์โซเชียล', '🚀');
      } else if (qcPending > 0 && !workAssign.vid_publish) {
        roomState.vid_publish.statusText = 'รอตรวจ QC (' + qcPending + ')';
        roomState.vid_publish.detail = 'มีคลิปเสร็จรอตรวจ QC ' + qcPending + ' รายการ';
      }
      prevVideoStage = curVidStage;

      // ---- 3) Cron & Scheduler Mapping (lastRunAt within 3 min) ----
      var nowMs = Date.now();
      var activeCrons = [];
      for (var ci = 0; ci < crons.length; ci++) {
        var cj = crons[ci];
        if (!cj || !cj.lastRunAt) continue;
        var ms = Number(cj.lastRunAt);
        if (isFinite(ms) && (nowMs - ms) >= 0 && (nowMs - ms) < 180000) {
          activeCrons.push(cj);
        }
      }
      var cronNewsNow = false;
      if (activeCrons.length > 0) {
        for (var ac = 0; ac < activeCrons.length; ac++) {
          var cName = String(activeCrons[ac].name || activeCrons[ac].id || 'Cron Job');
          if (/(news|ข่าว|broadcast|daily-news)/i.test(cName)) {
            cronNewsNow = true;
            assign('cron_news', 'รันข่าวเช้า: ' + truncateText(cName, 22), '📰');
          } else {
            assign('cron_sched', 'รันงานตั้งเวลา: ' + truncateText(cName, 22), '⏰');
          }
        }
        if (cronNewsNow && !prevCronNewsActive) {
          triggerHandoff('cron_sched', 'cron_news', 'ทริกเกอร์ข่าวเช้าอัตโนมัติ', '#f2c94c');
        }
      }
      prevCronNewsActive = cronNewsNow;

      // ---- 4) IT / Agent Hub Mapping ----
      var agHub = (ov.agents && typeof ov.agents === 'object') ? ov.agents : {};
      var hubActiveCount = Number(agHub.activeJobCount || 0);
      var hubActiveJobs = Array.isArray(agHub.activeJobs) ? agHub.activeJobs : [];
      var hubNodes = Array.isArray(agHub.nodes) ? agHub.nodes : [];
      var onlineNodes = Number(agHub.onlineNodes != null ? agHub.onlineNodes : hubNodes.filter(function (n) { return n && n.online; }).length);
      var totalNodes = Number(agHub.totalNodes != null ? agHub.totalNodes : hubNodes.length);

      hubOfflineAlert = (totalNodes > 0 && onlineNodes === 0);
      if (hubOfflineAlert) {
        roomState.hub_workers.alert = true;
        roomState.hub_workers.statusText = '⚠️ ลูกข่ายออฟไลน์';
        roomState.hub_workers.detail = 'ไม่มีลูกข่าย Agent Hub ออนไลน์ (0/' + totalNodes + ')';
      } else if (totalNodes > 0) {
        roomState.hub_workers.detail = 'โหนดออนไลน์ ' + onlineNodes + '/' + totalNodes + ' เครื่อง';
      }

      var hubBusy = (hubActiveCount > 0 || hubActiveJobs.length > 0);
      if (hubBusy) {
        var hJobName = truncateText((hubActiveJobs[0] && (hubActiveJobs[0].name || hubActiveJobs[0].kind)) || ('งาน Offload ' + hubActiveCount + ' รายการ'), 24);
        assign('hub_dispatch', 'กระจายงาน: ' + hJobName, '📡');
        assign('hub_srv_1', 'ประมวลผล: ' + hJobName, '🖥️');
        if (hubActiveCount >= 2 || onlineNodes >= 2) {
          assign('hub_srv_2', 'ช่วยรันงาน: ' + hJobName, '⚙️');
        }
        if (!prevHubActive) {
          triggerHandoff('hub_dispatch', 'hub_workers', 'โยนงานหนักไปลูกข่าย', '#52b4ff');
        }
      }
      prevHubActive = hubBusy;

      // ---- 5) Operations / Infra & Energy Mapping ----
      var infra = (ov.infra && typeof ov.infra === 'object') ? ov.infra : {};
      var problems = Array.isArray(infra.problems) ? infra.problems : [];
      var downCount = Number((ov.attention && ov.attention.servicesDown) || problems.length || 0);
      opsAlert = (problems.length > 0 || downCount > 0);

      if (opsAlert) {
        var probText = problems[0]
          ? truncateText(typeof problems[0] === 'string' ? problems[0] : (problems[0].name || problems[0].message || 'เซอร์วิสขัดข้อง'), 26)
          : ('พบปัญหา ' + downCount + ' รายการ');
        roomState.ops_monitor.alert = true;
        roomState.ops_monitor.statusText = '🚨 แจ้งเตือน!';
        assign('ops_monitor', 'ตรวจแก้: ' + probText, '🚨');
      } else {
        roomState.ops_monitor.detail = 'เซอร์วิสทั้งหมดทำงานปกติ (0 ปัญหา)';
      }

      var energy = infra.energy && typeof infra.energy === 'object' ? infra.energy : null;
      if (energy) {
        var watts = Number(energy.watts != null ? energy.watts : (energy.power != null ? energy.power : NaN));
        var kwh = Number(energy.todayKwh != null ? energy.todayKwh : NaN);
        var eParts = [];
        if (isFinite(watts)) eParts.push(Math.round(watts) + 'W');
        if (isFinite(kwh)) eParts.push(kwh.toFixed(2) + ' kWh วันนี้');
        if (eParts.length > 0) {
          roomState.ops_energy.detail = 'มิเตอร์ PZEM-01: ' + eParts.join(' · ');
        }
        if (isFinite(watts) && watts >= 900) {
          assign('ops_energy', 'โหลดไฟสูง ' + Math.round(watts) + 'W', '⚡');
        }
      }

      // Check whether any real work exists
      var activeKeys = Object.keys(workAssign);
      hasLiveWork = activeKeys.length > 0;

      // Build human headline
      if (hasLiveWork) {
        var hl = [];
        if (curAiStage >= 0) hl.push('🤖 AI (' + Math.max(1, aiRunningCount) + ')');
        if (curVidStage >= 0 || socialActive) hl.push('🎬 วิดีโอ (' + roomById[VIDEO_STAGE_ROOMS[Math.max(0, curVidStage)]].label.replace(/^[^\s]+\s/, '') + ')');
        if (activeCrons.length > 0) hl.push('⏰ Cron (' + activeCrons.length + ')');
        if (hubBusy) hl.push('🖥️ Hub (' + Math.max(1, hubActiveCount) + ')');
        if (opsAlert) hl.push('🚨 Ops แจ้งเตือน');
        liveHeadline = '⚡ กำลังทำงานจริง · ' + hl.join(' · ');
      } else {
        liveHeadline = '';
      }

      // Apply live assignments only when NOT in demoMode
      if (!demoMode) {
        for (var i = 0; i < agents.length; i++) {
          var ag = agents[i];
          if (workAssign[ag.id]) {
            sendAgentToWork(ag, workAssign[ag.id].detail, workAssign[ag.id].bubble);
          } else {
            releaseAgentFromWork(ag);
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Demo Mode Choreographer (Lively company simulation: work + handoffs + chill)
    // -----------------------------------------------------------------------
    function stepDemoSimulation(dt) {
      if (!demoMode) return;
      demoClock += dt;
      demoStageTimer += dt;
      demoAiTimer += dt;

      // Cycle Video Pipeline every 6.5s with physical folder handoff along yellow arrows!
      if (demoStageTimer >= 6.5) {
        demoStageTimer = 0;
        var prevV = demoVideoStage;
        demoVideoStage = (demoVideoStage + 1) % VIDEO_STAGE_ROOMS.length;
        if (demoVideoStage > prevV) {
          triggerHandoff(
            VIDEO_STAGE_AGENTS[prevV],
            VIDEO_STAGE_ROOMS[demoVideoStage],
            'ส่งต่อคลิป Daily News v2 → ' + roomById[VIDEO_STAGE_ROOMS[demoVideoStage]].label,
            '#ff8fa3'
          );
        }
      }

      // Cycle AI Chat Pipeline every 7.5s with handoff along H1!
      if (demoAiTimer >= 7.5) {
        demoAiTimer = 0;
        var prevA = demoAiStage;
        demoAiStage = (demoAiStage + 1) % AI_PIPELINE_ROOMS.length;
        if (demoAiStage > prevA) {
          var fromA = prevA === 0 ? 'ai_router' : (prevA === 1 ? 'ai_architect' : 'ai_worker_1');
          triggerHandoff(
            fromA,
            AI_PIPELINE_ROOMS[demoAiStage],
            'ส่งต่องาน AI → ' + roomById[AI_PIPELINE_ROOMS[demoAiStage]].label,
            '#9b7eff'
          );
        }
      }

      // Determine active demo agents (~6-7 working, ~12-13 chilling/playing in lounge!)
      var demoWork = {};
      var vBubbles = ['📝', '🎨', '🎙️', '✂️', '🚀'];
      var vDetails = [
        'เขียนสคริปต์ Daily News v2',
        'สร้างภาพประกอบข่าว 6 ข่าว',
        'พากย์เสียงไทย + ซิงค์ซับ',
        'เรนเดอร์ Remotion + มิกซ์ BGM',
        'ตรวจ QC และส่ง Telegram'
      ];
      demoWork[VIDEO_STAGE_AGENTS[demoVideoStage]] = { detail: vDetails[demoVideoStage], bubble: vBubbles[demoVideoStage] };

      if (demoAiStage === 0) {
        demoWork.ai_router = { detail: 'คัดกรองคำสั่งผู้ใช้ใหม่', bubble: '🤖' };
      } else if (demoAiStage === 1) {
        demoWork.ai_architect = { detail: 'วางพิมพ์เขียวฟีเจอร์ใหม่', bubble: '📐' };
      } else if (demoAiStage === 2) {
        demoWork.ai_worker_1 = { detail: 'ด่าน 2 · เขียนโมดูลหลัก', bubble: '💻' };
        demoWork.ai_worker_2 = { detail: 'ด่าน 2 · ทำ Unit Test', bubble: '⚡' };
      } else {
        demoWork.ai_review = { detail: 'ด่าน 3 · โค้ดรีวิวและ QA', bubble: '🔍' };
      }

      // Alternate Hub / Cron / Ops background duty so every dept shines
      var bgPhase = Math.floor(demoClock / 10) % 3;
      if (bgPhase === 0) {
        demoWork.hub_dispatch = { detail: 'โยนงานเรนเดอร์ไป GPU โหนด', bubble: '📡' };
        demoWork.hub_srv_1 = { detail: 'asridaytrade · เรนเดอร์ NVENC', bubble: '🖥️' };
      } else if (bgPhase === 1) {
        demoWork.cron_news = { detail: 'จัดเตรียมข่าวเช้า 07:30', bubble: '📰' };
        demoWork.ops_energy = { detail: 'วัดไฟ PZEM-01 · 342W', bubble: '⚡' };
      } else {
        demoWork.ops_monitor = { detail: 'ตรวจสุขภาพ 13 คอนเทนเนอร์', bubble: '🛡️' };
        demoWork.cron_sched = { detail: 'เช็คตาราง Cron อัตโนมัติ', bubble: '⏰' };
      }

      // Update room statuses
      for (var rk in roomState) {
        if (!Object.prototype.hasOwnProperty.call(roomState, rk)) continue;
        roomState[rk].active = false;
        roomState[rk].alert = false;
        roomState[rk].statusText = 'พักผ่อน/พร้อม';
        roomState[rk].detail = roomById[rk].desc;
      }
      for (var i = 0; i < agents.length; i++) {
        var ag = agents[i];
        var dw = demoWork[ag.id];
        if (dw) {
          sendAgentToWork(ag, dw.detail, dw.bubble);
          if (roomState[ag.homeRoom]) {
            roomState[ag.homeRoom].active = true;
            roomState[ag.homeRoom].statusText = '⚡ กำลังทำงาน';
            roomState[ag.homeRoom].detail = dw.detail;
          }
        } else {
          releaseAgentFromWork(ag);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Agent Movement & State Machine Tick
    // -----------------------------------------------------------------------
    function stepAgents(dt, animTick) {
      // Decay door timers & room pulses
      for (var d = 0; d < allDoors.length; d++) {
        if (allDoors[d].openTimer > 0) allDoors[d].openTimer = Math.max(0, allDoors[d].openTimer - dt);
      }
      for (var rk in roomState) {
        if (roomState[rk].pulse > 0) roomState[rk].pulse = Math.max(0, roomState[rk].pulse - dt * 1.4);
      }

      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];

        // 1) Walking along A* path
        if (a.subState === 'walking' && a.path && a.pathIdx < a.path.length) {
          var wp = a.path[a.pathIdx];
          var targetPx = (wp.x + 0.5) * TILE;
          var targetPy = (wp.y + 0.85) * TILE;
          var dx = targetPx - a.px;
          var dy = targetPy - a.py;
          var dist = Math.hypot(dx, dy);
          var step = a.speed * dt;

          if (Math.abs(dx) > Math.abs(dy)) {
            a.dir = dx >= 0 ? 'right' : 'left';
          } else if (Math.abs(dy) > 0.1) {
            a.dir = dy >= 0 ? 'down' : 'up';
          }
          a.pose = (a.state === 'handoff') ? 'carry' : 'walk';

          if (dist <= step) {
            a.px = targetPx;
            a.py = targetPy;
            a.tx = wp.x;
            a.ty = wp.y;
            a.pathIdx++;
          } else {
            a.px += (dx / dist) * step;
            a.py += (dy / dist) * step;
            a.tx = Math.floor(a.px / TILE);
            a.ty = Math.floor(a.py / TILE);
          }

          // Open any door the agent is passing near
          for (var di = 0; di < allDoors.length; di++) {
            var dr = allDoors[di];
            if (Math.abs(a.tx - dr.x) <= 1 && Math.abs(a.ty - dr.y) <= 1) {
              dr.openTimer = 0.65;
            }
          }

          // Check arrival at destination
          if (a.pathIdx >= a.path.length) {
            a.path = [];
            a.pathIdx = 0;
            a.subState = 'at_spot';

            if (a.state === 'returning') {
              if (a.assignedWork) {
                a.state = 'working';
                a.dir = a.seat.dir || 'down';
                a.pose = 'type';
                a.bubble = a.workBubble || '💻';
              } else {
                a.state = 'idle';
                a.dir = a.seat.dir || 'down';
                a.pose = 'sit';
                a.activityTimer = randRange(3, 7);
              }
            } else if (a.state === 'handoff') {
              a.subState = 'delivering';
              a.handoffPause = 1.25;
              a.pose = 'talk';
              a.dir = 'down';
              a.bubble = '🤝';
              if (a.handoffTargetRoom && roomState[a.handoffTargetRoom]) {
                roomState[a.handoffTargetRoom].pulse = 1.0;
              }
            } else if (a.state === 'idle') {
              a.dir = a.targetDir || 'down';
              a.pose = (a.activity && a.activity.pose) || 'idle';
              a.bubble = (a.activity && a.activity.bubble) || '☕';
            }
          }
        } else {
          // 2) Stationary / Performing State Action
          if (a.state === 'working') {
            a.pose = 'type';
            a.dir = a.seat.dir || 'down';
            // Subtle bubble rotation while working
            if (((animTick + a.frameOffset) % 90) === 0) {
              var bList = WORK_BUBBLES[a.deptId] || ['💻'];
              a.bubble = a.workBubble || bList[((animTick / 90 + i) | 0) % bList.length];
            }
          } else if (a.state === 'handoff' && a.subState === 'delivering') {
            a.handoffPause -= dt;
            if (a.handoffPause <= 0) {
              a.handoffTargetRoom = null;
              if (a.assignedWork) {
                a.state = 'returning';
                a.bubble = '⚡';
                setAgentDestination(a, a.seat.x, a.seat.y, 90);
              } else {
                a.state = 'idle';
                a.subState = 'at_spot';
                a.activityTimer = 0.4;
              }
            }
          } else if (a.state === 'idle') {
            a.activityTimer -= dt;
            if (a.activity && a.activity.wander && a.activityTimer > 2 && Math.random() < dt * 0.25) {
              // Wander gently to another garden spot
              var gRm = roomById.lounge_garden;
              if (gRm && gRm.idleSpots.length > 0) {
                var gs = gRm.idleSpots[(Math.random() * gRm.idleSpots.length) | 0];
                setAgentDestination(a, gs.x, gs.y, 44);
              }
            }
            if (a.activityTimer <= 0) {
              pickIdleActivity(a);
            }
          } else if (a.state === 'returning') {
            // Arrived or stuck fallback
            if (a.assignedWork) {
              a.state = 'working';
              a.pose = 'type';
              a.bubble = a.workBubble || '💻';
            } else {
              a.state = 'idle';
              a.activityTimer = 1.0;
            }
          }
        }

        // Track current room for tooltip
        var curRm = getRoomAtPixel(a.px, a.py);
        a.currentRoomId = curRm ? curRm.roomId : null;
      }
    }

    // -----------------------------------------------------------------------
    // Camera Smooth Interpolation & Focus Helpers
    // -----------------------------------------------------------------------
    function focusRect(minX, minY, maxX, maxY, padTiles) {
      var pad = (padTiles != null ? padTiles : 1.5) * TILE;
      var bw = Math.max(120, (maxX - minX) + pad * 2);
      var bh = Math.max(80, (maxY - minY) + pad * 2);
      var zx = WORLD_W / bw;
      var zy = WORLD_H / bh;
      var z = clamp(Math.min(zx, zy), 1.0, 2.55);
      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;

      // Keep viewport inside world bounds
      var halfW = (WORLD_W / 2) / z;
      var halfH = (WORLD_H / 2) / z;
      cam.targetZoom = z;
      cam.targetX = clamp(cx, halfW, WORLD_W - halfW);
      cam.targetY = clamp(cy, halfH, WORLD_H - halfH);

      if (reducedMotion) {
        cam.zoom = cam.targetZoom;
        cam.x = cam.targetX;
        cam.y = cam.targetY;
      }
    }

    function focusDept(deptId) {
      var id = String(deptId || 'all');
      cam.focusedRoomId = null;

      // Also support passing a roomId directly
      if (roomById[id]) {
        return focusRoom(id);
      }

      if (id === 'all' || !DEPTS[id]) {
        cam.focusedDept = 'all';
        cam.targetX = WORLD_W / 2;
        cam.targetY = WORLD_H / 2;
        cam.targetZoom = 1;
        if (reducedMotion) {
          cam.x = cam.targetX;
          cam.y = cam.targetY;
          cam.zoom = 1;
        }
        return;
      }

      cam.focusedDept = id;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < LAYOUT.rooms.length; i++) {
        var r = LAYOUT.rooms[i];
        if (r.deptId !== id) continue;
        minX = Math.min(minX, r.rect.x * TILE);
        minY = Math.min(minY, r.rect.y * TILE);
        maxX = Math.max(maxX, (r.rect.x + r.rect.w) * TILE);
        maxY = Math.max(maxY, (r.rect.y + r.rect.h) * TILE);
      }
      if (isFinite(minX)) {
        focusRect(minX, minY, maxX, maxY, 1.8);
      }
    }

    function focusRoom(roomId) {
      var r = roomById[roomId];
      if (!r) {
        focusDept('all');
        return;
      }
      cam.focusedRoomId = r.roomId;
      cam.focusedDept = r.deptId;
      focusRect(
        r.rect.x * TILE,
        r.rect.y * TILE,
        (r.rect.x + r.rect.w) * TILE,
        (r.rect.y + r.rect.h) * TILE,
        1.4
      );
    }

    function stepCamera(dt) {
      if (reducedMotion) {
        cam.x = cam.targetX;
        cam.y = cam.targetY;
        cam.zoom = cam.targetZoom;
        return;
      }
      var k = 1 - Math.exp(-8.5 * dt);
      cam.x += (cam.targetX - cam.x) * k;
      cam.y += (cam.targetY - cam.y) * k;
      cam.zoom += (cam.targetZoom - cam.zoom) * k;
      if (Math.abs(cam.targetZoom - cam.zoom) < 0.002) {
        cam.zoom = cam.targetZoom;
        cam.x = cam.targetX;
        cam.y = cam.targetY;
      }
    }

    // -----------------------------------------------------------------------
    // Summary & Tooltip Helpers
    // -----------------------------------------------------------------------
    function computeSummary() {
      var working = 0;
      var handoff = 0;
      var idle = 0;
      for (var i = 0; i < agents.length; i++) {
        var st = agents[i].state;
        if (st === 'working' || (st === 'returning' && agents[i].assignedWork)) working++;
        else if (st === 'handoff') handoff++;
        else idle++;
      }

      var headline = '';
      if (demoMode) {
        headline = '🎮 โหมดจำลอง · เอเจนต์กำลังทำงาน ' + working + ' · ส่งงาน ' + handoff + ' · พักผ่อน ' + idle;
      } else if (liveHeadline) {
        headline = liveHeadline;
      } else {
        headline = '☕ ออฟฟิศสงบ · เอเจนต์ ' + agents.length + ' ตัวพักผ่อนและสแตนด์บายรับงาน';
      }

      return {
        total: agents.length,
        agentCount: agents.length,
        working: working,
        busy: working,
        idle: idle,
        resting: idle,
        handoff: handoff,
        delivering: handoff,
        demoMode: demoMode,
        headline: headline
      };
    }

    function updateTooltip() {
      if (!tooltipEl) return;
      if (!pointerInside || (!hoverAgent && !hoverRoom)) {
        tooltipEl.hidden = true;
        return;
      }

      var lines = [];
      if (hoverAgent) {
        var stateLabel = hoverAgent.state === 'working' ? '⚡ กำลังทำงาน'
          : hoverAgent.state === 'handoff' ? '📦 กำลังเดินส่งงาน'
          : hoverAgent.state === 'returning' ? '🏃 เดินกลับโต๊ะทำงาน'
          : '☕ พักผ่อน';
        var taskInfo = hoverAgent.state === 'working'
          ? (hoverAgent.workDetail || hoverAgent.role)
          : hoverAgent.state === 'handoff'
          ? hoverAgent.handoffLabel
          : (hoverAgent.activity ? hoverAgent.activity.label : 'เดินเล่นในออฟฟิศ');
        var curRmObj = hoverAgent.currentRoomId ? roomById[hoverAgent.currentRoomId] : null;
        lines.push(hoverAgent.name + ' · ' + stateLabel);
        lines.push(taskInfo);
        if (curRmObj) lines.push('ตำแหน่ง: ' + curRmObj.label);
      } else if (hoverRoom) {
        var rs = roomState[hoverRoom.roomId];
        var deptMeta = DEPTS[hoverRoom.deptId];
        lines.push(hoverRoom.label + (deptMeta ? ' (' + deptMeta.label.replace(/^[^\s]+\s/, '') + ')' : ''));
        lines.push((rs && rs.statusText ? rs.statusText + ' · ' : '') + (rs ? rs.detail : hoverRoom.desc));
        lines.push('คลิกเพื่อซูมดูห้องนี้');
      }

      // Spec: write textContent (never innerHTML!)
      tooltipEl.textContent = lines.join('\n');
      tooltipEl.style.whiteSpace = 'pre-line';
      tooltipEl.hidden = false;

      // Position neatly inside hostEl
      var rect = hostEl.getBoundingClientRect();
      var relX = mouseClientX - rect.left + 12;
      var relY = mouseClientY - rect.top + 12;
      var tipW = tooltipEl.offsetWidth || 180;
      var tipH = tooltipEl.offsetHeight || 56;
      if (relX + tipW > rect.width - 8) relX = Math.max(8, mouseClientX - rect.left - tipW - 12);
      if (relY + tipH > rect.height - 8) relY = Math.max(8, mouseClientY - rect.top - tipH - 12);
      tooltipEl.style.left = Math.round(relX) + 'px';
      tooltipEl.style.top = Math.round(relY) + 'px';
    }

    // -----------------------------------------------------------------------
    // Coordinate Transform (Screen <-> World)
    // -----------------------------------------------------------------------
    function getViewportTransform() {
      // Fit 1024x640 world into canvas keeping aspect ratio clean
      var scaleBase = Math.min(viewW / WORLD_W, viewH / WORLD_H);
      var scale = scaleBase * cam.zoom;
      var offsetX = (viewW / 2) - cam.x * scale;
      var offsetY = (viewH / 2) - cam.y * scale;
      return { scale: scale, offsetX: offsetX, offsetY: offsetY };
    }

    function clientToWorld(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return { x: -1, y: -1 };
      var sx = (clientX - rect.left) * (viewW / rect.width);
      var sy = (clientY - rect.top) * (viewH / rect.height);
      var tf = getViewportTransform();
      return {
        x: (sx - tf.offsetX) / tf.scale,
        y: (sy - tf.offsetY) / tf.scale
      };
    }

    // -----------------------------------------------------------------------
    // Dynamic Frame Renderer
    // -----------------------------------------------------------------------
    var animTick = 0;

    function drawMiniHud(ctx2d, summary) {
      var now = new Date();
      var hh = String(now.getHours()).padStart(2, '0');
      var mm = String(now.getMinutes()).padStart(2, '0');
      var ss = String(now.getSeconds()).padStart(2, '0');
      var clockStr = hh + ':' + mm + ':' + ss;

      var isLight = themeName === 'light';
      var barBg = isLight ? 'rgba(24, 30, 46, 0.86)' : 'rgba(10, 14, 26, 0.86)';
      var barBorder = isLight ? '#5c6c8a' : '#3a4668';
      var h = 19;
      var pad = 3;
      var y = viewH - h - pad;

      ctx2d.save();
      ctx2d.font = '700 10px "Noto Sans Thai", "Sarabun", system-ui, sans-serif';
      ctx2d.textBaseline = 'middle';

      // Left pill: real clock + working / handoff / idle counters
      var leftText = '🕒 ' + clockStr +
        '  │  ⚡ ทำงาน ' + summary.working +
        '  ·  📦 ส่งงาน ' + summary.handoff +
        '  ·  ☕ พัก ' + summary.idle;
      var lw = Math.min(viewW - 24, Math.ceil(ctx2d.measureText(leftText).width) + 18);

      ctx2d.fillStyle = barBg;
      ctx2d.fillRect(pad, y, lw, h);
      ctx2d.strokeStyle = barBorder;
      ctx2d.lineWidth = 1;
      ctx2d.strokeRect(pad + 0.5, y + 0.5, lw - 1, h - 1);

      ctx2d.fillStyle = '#f3f6ff';
      ctx2d.textAlign = 'left';
      ctx2d.fillText(leftText, pad + 9, y + h / 2 + 0.5);

      // Right zoom pill when focused on a room/department
      if (cam.focusedDept !== 'all' || cam.focusedRoomId) {
        var zLabel = cam.focusedRoomId && roomById[cam.focusedRoomId]
          ? ('🔍 ' + roomById[cam.focusedRoomId].label + ' · คลิกพื้นว่างเพื่อดูทั้งหมด')
          : ('🔍 ' + (DEPTS[cam.focusedDept] ? DEPTS[cam.focusedDept].label : '') + ' · คลิกพื้นว่างเพื่อรีเซ็ต');
        var rw = Math.ceil(ctx2d.measureText(zLabel).width) + 16;
        if (pad + lw + 10 + rw < viewW - pad) {
          var rx = viewW - pad - rw;
          ctx2d.fillStyle = barBg;
          ctx2d.fillRect(rx, y, rw, h);
          ctx2d.strokeStyle = '#6ea8ff';
          ctx2d.strokeRect(rx + 0.5, y + 0.5, rw - 1, h - 1);
          ctx2d.fillStyle = '#c8e4ff';
          ctx2d.fillText(zLabel, rx + 8, y + h / 2 + 0.5);
        }
      }
      ctx2d.restore();
    }

    function renderFrame() {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      var pal = Art.getTheme(themeName);
      ctx.fillStyle = pal.skyTop;
      ctx.fillRect(0, 0, viewW, viewH);

      var tf = getViewportTransform();
      ctx.save();
      ctx.translate(tf.offsetX, tf.offsetY);
      ctx.scale(tf.scale, tf.scale);
      ctx.imageSmoothingEnabled = false;

      // 1) Blit cached static world layer (1 drawImage call!)
      ctx.drawImage(staticCanvas, 0, 0);

      // 2) Animated yellow pipeline arrow pulse when department is active
      var arrowPulse = 0.28 + 0.24 * Math.sin(animTick * 0.25);
      for (var a = 0; a < LAYOUT.arrows.length; a++) {
        var arr = LAYOUT.arrows[a];
        var fromSt = roomState[arr.stageFrom];
        var toSt = roomState[arr.stageTo];
        if ((fromSt && fromSt.active) || (toSt && toSt.active)) {
          drawYellowArrow(ctx, arr.x * TILE, arr.y * TILE, arr.dir, arrowPulse);
        }
      }

      // 3) Animated server rack LEDs & room active/alert/handoff glow overlays
      for (var rk = 0; rk < rackFurniture.length; rk++) {
        var rf = rackFurniture[rk];
        var isAlert = (rf.roomId === 'hub_workers' && hubOfflineAlert) ||
                      (rf.roomId === 'ops_monitor' && opsAlert);
        var isHot = roomState[rf.roomId] && roomState[rf.roomId].active;
        Art.drawFurniture(ctx, 'server_rack', rf.x, rf.y, {
          theme: themeName,
          frame: isHot ? (animTick >> 1) : (animTick >> 3),
          alert: isAlert
        });
      }

      for (var ri = 0; ri < LAYOUT.rooms.length; ri++) {
        var rm = LAYOUT.rooms[ri];
        var st = roomState[rm.roomId];
        var rx = rm.rect.x * TILE;
        var ry = rm.rect.y * TILE;
        var rw = rm.rect.w * TILE;
        var rh = rm.rect.h * TILE;

        if (st.alert) {
          var al = 0.16 + 0.14 * Math.sin(animTick * 0.45);
          ctx.fillStyle = 'rgba(255, 72, 92, ' + al.toFixed(2) + ')';
          ctx.fillRect(rx + 4, ry + TILE, rw - 8, rh - TILE - 8);
          ctx.strokeStyle = 'rgba(255, 95, 110, 0.9)';
          ctx.lineWidth = 2;
          ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
        } else if (st.pulse > 0) {
          ctx.fillStyle = 'rgba(255, 224, 102, ' + (st.pulse * 0.28).toFixed(2) + ')';
          ctx.fillRect(rx + 4, ry + TILE, rw - 8, rh - TILE - 8);
        } else if (st.active) {
          // Subtle active room accent glow on inner rim
          ctx.strokeStyle = 'rgba(110, 235, 200, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
        }

        // Focused room, focused department spotlight, or hover highlight
        if (cam.focusedDept !== 'all' && !cam.focusedRoomId && rm.deptId !== cam.focusedDept) {
          ctx.fillStyle = 'rgba(8, 10, 20, 0.36)';
          ctx.fillRect(rx, ry, rw, rh);
        }
        if (cam.focusedRoomId === rm.roomId) {
          ctx.strokeStyle = '#ffe066';
          ctx.lineWidth = 2;
          ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        } else if (cam.focusedDept !== 'all' && !cam.focusedRoomId && rm.deptId === cam.focusedDept) {
          ctx.strokeStyle = '#ffe066';
          ctx.lineWidth = 1.8;
          ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        } else if (hoverRoom === rm && !hoverAgent) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        }
      }

      // 4) Dynamic doors (swing open when any agent passes nearby!)
      for (var di = 0; di < allDoors.length; di++) {
        var dr = allDoors[di];
        var isOpen = dr.openTimer > 0;
        Art.drawDoor(ctx, dr.x * TILE, dr.y * TILE, isOpen, {
          theme: themeName,
          orient: dr.orient,
          w: TILE,
          h: TILE
        });
      }

      // 5) Y-Sorted Render List: Foreground Furniture (desks, monitors, tables, trees) + 19 Agents
      var drawList = [];
      for (var fi = 0; fi < fgFurniture.length; fi++) {
        drawList.push({ kind: 'furn', sortY: fgFurniture[fi].sortY, ref: fgFurniture[fi] });
      }
      for (var ai = 0; ai < agents.length; ai++) {
        drawList.push({ kind: 'agent', sortY: agents[ai].py, ref: agents[ai] });
      }
      drawList.sort(function (a0, b0) { return a0.sortY - b0.sortY; });

      for (var dl = 0; dl < drawList.length; dl++) {
        var item = drawList[dl];
        if (item.kind === 'furn') {
          var ff = item.ref;
          var rmActive = roomState[ff.roomId] && roomState[ff.roomId].active;
          var fOpts = Object.assign({
            theme: themeName,
            on: true,
            glow: ff.screen && (rmActive || themeName === 'dark'),
            screenColor: ff.screenCol,
            frame: rmActive ? (animTick >> 1) : (animTick >> 3)
          }, ff.opts);
          Art.drawFurniture(ctx, ff.type, ff.x, ff.y, fOpts);
        } else {
          var ag = item.ref;
          // Hover ring under hovered agent
          if (hoverAgent === ag) {
            ctx.fillStyle = 'rgba(255, 232, 112, 0.55)';
            ctx.fillRect((ag.px - 7) | 0, (ag.py - 3) | 0, 14, 5);
          }
          var charFrame = ag.pose === 'type'
            ? ((animTick >> 1) + ag.frameOffset)
            : ((animTick >> 2) + ag.frameOffset);
          Art.drawCharacter(ctx, ag.px, ag.py, {
            look: ag.look,
            dir: ag.dir,
            pose: ag.pose,
            frame: charFrame,
            carryColor: ag.handoffColor
          });
        }
      }

      // 6) Floating Status / Activity Bubbles (drawn above all furniture & characters)
      for (var bi = 0; bi < agents.length; bi++) {
        var ba = agents[bi];
        if (!ba.bubble) continue;
        // Show bubbles when working, carrying handoff, delivering, or chilling at spot
        if (ba.state === 'idle' && ba.subState === 'walking') continue;
        var bob = Math.sin((animTick * 0.14) + bi) > 0.35 ? -1 : 0;
        Art.drawBubble(ctx, ba.px, ba.py - 21 + bob, ba.bubble, {
          theme: themeName,
          style: ba.pose === 'sleep' ? 'thought' : 'speech'
        });
      }

      // Subtle agent name tag when zoomed in (>= 1.55x) or hovered
      if (cam.zoom >= 1.55 || hoverAgent) {
        ctx.font = '700 8px "Noto Sans Thai", "Sarabun", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (var ni = 0; ni < agents.length; ni++) {
          var na = agents[ni];
          if (cam.zoom < 1.55 && hoverAgent !== na) continue;
          var tw = ctx.measureText(na.name).width + 6;
          var nx = (na.px - tw / 2) | 0;
          var ny = (na.py + 2) | 0;
          ctx.fillStyle = 'rgba(15, 18, 30, 0.78)';
          ctx.fillRect(nx, ny, tw, 11);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(na.name, na.px, ny + 1.5);
        }
      }

      ctx.restore();

      // 7) Screen-space Pixel Mini HUD (bottom bar)
      drawMiniHud(ctx, computeSummary());

      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Animation Loop (Capped at 30fps, 8fps under reduced-motion, paused when hidden)
    // -----------------------------------------------------------------------
    var rafId = null;
    var lastFrameTs = 0;
    var lastStepTs = 0;

    function shouldRun() {
      if (destroyed || !active) return false;
      if (typeof document !== 'undefined' && document.hidden) return false;
      return true;
    }

    function stopLoop() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (typeof window !== 'undefined' && window.__poStats) {
        window.__poStats.active = false;
      }
    }

    function loop(ts) {
      rafId = null;
      if (!shouldRun()) return;

      var targetFps = reducedMotion ? 8 : 30;
      var minInterval = 1000 / targetFps;

      if (!lastFrameTs || (ts - lastFrameTs) >= (minInterval - 1)) {
        var dt = lastStepTs ? Math.min(0.12, (ts - lastStepTs) / 1000) : (1 / targetFps);
        lastFrameTs = ts;
        lastStepTs = ts;
        animTick = (animTick + 1) & 0x7fffffff;

        if (demoMode) stepDemoSimulation(dt);
        stepAgents(dt, animTick);
        stepCamera(dt);
        if (pointerInside) {
          hoverAgent = getAgentAtPixel(mouseWorldX, mouseWorldY);
          hoverRoom = getRoomAtPixel(mouseWorldX, mouseWorldY);
          updateTooltip();
        }
        renderFrame();
        if (typeof window !== 'undefined') {
          var stats = window.__poStats || (window.__poStats = {
            frames: 0,
            fps: 0,
            targetFps: targetFps,
            active: true,
            animTick: 0,
            demoMode: demoMode,
            _secTs: ts,
            _secFrames: 0
          });
          stats.frames += 1;
          stats._secFrames += 1;
          stats.targetFps = targetFps;
          stats.active = active;
          stats.animTick = animTick;
          stats.demoMode = demoMode;
          if (ts - stats._secTs >= 1000) {
            stats.fps = Math.round((stats._secFrames * 1000) / (ts - stats._secTs));
            stats._secTs = ts;
            stats._secFrames = 0;
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    }

    function ensureLoop() {
      if (!shouldRun()) {
        stopLoop();
        return;
      }
      if (rafId == null) {
        lastFrameTs = 0;
        lastStepTs = 0;
        rafId = requestAnimationFrame(loop);
      }
    }

    // -----------------------------------------------------------------------
    // Sizing & ResizeObserver
    // -----------------------------------------------------------------------
    function resizeCanvas() {
      if (destroyed) return;
      var rect = hostEl.getBoundingClientRect();
      var w = Math.max(320, Math.round(rect.width || hostEl.clientWidth || WORLD_W));
      var h = Math.max(200, Math.round(rect.height || hostEl.clientHeight || Math.round(w * (WORLD_H / WORLD_W))));
      dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      viewW = w;
      viewH = h;
      var bw = Math.round(w * dpr);
      var bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      renderFrame();
    }

    var resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(function () {
        resizeCanvas();
      });
      resizeObserver.observe(hostEl);
    }

    // -----------------------------------------------------------------------
    // Pointer / Click / Visibility / Reduced-Motion Listeners
    // -----------------------------------------------------------------------
    function onPointerMove(e) {
      pointerInside = true;
      mouseClientX = e.clientX;
      mouseClientY = e.clientY;
      var wpt = clientToWorld(e.clientX, e.clientY);
      mouseWorldX = wpt.x;
      mouseWorldY = wpt.y;
      hoverAgent = getAgentAtPixel(wpt.x, wpt.y);
      hoverRoom = getRoomAtPixel(wpt.x, wpt.y);
      canvas.style.cursor = (hoverAgent || hoverRoom) ? 'pointer' : 'default';
      updateTooltip();
    }

    function onPointerLeave() {
      pointerInside = false;
      hoverAgent = null;
      hoverRoom = null;
      if (tooltipEl) tooltipEl.hidden = true;
    }

    function onClick(e) {
      var wpt = clientToWorld(e.clientX, e.clientY);
      var hitAg = getAgentAtPixel(wpt.x, wpt.y);
      var hitRm = getRoomAtPixel(wpt.x, wpt.y);

      if (hitAg) {
        var targetRmId = hitAg.currentRoomId || hitAg.homeRoom;
        focusRoom(targetRmId);
        if (onSelect) {
          onSelect({
            type: 'agent',
            dept: hitAg.deptId,
            roomId: targetRmId,
            roomLabel: roomById[targetRmId] ? roomById[targetRmId].label : '',
            agentId: hitAg.id,
            agentName: hitAg.name,
            state: hitAg.state,
            detail: hitAg.workDetail || (hitAg.activity ? hitAg.activity.label : hitAg.role)
          });
        }
        renderFrame();
        return;
      }

      if (hitRm) {
        if (cam.focusedRoomId === hitRm.roomId) {
          focusDept('all');
          if (onSelect) onSelect({ type: 'all', dept: 'all' });
        } else {
          focusRoom(hitRm.roomId);
          if (onSelect) {
            var rs = roomState[hitRm.roomId];
            onSelect({
              type: 'room',
              dept: hitRm.deptId,
              roomId: hitRm.roomId,
              roomLabel: hitRm.label,
              statusText: rs ? rs.statusText : '',
              detail: rs ? rs.detail : hitRm.desc
            });
          }
        }
        renderFrame();
        return;
      }

      // Clicking corridor/outside resets zoom to overview
      if (cam.focusedDept !== 'all' || cam.focusedRoomId) {
        focusDept('all');
        if (onSelect) onSelect({ type: 'all', dept: 'all' });
        renderFrame();
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopLoop();
      } else {
        ensureLoop();
      }
    }

    function onReducedMotionChange(ev) {
      reducedMotion = Boolean(ev.matches);
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('click', onClick);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (mqlReduced) {
      if (typeof mqlReduced.addEventListener === 'function') {
        mqlReduced.addEventListener('change', onReducedMotionChange);
      } else if (typeof mqlReduced.addListener === 'function') {
        mqlReduced.addListener(onReducedMotionChange);
      }
    }

    // Kick off initial idle spread: seed several agents already enjoying cafe/games/gym/garden!
    var seedSpots = [
      { agId: 'vid_art',     roomId: 'lounge_games',  spotIdx: 0, actId: 'cards_group' },
      { agId: 'vid_edit',    roomId: 'lounge_games',  spotIdx: 1, actId: 'cards_group' },
      { agId: 'vid_publish', roomId: 'lounge_cafe',   spotIdx: 0, actId: 'coffee' },
      { agId: 'ops_energy',  roomId: 'lounge_gym',    spotIdx: 0, actId: 'treadmill' },
      { agId: 'ops_monitor', roomId: 'lounge_gym',    spotIdx: 2, actId: 'dumbbell' },
      { agId: 'ai_review',   roomId: 'lounge_garden', spotIdx: 0, actId: 'garden_bench' },
      { agId: 'ai_architect', roomId: 'lounge_cafe',  spotIdx: 3, actId: 'sofa_nap' }
    ];
    for (var si = 0; si < seedSpots.length; si++) {
      var ss = seedSpots[si];
      var sAg = agentById[ss.agId];
      var sRm = roomById[ss.roomId];
      var sAct = null;
      for (var ia = 0; ia < IDLE_ACTIVITIES.length; ia++) {
        if (IDLE_ACTIVITIES[ia].id === ss.actId) { sAct = IDLE_ACTIVITIES[ia]; break; }
      }
      if (sAg && sRm && sRm.idleSpots[ss.spotIdx] && sAct) {
        var sp0 = sRm.idleSpots[ss.spotIdx];
        var sKey = sRm.roomId + ':' + ss.spotIdx;
        spotClaims[sKey] = sAg.id;
        sAg.claimedSpotKey = sKey;
        sAg.px = (sp0.x + 0.5) * TILE;
        sAg.py = (sp0.y + 0.85) * TILE;
        sAg.tx = sp0.x;
        sAg.ty = sp0.y;
        sAg.dir = sp0.dir || 'down';
        sAg.pose = sAct.pose;
        sAg.bubble = sAct.bubble;
        sAg.activity = sAct;
        sAg.activityTimer = randRange(5, 13);
        sAg.currentRoomId = sRm.roomId;
      }
    }
    if (demoMode) {
      stepDemoSimulation(0.05);
    }

    resizeCanvas();
    ensureLoop();

    // -----------------------------------------------------------------------
    // Public Controller API
    // -----------------------------------------------------------------------
    var controller = {
      updateState: function (payload) {
        if (destroyed) return computeSummary();
        lastPayload = payload || null;
        applyLiveMapping(lastPayload);
        return computeSummary();
      },
      getState: function () {
        var sum = computeSummary();
        sum.focusedDept = cam.focusedDept;
        sum.focusedRoomId = cam.focusedRoomId;
        sum.theme = themeName;
        return sum;
      },
      setTheme: function (name) {
        if (destroyed) return;
        var next = (name === 'light') ? 'light' : 'dark';
        if (next === themeName) return;
        themeName = next;
        staticCanvas = renderStaticLayer(Art, themeName);
        renderFrame();
      },
      setActive: function (flag) {
        if (destroyed) return;
        active = Boolean(flag);
        if (active) {
          resizeCanvas();
          ensureLoop();
        } else {
          stopLoop();
          if (tooltipEl) tooltipEl.hidden = true;
        }
      },
      setDemoMode: function (flag) {
        if (destroyed) return;
        var next = Boolean(flag);
        if (next === demoMode) return;
        demoMode = next;
        if (demoMode) {
          stepDemoSimulation(0.05);
        } else {
          applyLiveMapping(lastPayload);
        }
        renderFrame();
      },
      focusDept: function (deptId) {
        if (destroyed) return;
        focusDept(deptId);
        renderFrame();
      },
      focusRoom: function (roomId) {
        if (destroyed) return;
        focusRoom(roomId);
        renderFrame();
      },
      resetView: function () {
        if (destroyed) return;
        focusDept('all');
        renderFrame();
      },
      resetCamera: function () {
        if (destroyed) return;
        focusDept('all');
        renderFrame();
      },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        stopLoop();
        if (resizeObserver) {
          resizeObserver.disconnect();
          resizeObserver = null;
        }
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        canvas.removeEventListener('click', onClick);
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
        if (mqlReduced) {
          if (typeof mqlReduced.removeEventListener === 'function') {
            mqlReduced.removeEventListener('change', onReducedMotionChange);
          } else if (typeof mqlReduced.removeListener === 'function') {
            mqlReduced.removeListener(onReducedMotionChange);
          }
        }
        if (tooltipEl) tooltipEl.hidden = true;
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        staticCanvas = null;
      }
    };

    return controller;
  }

  // ---------------------------------------------------------------------------
  // Export & Ready Event
  // ---------------------------------------------------------------------------
  var api = {
    LAYOUT: LAYOUT,
    DEPTS: DEPTS,
    AGENT_SPECS: AGENT_SPECS,
    IDLE_ACTIVITIES: IDLE_ACTIVITIES,
    mount: mount
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HomelabPixelOffice = api;
    if (typeof root.dispatchEvent === 'function' && typeof Event === 'function') {
      root.dispatchEvent(new Event('homelab:pixeloffice-ready'));
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
