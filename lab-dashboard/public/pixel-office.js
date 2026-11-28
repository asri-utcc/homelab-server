/*
 * Homelab Pixel Company v2 — Architectural Campus 2D Pixel-Art Office Engine
 * 40x30 tile world (640x480 px, 4:3) with 8 asymmetric architectural zones,
 * sunlit open atrium/plaza, glass walls, wooden terrace, garden wellness deck,
 * intra-room & cross-room handoffs, and 11 distinct Thai agents.
 * v2.1 — a designed entrance forecourt (fountain plaza, lawns, driveway) fills the
 *        bottom 5 tile rows so the 4:3 stage matches the dashboard card with no dead band.
 *
 * Classic IIFE using window.PixelOfficeArt (pure Canvas 2D, zero external assets).
 * Exports: window.HomelabPixelOffice = { LAYOUT, DEPTS, AGENT_SPECS, IDLE_ACTIVITIES, mount }
 * Dispatches: window Event 'homelab:pixeloffice-ready'
 */
(function (root) {
  'use strict';

  var TILE = 16;
  var WORLD_W_TILES = 40;
  var WORLD_H_TILES = 30; // 25 tiles campus + 5 tiles designed entrance forecourt → 4:3 stage
  var WORLD_W = WORLD_W_TILES * TILE; // 640
  var WORLD_H = WORLD_H_TILES * TILE; // 480
  var CAMPUS_H = 25 * TILE;           // 400 — building footprint ends here

  // ---------------------------------------------------------------------------
  // 1. Departments & Asymmetric Architectural Campus Layout (40 x 25 tiles)
  // ---------------------------------------------------------------------------
  var DEPTS = {
    all:    { id: 'all',    label: '🏢 ภาพรวมทั้งบริษัท', color: '#6b7799' },
    ai:     { id: 'ai',     label: '🤖 ทีม AI',           color: '#6d4bc4' },
    video:  { id: 'video',  label: '🎬 สตูดิโอวิดีโอ',     color: '#d9667a' },
    hub:    { id: 'hub',    label: '🖥️ ระบบ & โหนด',      color: '#3d6fb6' },
    lounge: { id: 'lounge', label: '☕ พักผ่อน & สวน',     color: '#8a6a4a' }
  };

  var DEPT_ALIASES = {
    ops: 'hub',
    cron: 'video'
  };

  // Bright sunlit atrium & open plaza corridors (no yellow road arrows!)
  var CORRIDORS = [
    { id: 'ATRIUM_V',   x: 23, y: 2,  w: 2,  h: 22 }, // Vertical glass atrium dividing left campus & right video wing
    { id: 'PLAZA_H',    x: 1,  y: 12, w: 22, h: 2  }, // Open central plaza linking upper & lower zones
    { id: 'PLAZA_NOOK', x: 15, y: 11, w: 8,  h: 1  }  // Architectural setback nook under ops_hub (water cooler chat area)
  ];

  // Kept empty for backward-compatibility (yellow road arrows removed in v2)
  var PIPELINE_ARROWS = [];

  // 8 asymmetric architectural zones across 4 main departments on 40x25 grid
  var LAYOUT = {
    widthTiles: WORLD_W_TILES,
    heightTiles: WORLD_H_TILES,
    tile: TILE,
    corridors: CORRIDORS,
    arrows: PIPELINE_ARROWS,
    rooms: [
      // ===================== 1. AI STUDIO (Open-Plan 3 Corners) =====================
      {
        deptId: 'ai',
        roomId: 'ai_studio',
        label: '🤖 โซนทีม AI',
        desc: 'พื้นที่ Open-plan ทีม AI ด่าน 1 สถาปนิก · ด่าน 2 เดฟคู่ · ด่าน 3 โค้ดรีวิว/QA',
        rect: { x: 1, y: 2, w: 14, h: 10 },
        floor: 'wood',
        wallStyle: 'solid',
        signOffsetX: 0,
        doors: [
          { x: 7,  y: 11, openArch: true },
          { x: 8,  y: 11, openArch: true },
          { x: 14, y: 6,  orient: 'vertical' }
        ],
        seats: [
          { x: 3,  y: 6, dir: 'down', deskX: 2.4,  deskY: 6.65 }, // ai_architect
          { x: 6,  y: 6, dir: 'down', deskX: 5.4,  deskY: 6.65 }, // ai_worker_1
          { x: 9,  y: 6, dir: 'down', deskX: 8.4,  deskY: 6.65 }, // ai_worker_2
          { x: 12, y: 6, dir: 'down', deskX: 11.4, deskY: 6.65 }  // ai_review
        ],
        handoffSpot: { x: 7, y: 9 },
        idleSpots: [
          { x: 4,  y: 5, dir: 'up',   kind: 'read_book' },
          { x: 10, y: 9, dir: 'left', kind: 'ai_chat' }
        ],
        furniture: [
          // Zone rugs defining 3 soft open-plan corners without solid walls
          { type: 'rug', x: 2.0,  y: 5.1, layer: 'static', opts: { w: 46, h: 42, color: '#584196' } },
          { type: 'rug', x: 5.3,  y: 5.1, layer: 'static', opts: { w: 84, h: 42, color: '#3b4d78' } },
          { type: 'rug', x: 11.1, y: 5.1, layer: 'static', opts: { w: 42, h: 42, color: '#3a6658' } },
          // Top architectural wall fixtures (spaced neatly below room sign)
          { type: 'whiteboard',   x: 2.1,  y: 3.15, layer: 'static' },
          { type: 'bookshelf',    x: 4.7,  y: 3.05, layer: 'static' },
          { type: 'window_city',  x: 6.6,  y: 3.2,  layer: 'static' },
          { type: 'kanban_board', x: 9.3,  y: 3.15, layer: 'static' },
          { type: 'plant',        x: 12.6, y: 3.25, layer: 'static' },
          // Low frosted-glass planter partitions framing the open entrance aisle
          { type: 'partition_glass', x: 4.4,  y: 9.0, layer: 'fg', solid: [{ x: 4, y: 9 }] },
          { type: 'partition_glass', x: 9.5,  y: 9.0, layer: 'fg', solid: [{ x: 10, y: 9 }] },
          { type: 'printer',         x: 12.1, y: 8.95, layer: 'static' },
          { type: 'plant',           x: 2.0,  y: 8.9,  layer: 'static' },
          // 4 Workstations (chairs static behind desks; desks & dual monitors Y-sorted fg)
          { type: 'chair', x: 3.05,  y: 6.15, layer: 'static' },
          { type: 'chair', x: 6.05,  y: 6.15, layer: 'static' },
          { type: 'chair', x: 9.05,  y: 6.15, layer: 'static' },
          { type: 'chair', x: 12.05, y: 6.15, layer: 'static' },
          { type: 'desk',  x: 2.4,  y: 6.65, layer: 'fg', solid: [{ x: 2, y: 7 }, { x: 3, y: 7 }] },
          { type: 'desk',  x: 5.4,  y: 6.65, layer: 'fg', solid: [{ x: 5, y: 7 }, { x: 6, y: 7 }] },
          { type: 'desk',  x: 8.4,  y: 6.65, layer: 'fg', solid: [{ x: 8, y: 7 }, { x: 9, y: 7 }] },
          { type: 'desk',  x: 11.4, y: 6.65, layer: 'fg', solid: [{ x: 11, y: 7 }, { x: 12, y: 7 }] },
          { type: 'dual_monitor', x: 2.55,  y: 6.38, layer: 'fg', screen: true, screenCol: '#a47eff' },
          { type: 'dual_monitor', x: 5.55,  y: 6.38, layer: 'fg', screen: true, screenCol: '#38e8c6' },
          { type: 'dual_monitor', x: 8.55,  y: 6.38, layer: 'fg', screen: true, screenCol: '#59c7ff' },
          { type: 'dual_monitor', x: 11.55, y: 6.38, layer: 'fg', screen: true, screenCol: '#4de09d' }
        ]
      },

      // ===================== 2. OPS & NODE HUB (Glass-Walled Data Center) =====================
      {
        deptId: 'hub',
        roomId: 'ops_hub',
        label: '🖥️ ระบบ & โหนด',
        desc: 'ศูนย์ควบคุม Agent Hub ลูกข่าย GPU (asridaytrade/servergigi), Docker/PM2, PZEM-01 & Cron ระบบ',
        rect: { x: 15, y: 2, w: 8, h: 9 },
        floor: 'concrete',
        wallStyle: 'glass',
        signOffsetX: 0,
        doors: [
          { x: 18, y: 10 },
          { x: 19, y: 10 },
          { x: 15, y: 6, orient: 'vertical', sharedHide: true }
        ],
        seats: [
          { x: 17, y: 6, dir: 'down', deskX: 16.25, deskY: 6.65 }, // hub_dispatch
          { x: 20, y: 6, dir: 'down', deskX: 19.45, deskY: 6.65 }  // ops_sys
        ],
        handoffSpot: { x: 18, y: 8 },
        // Water cooler chat spots in PLAZA_NOOK right outside ops_hub's glass wall!
        idleSpots: [
          { x: 16, y: 11, dir: 'right', kind: 'water_chat_group' },
          { x: 17, y: 11, dir: 'left',  kind: 'water_chat_group' }
        ],
        furniture: [
          { type: 'server_rack', x: 16.2, y: 3.15, layer: 'static', rack: true },
          { type: 'server_rack', x: 18.4, y: 3.15, layer: 'static', rack: true },
          { type: 'server_rack', x: 20.6, y: 3.15, layer: 'static', rack: true },
          { type: 'chair', x: 17.05, y: 6.15, layer: 'static' },
          { type: 'chair', x: 20.05, y: 6.15, layer: 'static' },
          { type: 'desk',  x: 16.25, y: 6.65, layer: 'fg', opts: { w: 28 }, solid: [{ x: 16, y: 7 }, { x: 17, y: 7 }] },
          { type: 'desk',  x: 19.45, y: 6.65, layer: 'fg', opts: { w: 28 }, solid: [{ x: 20, y: 7 }, { x: 21, y: 7 }] },
          { type: 'dual_monitor', x: 16.25, y: 6.38, layer: 'fg', screen: true, screenCol: '#4fc3ff' },
          { type: 'dual_monitor', x: 19.45, y: 6.38, layer: 'fg', screen: true, screenCol: '#4de09d' }
        ]
      },

      // ===================== 3. VIDEO CREATIVE (Script & Storyboard) =====================
      {
        deptId: 'video',
        roomId: 'vid_creative',
        label: '📝 สคริปต์ & วาดภาพ',
        desc: 'คิดบทวิดีโอ รายการข่าวเช้า ออกแบบสตอรี่บอร์ดและภาพประกอบ (ขั้น 1–2)',
        rect: { x: 25, y: 2, w: 14, h: 8 },
        floor: 'wood',
        wallStyle: 'solid',
        signOffsetX: 0,
        doors: [
          { x: 25, y: 6, orient: 'vertical' },
          { x: 27, y: 9 },
          { x: 35, y: 9 }
        ],
        seats: [
          { x: 29, y: 6, dir: 'down', deskX: 28.4, deskY: 6.55 }, // vid_script
          { x: 33, y: 6, dir: 'down', deskX: 32.4, deskY: 6.55 }  // vid_art
        ],
        handoffSpot: { x: 31, y: 7 },
        idleSpots: [
          { x: 34, y: 5, dir: 'up', kind: 'read_book' }
        ],
        furniture: [
          { type: 'rug',         x: 27.6, y: 5.0,  layer: 'static', opts: { w: 118, h: 42, color: '#7a3d4e' } },
          { type: 'whiteboard',  x: 26.2, y: 3.15, layer: 'static' },
          { type: 'window_city', x: 29.4, y: 3.2,  layer: 'static' },
          { type: 'bookshelf',   x: 32.6, y: 3.05, layer: 'static' },
          { type: 'easel',       x: 35.0, y: 3.15, layer: 'static' },
          { type: 'plant',       x: 36.7, y: 3.25, layer: 'static' },
          { type: 'chair',       x: 29.05, y: 6.05, layer: 'static' },
          { type: 'chair',       x: 33.05, y: 6.05, layer: 'static' },
          { type: 'desk',        x: 28.4,  y: 6.55, layer: 'fg', solid: [{ x: 28, y: 7 }, { x: 29, y: 7 }] },
          { type: 'desk',        x: 32.4,  y: 6.55, layer: 'fg', solid: [{ x: 32, y: 7 }, { x: 33, y: 7 }] },
          { type: 'pc',          x: 28.85, y: 6.3,  layer: 'fg', screen: true, screenCol: '#ff96ad' },
          { type: 'dual_monitor', x: 32.55, y: 6.3, layer: 'fg', screen: true, screenCol: '#ff7ea5' }
        ]
      },

      // ===================== 4. VOICE RECORDING BOOTH (Glass Studio) =====================
      {
        deptId: 'video',
        roomId: 'vid_voice',
        label: '🎙️ ห้องอัดเสียง',
        desc: 'พากย์เสียงไทย TTS และซิงค์คำบรรยาย (ขั้น 3)',
        rect: { x: 25, y: 10, w: 8, h: 6 },
        floor: 'carpet',
        floorColor: 'video',
        wallStyle: 'glass',
        signOffsetX: 14,
        doors: [
          { x: 25, y: 12, orient: 'vertical' },
          { x: 27, y: 10, sharedHide: true },
          { x: 27, y: 15 }
        ],
        seats: [
          { x: 28, y: 12, dir: 'down', deskX: 27.6, deskY: 12.65 } // vid_tts
        ],
        handoffSpot: { x: 27, y: 13 },
        idleSpots: [
          { x: 30, y: 14, dir: 'up', kind: 'voice_prep' }
        ],
        furniture: [
          { type: 'clock',          x: 28.4,  y: 11.15, layer: 'static' },
          { type: 'mic_booth',      x: 30.1,  y: 11.2,  layer: 'fg', studioProp: true },
          { type: 'chair',          x: 28.05, y: 12.1,  layer: 'static' },
          { type: 'mixing_console', x: 27.6,  y: 12.65, layer: 'fg', studioProp: true, solid: [{ x: 28, y: 13 }, { x: 29, y: 13 }] }
        ]
      },

      // ===================== 5. OUTDOOR TERRACE / BALCONY (Cantilevered Deck) =====================
      {
        deptId: 'video',
        roomId: 'vid_balcony',
        label: '🌅 ระเบียง',
        desc: 'ระเบียงไม้กลางแจ้งรับลม ชมวิว จิบกาแฟเติมไอเดีย',
        rect: { x: 33, y: 10, w: 6, h: 6 },
        floor: 'deck',
        isOutdoor: true,
        wallStyle: 'fence',
        signOffsetX: 12,
        doors: [
          { x: 35, y: 10, sharedHide: true },
          { x: 35, y: 15 }
        ],
        seats: [],
        handoffSpot: { x: 35, y: 13 },
        idleSpots: [
          { x: 34, y: 12, dir: 'right', kind: 'balcony_chill' },
          { x: 35, y: 13, dir: 'right', kind: 'balcony_chill' },
          { x: 37, y: 12, dir: 'left',  kind: 'balcony_chill' }
        ],
        furniture: [
          { type: 'plant',       x: 34.05, y: 11.15, layer: 'static' },
          { type: 'bench',       x: 36.1,  y: 11.2,  layer: 'static', opts: { w: 26 } },
          { type: 'patio_table', x: 35.75, y: 12.35, layer: 'fg', animatedProp: true, solid: [{ x: 36, y: 13 }] },
          { type: 'plant',       x: 37.0,  y: 13.7,  layer: 'static' }
        ]
      },

      // ===================== 6. VIDEO EDIT & PUBLISH SUITE =====================
      {
        deptId: 'video',
        roomId: 'vid_edit',
        label: '✂️ ตัดต่อ & เผยแพร่',
        desc: 'เรนเดอร์ Remotion มิกซ์ BGM/SFX ตรวจ QC ส่ง Telegram และโพสต์โซเชียล (ขั้น 4–5)',
        rect: { x: 25, y: 16, w: 14, h: 8 },
        floor: 'tile',
        wallStyle: 'solid',
        signOffsetX: -6,
        doors: [
          { x: 25, y: 19, orient: 'vertical' },
          { x: 27, y: 16, sharedHide: true },
          { x: 35, y: 16, sharedHide: true }
        ],
        seats: [
          { x: 29, y: 20, dir: 'down', deskX: 28.4, deskY: 20.55 }, // vid_edit
          { x: 33, y: 20, dir: 'down', deskX: 32.4, deskY: 20.55 }  // vid_publish
        ],
        handoffSpot: { x: 31, y: 19 },
        idleSpots: [
          { x: 31, y: 22, dir: 'up', kind: 'edit_review' }
        ],
        furniture: [
          { type: 'rug',            x: 27.6, y: 19.0,  layer: 'static', opts: { w: 120, h: 42, color: '#5c415e' } },
          { type: 'film_camera',    x: 26.0, y: 17.35, layer: 'fg',     studioProp: true },
          { type: 'kanban_board',   x: 29.4, y: 17.2,  layer: 'static' },
          { type: 'rocket_antenna', x: 36.1, y: 17.2,  layer: 'fg',     studioProp: true },
          { type: 'plant',          x: 36.8, y: 21.1,  layer: 'static' },
          { type: 'chair',          x: 29.05, y: 20.05, layer: 'static' },
          { type: 'chair',          x: 33.05, y: 20.05, layer: 'static' },
          { type: 'desk',           x: 28.4,  y: 20.55, layer: 'fg', solid: [{ x: 28, y: 21 }, { x: 29, y: 21 }] },
          { type: 'desk',           x: 32.4,  y: 20.55, layer: 'fg', solid: [{ x: 32, y: 21 }, { x: 33, y: 21 }] },
          { type: 'dual_monitor',   x: 28.55, y: 20.3,  layer: 'fg', screen: true, screenCol: '#ffd05c' },
          { type: 'dual_monitor',   x: 32.55, y: 20.3,  layer: 'fg', screen: true, screenCol: '#ff7096' }
        ]
      },

      // ===================== 7. CAFE & GAME LOUNGE (Combined!) =====================
      {
        deptId: 'lounge',
        roomId: 'lounge_cafe',
        label: '☕ คาเฟ่ & มุมเกม',
        desc: 'มุมชงกาแฟ ตู้ขนม โซฟาพักสายตา โต๊ะไพ่ โต๊ะปิงปอง และชั้นหนังสือ',
        rect: { x: 1, y: 14, w: 14, h: 10 },
        floor: 'wood',
        wallStyle: 'solid',
        signOffsetX: -36,
        doors: [
          { x: 7,  y: 14, openArch: true },
          { x: 8,  y: 14, openArch: true },
          { x: 14, y: 18, orient: 'vertical' },
          { x: 14, y: 19, orient: 'vertical' }
        ],
        seats: [],
        handoffSpot: { x: 7, y: 17 },
        idleSpots: [
          // Cafe left side
          { x: 3,  y: 17, dir: 'up',    kind: 'coffee' },
          { x: 4,  y: 17, dir: 'up',    kind: 'coffee' },
          { x: 5,  y: 17, dir: 'up',    kind: 'snack' },
          { x: 3,  y: 20, dir: 'down',  kind: 'sofa_nap' },
          { x: 5,  y: 19, dir: 'right', kind: 'cafe_chat_group' },
          { x: 6,  y: 19, dir: 'left',  kind: 'cafe_chat_group' },
          // Game corner right side — 4 seats around card table
          { x: 9,  y: 18, dir: 'right', kind: 'cards_group' },
          { x: 11, y: 18, dir: 'left',  kind: 'cards_group' },
          { x: 10, y: 17, dir: 'down',  kind: 'cards_group' },
          { x: 10, y: 19, dir: 'up',    kind: 'cards_group' },
          // 2 seats flanking pingpong table
          { x: 9,  y: 21, dir: 'right', kind: 'pingpong_group' },
          { x: 12, y: 21, dir: 'left',  kind: 'pingpong_group' },
          // Bookshelf reading spot
          { x: 9,  y: 16, dir: 'up',    kind: 'read_book' }
        ],
        furniture: [
          // Left cafe rugs & appliances
          { type: 'rug',             x: 2.05, y: 18.0,  layer: 'static', opts: { w: 68, h: 52, color: '#7a4b32' } },
          { type: 'coffee_machine',  x: 2.15, y: 15.15, layer: 'fg',     animatedProp: true },
          { type: 'vending_machine', x: 4.5,  y: 15.05, layer: 'static' },
          { type: 'sofa',            x: 2.25, y: 20.6,  layer: 'fg',     solid: [{ x: 2, y: 21 }, { x: 3, y: 21 }] },
          { type: 'plant',           x: 5.5,  y: 21.05, layer: 'static' },
          // Right game lounge rug & furniture
          { type: 'rug',            x: 8.4,  y: 16.5,  layer: 'static', opts: { w: 82, h: 72, color: '#4d416e' } },
          { type: 'bookshelf',      x: 9.2,  y: 15.05, layer: 'static' },
          { type: 'clock',          x: 11.4, y: 15.2,  layer: 'static' },
          { type: 'plant',          x: 12.6, y: 15.2,  layer: 'static' },
          { type: 'card_table',     x: 9.2,  y: 17.5,  layer: 'fg', cardTable: true, solid: [{ x: 10, y: 18 }] },
          { type: 'pingpong_table', x: 9.3,  y: 20.45, layer: 'fg', pingpong: true,  solid: [{ x: 10, y: 21 }, { x: 11, y: 21 }] }
        ]
      },

      // ===================== 8. GARDEN & OUTDOOR WELLNESS DECK =====================
      {
        deptId: 'lounge',
        roomId: 'lounge_garden',
        label: '🌳 สวน & ฟิตเนส',
        desc: 'สวนสีเขียว ทางเดินหิน ต้นไม้ ม้านั่ง และลานไม้ฟิตเนสลู่วิ่ง/ดัมเบล',
        rect: { x: 15, y: 14, w: 8, h: 10 },
        floor: 'grass',
        isOutdoor: true,
        wallStyle: 'fence',
        signOffsetX: 0,
        doors: [
          { x: 18, y: 14, openArch: true },
          { x: 19, y: 14, openArch: true },
          { x: 15, y: 18, orient: 'vertical', sharedHide: true },
          { x: 15, y: 19, orient: 'vertical', sharedHide: true },
          { x: 22, y: 19, orient: 'vertical' }
        ],
        seats: [],
        handoffSpot: { x: 18, y: 18 },
        idleSpots: [
          { x: 18, y: 16, dir: 'down',  kind: 'garden_bench' },
          { x: 17, y: 18, dir: 'right', kind: 'garden_stroll' },
          { x: 20, y: 18, dir: 'down',  kind: 'garden_stroll' },
          { x: 19, y: 19, dir: 'left',  kind: 'garden_stroll' },
          { x: 17, y: 21, dir: 'right', kind: 'treadmill' },
          { x: 20, y: 21, dir: 'down',  kind: 'dumbbell' }
        ],
        furniture: [
          { type: 'tree',      x: 15.85, y: 15.05, layer: 'fg',     solid: [{ x: 16, y: 16 }] },
          { type: 'tree',      x: 20.55, y: 15.1,  layer: 'fg',     solid: [{ x: 21, y: 16 }] },
          { type: 'bench',     x: 17.6,  y: 16.4,  layer: 'static' },
          { type: 'plant',     x: 20.9,  y: 18.1,  layer: 'static' },
          // Outdoor wooden fitness deck (y=20..22)
          { type: 'treadmill', x: 16.2,  y: 20.65, layer: 'fg',     treadmill: true },
          { type: 'dumbbell',  x: 19.4,  y: 20.85, layer: 'static' }
        ]
      }
    ]
  };

  // ---------------------------------------------------------------------------
  // 2. Agent Roster (11 Distinct Thai Agents with Clear Roles)
  // ---------------------------------------------------------------------------
  var AGENT_SPECS = [
    // AI Team (4) — open-plan ai_studio
    { id: 'ai_architect', name: 'น้องสถาปนิก',   role: 'คัดกรองและวางพิมพ์เขียว (ด่าน 1)',     deptId: 'ai',    homeRoom: 'ai_studio',    seatIdx: 0, look: { shirt: '#6d4bc4', accessory: 'glasses' } },
    { id: 'ai_worker_1',  name: 'น้องเดฟ 1',     role: 'เขียนโค้ดและสร้างฟีเจอร์หลัก (ด่าน 2)', deptId: 'ai',    homeRoom: 'ai_studio',    seatIdx: 1, look: { shirt: '#8b6ae6', accessory: 'headset' } },
    { id: 'ai_worker_2',  name: 'น้องเดฟ 2',     role: 'เขียนโค้ดและทดสอบระบบ (ด่าน 2)',       deptId: 'ai',    homeRoom: 'ai_studio',    seatIdx: 2, look: { shirt: '#5e3eb8', accessory: 'cap' } },
    { id: 'ai_review',    name: 'น้องรีวิว',     role: 'โค้ดรีวิวและตรวจสอบคุณภาพ (ด่าน 3)',   deptId: 'ai',    homeRoom: 'ai_studio',    seatIdx: 3, look: { shirt: '#4c3a9e', accessory: 'glasses' } },
    // Video Studio Wing (5) — vid_creative, vid_voice, vid_edit
    { id: 'vid_script',   name: 'น้องสคริปต์',   role: 'คิดบทวิดีโอและรายการข่าวเช้า',          deptId: 'video', homeRoom: 'vid_creative', seatIdx: 0, look: { shirt: '#d9667a', accessory: 'glasses' } },
    { id: 'vid_art',      name: 'น้องอาร์ต',     role: 'ออกแบบภาพและสตอรี่บอร์ด',              deptId: 'video', homeRoom: 'vid_creative', seatIdx: 1, look: { shirt: '#e57a8d', accessory: 'cap' } },
    { id: 'vid_tts',      name: 'น้องพากย์',     role: 'พากย์เสียงไทยและซิงค์คำบรรยาย',        deptId: 'video', homeRoom: 'vid_voice',    seatIdx: 0, look: { shirt: '#c85268', accessory: 'headset' } },
    { id: 'vid_edit',     name: 'น้องตัดต่อ',    role: 'เรนเดอร์ Remotion และมิกซ์เสียง',      deptId: 'video', homeRoom: 'vid_edit',     seatIdx: 0, look: { shirt: '#df6e82', accessory: 'headset' } },
    { id: 'vid_publish',  name: 'น้องโปรดิวเซอร์', role: 'ตรวจ QC ส่ง Telegram และเผยแพร่',    deptId: 'video', homeRoom: 'vid_edit',     seatIdx: 1, look: { shirt: '#b8485e', accessory: 'none' } },
    // Systems & Agent Hub (2) — ops_hub
    { id: 'hub_dispatch', name: 'น้องฮับ',       role: 'คุม Agent Hub และลูกข่าย GPU',         deptId: 'hub',   homeRoom: 'ops_hub',      seatIdx: 0, look: { shirt: '#3d6fb6', accessory: 'headset' } },
    { id: 'ops_sys',      name: 'น้องระบบ',      role: 'มอนิเตอร์ Docker/PM2 ไฟฟ้า PZEM & Cron', deptId: 'hub',   homeRoom: 'ops_hub',      seatIdx: 1, look: { shirt: '#3f8f6a', accessory: 'glasses' } }
  ];

  // ---------------------------------------------------------------------------
  // 3. Idle Activities (14 Rich Activities, Including Group Play & Balcony!)
  // ---------------------------------------------------------------------------
  var IDLE_ACTIVITIES = [
    { id: 'coffee',           label: 'ชงกาแฟหอมๆ',          roomId: 'lounge_cafe',   spotKind: 'coffee',           pose: 'drink', bubble: '☕', minSec: 8,  maxSec: 15, weight: 14 },
    { id: 'snack',            label: 'กดขนมตู้จำหน่าย',      roomId: 'lounge_cafe',   spotKind: 'snack',            pose: 'idle',  bubble: '🍪', minSec: 6,  maxSec: 11, weight: 8  },
    { id: 'sofa_nap',         label: 'งีบพักสายตาบนโซฟา',   roomId: 'lounge_cafe',   spotKind: 'sofa_nap',         pose: 'sleep', bubble: '💤', minSec: 10, maxSec: 18, weight: 8  },
    { id: 'cards_group',      label: 'เล่นไพ่กับเพื่อน',     roomId: 'lounge_cafe',   spotKind: 'cards_group',      pose: 'cards', bubble: '🃏', minSec: 11, maxSec: 20, weight: 14, group: true, maxGroup: 4 },
    { id: 'pingpong_group',   label: 'ตีปิงปองคลายเครียด',   roomId: 'lounge_cafe',   spotKind: 'pingpong_group',   pose: 'talk',  bubble: '🏓', minSec: 10, maxSec: 18, weight: 12, group: true, maxGroup: 2 },
    { id: 'cafe_chat_group',  label: 'จับกลุ่มเม้าท์มอย',    roomId: 'lounge_cafe',   spotKind: 'cafe_chat_group',  pose: 'talk',  bubble: '😄', minSec: 8,  maxSec: 15, weight: 10, group: true, maxGroup: 2 },
    { id: 'read_book',        label: 'อ่านหนังสือหาไอเดีย',  roomId: 'lounge_cafe',   spotKind: 'read_book',        pose: 'idle',  bubble: '📖', minSec: 8,  maxSec: 14, weight: 7  },
    { id: 'treadmill',        label: 'วิ่งลู่วิ่งกลางสวน',   roomId: 'lounge_garden', spotKind: 'treadmill',        pose: 'walk',  bubble: '🏃', minSec: 9,  maxSec: 16, weight: 10 },
    { id: 'dumbbell',         label: 'ยกดัมเบลออกกำลัง',    roomId: 'lounge_garden', spotKind: 'dumbbell',         pose: 'lift',  bubble: '💪', minSec: 8,  maxSec: 15, weight: 10 },
    { id: 'garden_bench',     label: 'นั่งชิลม้านั่งสวน',   roomId: 'lounge_garden', spotKind: 'garden_bench',     pose: 'sit',   bubble: '🌸', minSec: 9,  maxSec: 16, weight: 9  },
    { id: 'garden_stroll',    label: 'เดินเล่นรับลมในสวน',  roomId: 'lounge_garden', spotKind: 'garden_stroll',    pose: 'walk',  bubble: '🌿', minSec: 8,  maxSec: 14, weight: 10, wander: true },
    { id: 'balcony_chill',    label: 'ชมวิวรับลมที่ระเบียง', roomId: 'vid_balcony',   spotKind: 'balcony_chill',    pose: 'drink', bubble: '🌅', minSec: 9,  maxSec: 16, weight: 12, group: true, maxGroup: 3 },
    { id: 'water_chat_group', label: 'คุยเล่นหน้าตู้กดน้ำ',  roomId: 'ops_hub',       spotKind: 'water_chat_group', pose: 'talk',  bubble: '💬', minSec: 8,  maxSec: 14, weight: 11, group: true, maxGroup: 2 },
    { id: 'desk_chill',       label: 'พักฟังเพลงที่โต๊ะ',    roomId: null,            spotKind: 'home_seat',        pose: 'sit',   bubble: '🎵', minSec: 7,  maxSec: 13, weight: 7  }
  ];

  // Work bubble icons per department
  var WORK_BUBBLES = {
    ai:     ['💻', '🧠', '⚡', '🔍'],
    video:  ['📝', '🎨', '🎙️', '✂️', '🚀'],
    hub:    ['🖥️', '📡', '🛡️', '⚡'],
    lounge: ['☕', '😊', '👋']
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

    // 1) Corridors / Atrium / Plaza are walkable
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
      for (var d = 0; d < r.doors.length; d++) {
        var dr = r.doors[d];
        setWalk(dr.x, dr.y, 1);
      }
    }

    // 3) Solid furniture footprints (protecting doors, seats, handoffSpots & idleSpots)
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

  // Fast 4-directional A* on 40x25 grid
  function findPath(grid, sx, sy, gx, gy) {
    sx = clamp(sx | 0, 0, WORLD_W_TILES - 1);
    sy = clamp(sy | 0, 0, WORLD_H_TILES - 1);
    gx = clamp(gx | 0, 0, WORLD_W_TILES - 1);
    gy = clamp(gy | 0, 0, WORLD_H_TILES - 1);
    if (sx === gx && sy === gy) return [];

    var total = WORLD_W_TILES * WORLD_H_TILES;
    var startIdx = sy * WORLD_W_TILES + sx;
    var goalIdx = gy * WORLD_W_TILES + gx;

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
    while (heap.length > 0) {
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
  // 5. Video Job Stage Detection
  // ---------------------------------------------------------------------------
  var VIDEO_STAGE_AGENTS = ['vid_script', 'vid_art', 'vid_tts', 'vid_edit', 'vid_publish'];
  var VIDEO_STAGE_ROOMS  = ['vid_creative', 'vid_creative', 'vid_voice', 'vid_edit', 'vid_edit'];
  var VIDEO_STAGE_LABELS = ['สคริปต์', 'วาดภาพ', 'อัดเสียง', 'ตัดต่อ', 'เผยแพร่'];

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

    // Sky & exterior courtyard backdrop
    // NOTE: stops are pixel-anchored (not fractions) so adding the forecourt rows
    // below the campus does not stretch/shift the sky band.
    var grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    grad.addColorStop(0, pal.skyTop);
    grad.addColorStop(56 / WORLD_H, pal.skyBottom);
    grad.addColorStop(80 / WORLD_H, isLight ? '#5c8f4b' : '#12192b');
    grad.addColorStop(1, isLight ? '#4b7a3d' : '#0f1422');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Pixel clouds (light) or twinkling stars (dark) in sky strip y=0..30
    if (isLight) {
      var clouds = [
        [28, 6, 36], [135, 9, 44], [250, 5, 34], [435, 8, 42], [548, 6, 38]
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
      for (var s = 0; s < 32; s++) {
        var sx = ((s * 73 + 13) % (WORLD_W - 12)) + 6;
        var sy = ((s * 29 + 4) % 24) + 2;
        ctx.fillStyle = (s % 3 === 0) ? '#ffe89e' : '#b8d8ff';
        ctx.fillRect(sx, sy, (s % 5 === 0) ? 2 : 1, 1);
      }
    }

    // Distant skyline silhouettes on left & right shoulders (640px scale)
    var cityCol = isLight ? '#6e8db0' : '#15203b';
    var cityHi = isLight ? '#8aa8c9' : '#1f2e52';
    var winCol = isLight ? '#d8eeff' : '#ffd966';
    var skyline = [
      [8, 14, 16], [28, 8, 20], [52, 16, 15], [72, 11, 18], [94, 15, 16],
      [524, 12, 18], [546, 8, 22], [572, 14, 18], [594, 10, 20], [616, 15, 16]
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

    // Asymmetric Architectural Building Shell (indented C-cutout around vid_balcony!)
    // Main left campus + atrium + video studio top/bottom wings
    var shellPads = [
      // Left campus + Atrium (x=1..25, y=2..24)
      { x: TILE - 5, y: 2 * TILE - 6, w: 24 * TILE + 6, h: 22 * TILE + 8 },
      // Right Video Wing Upper (vid_creative, x=25..39, y=2..10)
      { x: 25 * TILE - 2, y: 2 * TILE - 4, w: 14 * TILE + 7, h: 8 * TILE + 6 },
      // Right Video Wing Mid-Left (vid_voice only, recessed around vid_balcony!)
      { x: 25 * TILE - 2, y: 10 * TILE, w: 8 * TILE + 4, h: 6 * TILE },
      // Right Video Wing Lower (vid_edit, x=25..39, y=16..24)
      { x: 25 * TILE - 2, y: 16 * TILE - 2, w: 14 * TILE + 7, h: 8 * TILE + 4 }
    ];

    // Draw dark outlines first, then shell fill so sections fuse cleanly into an L/C architectural footprint
    ctx.fillStyle = pal.outline;
    for (var p0 = 0; p0 < shellPads.length; p0++) {
      var sp0 = shellPads[p0];
      ctx.fillRect(sp0.x - 2, sp0.y - 2, sp0.w + 4, sp0.h + 4);
    }
    ctx.fillStyle = pal.buildingShell;
    for (var p1 = 0; p1 < shellPads.length; p1++) {
      var sp1 = shellPads[p1];
      ctx.fillRect(sp1.x, sp1.y, sp1.w, sp1.h);
    }

    // Stepped roof cornice trim (left wing slightly higher than right studio wing!)
    ctx.fillStyle = pal.buildingTrim;
    ctx.fillRect(TILE - 3, 2 * TILE - 5, 22 * TILE + 2, 3);
    ctx.fillRect(25 * TILE, 2 * TILE - 3, 14 * TILE + 3, 3);
    // Glass atrium skylight roof cap over ATRIUM_V (x=23..25)
    ctx.fillStyle = isLight ? '#9cd8fa' : '#4a8ec2';
    ctx.fillRect(23 * TILE, 2 * TILE - 6, 2 * TILE, 4);
    ctx.fillStyle = isLight ? '#ffffff' : '#a8e4ff';
    ctx.fillRect(23 * TILE + 3, 2 * TILE - 5, 2 * TILE - 6, 1);

    // Subtle open-air garden strip visible outside the recessed balcony on the far right edge
    Art.drawFloor(ctx, 39 * TILE + 1, 10 * TILE, TILE - 1, 6 * TILE, 'grass', { theme: themeName });

    // Company Roof Marquee Banner
    Art.drawRoomSign(ctx, WORLD_W / 2, 5, '🏢 HOMELAB STUDIO', isLight ? '#2b4a78' : '#25375e', {
      theme: themeName,
      fontSize: 10,
      padX: 12,
      h: 19
    });

    // Front outdoor sidewalk + lawn strip at y = 24 (384..400)
    var frontY = 24 * TILE;
    Art.drawFloor(ctx, 0, frontY, WORLD_W, TILE, 'tile', {
      theme: themeName,
      color: isLight ? '#d3cec4' : '#32384b',
      tileSize: 8
    });
    // Green planters / grass flanking the atrium front entrance (x = 23..24)
    Art.drawFloor(ctx, 0, frontY + 2, 22 * TILE, TILE - 2, 'grass', { theme: themeName });
    Art.drawFloor(ctx, 26 * TILE, frontY + 2, 14 * TILE, TILE - 2, 'grass', { theme: themeName });
    // Stone walkway & red carpet leading out from ATRIUM_V front glass doors (x = 23..24)
    ctx.fillStyle = pal.outline;
    ctx.fillRect(22 * TILE - 1, frontY, 4 * TILE + 2, TILE);
    ctx.fillStyle = isLight ? '#e4ded2' : '#4a526a';
    ctx.fillRect(22 * TILE, frontY, 4 * TILE, TILE);
    ctx.fillStyle = '#9c2d3a';
    ctx.fillRect(23 * TILE, frontY, 2 * TILE, TILE - 2);
    ctx.fillStyle = '#c94a58';
    ctx.fillRect(23 * TILE + 2, frontY, 2 * TILE - 4, TILE - 4);

    // Designed entrance forecourt — fills the 5 bottom tile rows (400..480)
    drawForecourt(ctx, Art, themeName, pal, isLight);
  }

  // ---------------------------------------------------------------------------
  // 6b. Entrance Forecourt (fountain plaza · lawns · driveway)
  // ---------------------------------------------------------------------------
  function fcEllipse(ctx, cx, cy, rx, ry, color) {
    ctx.fillStyle = color;
    for (var dy = -ry; dy <= ry; dy++) {
      var t = 1 - (dy * dy) / (ry * ry + 0.0001);
      if (t <= 0) continue;
      var hw = Math.round(rx * Math.sqrt(t));
      if (hw <= 0) continue;
      ctx.fillRect(Math.round(cx - hw), Math.round(cy + dy), hw * 2 + 1, 1);
    }
  }

  function fcLawnBed(ctx, Art, themeName, pal, isLight, x, y, w, h) {
    ctx.fillStyle = pal.outline;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    Art.drawFloor(ctx, x, y, w, h, 'grass', { theme: themeName });

    var hedgeCol = isLight ? '#3f8a3c' : '#1f5a30';
    var leafCol = isLight ? '#63b957' : '#2c7a3f';
    ctx.fillStyle = hedgeCol;
    ctx.fillRect(x - 2, y - 2, w + 4, 3);
    ctx.fillRect(x - 2, y + h - 1, w + 4, 3);
    ctx.fillRect(x - 2, y - 2, 3, h + 4);
    ctx.fillRect(x + w - 1, y - 2, 3, h + 4);
    ctx.fillStyle = leafCol;
    for (var lx = x; lx < x + w; lx += 5) {
      ctx.fillRect(lx, y - 2, 3, 1);
      ctx.fillRect(lx + 2, y + h + 1, 3, 1);
    }
    for (var ly = y; ly < y + h; ly += 5) {
      ctx.fillRect(x - 2, ly, 1, 3);
      ctx.fillRect(x + w + 1, ly, 1, 3);
    }
  }

  function fcFlowers(ctx, isLight, x, y, w, h, seed, count) {
    var cols = isLight
      ? ['#ff7aa8', '#ffd166', '#ffffff', '#c084fc', '#ff9f68']
      : ['#e8537f', '#ffc857', '#dfe9ff', '#a76bf0', '#ff8f52'];
    for (var i = 0; i < count; i++) {
      var fx = x + ((i * 37 + seed * 13) % (w - 4)) + 2;
      var fy = y + ((i * 23 + seed * 7) % (h - 4)) + 2;
      ctx.fillStyle = cols[(i + seed) % cols.length];
      ctx.fillRect(fx, fy, 2, 2);
      ctx.fillStyle = isLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
      ctx.fillRect(fx, fy, 1, 1);
    }
  }

  function fcParkLamp(ctx, isLight, pal, x, y) {
    // warm light pool on the paving
    if (isLight) {
      ctx.fillStyle = 'rgba(255, 233, 168, 0.30)';
      fcEllipse(ctx, x + 2, y + 24, 13, 5, 'rgba(255, 233, 168, 0.30)');
    } else {
      fcEllipse(ctx, x + 2, y + 24, 15, 6, 'rgba(255, 205, 110, 0.14)');
    }
    // cast-iron post
    ctx.fillStyle = pal.outline;
    ctx.fillRect(x, y + 3, 5, 21);
    ctx.fillStyle = isLight ? '#7c8494' : '#76829f';
    ctx.fillRect(x + 1, y + 4, 2, 19);
    ctx.fillStyle = isLight ? '#a8b0bd' : '#9aa6c4';
    ctx.fillRect(x + 1, y + 4, 1, 19);
    // lantern head
    ctx.fillStyle = pal.outline;
    ctx.fillRect(x - 2, y, 9, 7);
    ctx.fillStyle = isLight ? '#ffe9a8' : '#ffd777';
    ctx.fillRect(x - 1, y + 1, 7, 5);
    ctx.fillStyle = isLight ? '#fff8dd' : '#fff3c9';
    ctx.fillRect(x, y + 2, 5, 3);
    // base
    ctx.fillStyle = pal.outline;
    ctx.fillRect(x - 1, y + 23, 7, 2);
  }

  function fcFlag(ctx, isLight, pal, x, y, colA, colB) {
    ctx.fillStyle = pal.outline;
    ctx.fillRect(x, y + 2, 2, 22);
    ctx.fillStyle = isLight ? '#cfd6e2' : '#8e9ab8';
    ctx.fillRect(x, y + 2, 1, 22);
    // cloth
    ctx.fillStyle = pal.outline;
    ctx.fillRect(x + 2, y, 12, 9);
    ctx.fillStyle = colA;
    ctx.fillRect(x + 3, y + 1, 10, 7);
    ctx.fillStyle = colB;
    ctx.fillRect(x + 3, y + 1, 10, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 3, y + 1, 10, 1);
  }

  function drawForecourt(ctx, Art, themeName, pal, isLight) {
    var out = pal.outline;
    var top = CAMPUS_H;            // 400
    var driveTop = WORLD_H - 14;   // 466
    var bottom = WORLD_H;          // 480

    // ── 1. Stone plaza deck ───────────────────────────────────────────────
    Art.drawFloor(ctx, 0, top, WORLD_W, driveTop - top, 'tile', {
      theme: themeName,
      color: isLight ? '#ece6d9' : '#3b4360',
      tileSize: 16
    });
    // paving inlay bands (frame the plaza like a premium campus square)
    ctx.fillStyle = isLight ? '#d5cdbb' : '#333a52';
    ctx.fillRect(0, top + 1, WORLD_W, 2);
    ctx.fillRect(0, driveTop - 5, WORLD_W, 2);
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, top + 3, WORLD_W, 1);

    // ── 2. Entrance axis: carpet → steps → lit runner ─────────────────────
    var axL = 22 * TILE;   // 352
    var axW = 4 * TILE;    // 64
    ctx.fillStyle = out;
    ctx.fillRect(axL - 1, top, axW + 2, driveTop - top);
    ctx.fillStyle = isLight ? '#e2dbcb' : '#454e6b';
    ctx.fillRect(axL, top, axW, driveTop - top);
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(axL + 1, top, axW - 2, 1);

    // red carpet right outside the glass doors (continues the sidewalk carpet)
    ctx.fillStyle = '#9c2d3a';
    ctx.fillRect(axL + 8, top, axW - 16, 10);
    ctx.fillStyle = '#c94a58';
    ctx.fillRect(axL + 10, top + 1, axW - 20, 7);
    ctx.fillStyle = '#e07684';
    ctx.fillRect(axL + 10, top + 1, axW - 20, 1);

    // three stone steps
    var stepTones = isLight
      ? ['#f6f1e6', '#eae4d6', '#ddd6c6']
      : ['#5f6a8d', '#555f80', '#4b5473'];
    for (var st = 0; st < 3; st++) {
      var sy = top + 10 + st * 4;
      ctx.fillStyle = out;
      ctx.fillRect(axL - 2, sy, axW + 4, 1);
      ctx.fillStyle = stepTones[st];
      ctx.fillRect(axL - 2, sy + 1, axW + 4, 3);
    }

    // warm light wash down the middle of the runner
    ctx.fillStyle = isLight ? 'rgba(255, 247, 225, 0.55)' : 'rgba(255, 236, 190, 0.09)';
    ctx.fillRect(axL + 13, top + 24, axW - 26, driveTop - top - 26);
    ctx.fillStyle = isLight ? 'rgba(214, 205, 186, 0.9)' : 'rgba(70, 80, 108, 0.9)';
    ctx.fillRect(axL + 13, top + 24, 1, driveTop - top - 26);
    ctx.fillRect(axL + axW - 14, top + 24, 1, driveTop - top - 26);

    // ── 3. Left garden court: lawn bed + fountain ─────────────────────────
    fcLawnBed(ctx, Art, themeName, pal, isLight, 8, top + 6, 108, 54);
    fcFlowers(ctx, isLight, 14, top + 12, 96, 42, 3, 22);
    Art.drawFurniture(ctx, 'tree', 26, top + 16, { theme: themeName, frame: 0 });
    Art.drawFurniture(ctx, 'tree', 74, top + 20, { theme: themeName, frame: 0 });

    // fountain (stone basin + water + pedestal)
    var fcx = 176, fcy = 436, frx = 40, fry = 23;
    fcEllipse(ctx, fcx + 2, fcy + 4, frx + 2, fry + 1, 'rgba(0,0,0,0.20)');
    fcEllipse(ctx, fcx, fcy, frx, fry, out);
    fcEllipse(ctx, fcx, fcy - 1, frx - 2, fry - 2, isLight ? '#e3dccc' : '#4d5779');
    fcEllipse(ctx, fcx, fcy - 1, frx - 6, fry - 5, isLight ? '#cdc5b2' : '#3f4867');
    fcEllipse(ctx, fcx, fcy - 1, frx - 8, fry - 7, isLight ? '#57b6ea' : '#1d5b8f');
    fcEllipse(ctx, fcx, fcy - 2, frx - 12, fry - 9, isLight ? '#7fd0f7' : '#2b78ad');
    ctx.fillStyle = isLight ? 'rgba(255,255,255,0.8)' : 'rgba(190,235,255,0.5)';
    ctx.fillRect(fcx - 16, fcy - 2, 9, 1);
    ctx.fillRect(fcx + 7, fcy + 3, 10, 1);
    ctx.fillRect(fcx - 3, fcy + 7, 7, 1);
    // pedestal + top bowl
    ctx.fillStyle = out;
    ctx.fillRect(fcx - 8, fcy - 18, 16, 16);
    ctx.fillStyle = isLight ? '#efe9dc' : '#5d688a';
    ctx.fillRect(fcx - 7, fcy - 17, 14, 14);
    ctx.fillStyle = isLight ? '#d3cbb8' : '#4b5474';
    ctx.fillRect(fcx - 7, fcy - 8, 14, 4);
    ctx.fillStyle = out;
    ctx.fillRect(fcx - 11, fcy - 22, 22, 5);
    ctx.fillStyle = isLight ? '#f6f1e4' : '#6a7699';
    ctx.fillRect(fcx - 10, fcy - 21, 20, 3);
    ctx.fillStyle = isLight ? '#8fd8f8' : '#3f9ad0';
    ctx.fillRect(fcx - 8, fcy - 21, 16, 1);

    // benches facing the fountain
    Art.drawFurniture(ctx, 'bench', 230, 428, { theme: themeName });
    Art.drawFurniture(ctx, 'bench', 288, 428, { theme: themeName });
    // terracotta planters flanking the benches
    Art.drawFurniture(ctx, 'plant', 240, top + 6, { theme: themeName });
    Art.drawFurniture(ctx, 'plant', 298, top + 6, { theme: themeName });

    // ── 4. Right block: flags + wide lawn ─────────────────────────────────
    fcFlag(ctx, isLight, pal, 428, top + 12, '#3d6fb6', '#7fc4ff');
    fcFlag(ctx, isLight, pal, 452, top + 12, '#d9667a', '#ffb3c0');
    // low planter box under the flags
    ctx.fillStyle = out;
    ctx.fillRect(424, top + 40, 44, 12);
    ctx.fillStyle = isLight ? '#b5804f' : '#6d4a2c';
    ctx.fillRect(425, top + 41, 42, 10);
    ctx.fillStyle = isLight ? '#6dbb5b' : '#2f7a42';
    for (var pb = 0; pb < 9; pb++) {
      ctx.fillRect(427 + pb * 4, top + 40, 2, 3 + (pb % 3));
    }
    fcFlowers(ctx, isLight, 426, top + 38, 40, 8, 7, 8);

    fcLawnBed(ctx, Art, themeName, pal, isLight, 480, top + 6, 152, 54);
    fcFlowers(ctx, isLight, 486, top + 12, 140, 42, 5, 26);
    Art.drawFurniture(ctx, 'tree', 496, top + 18, { theme: themeName, frame: 0 });
    Art.drawFurniture(ctx, 'tree', 596, top + 16, { theme: themeName, frame: 0 });
    Art.drawFurniture(ctx, 'bench', 566, top + 38, { theme: themeName });

    // ── 5. Park lamps along the plaza edge ────────────────────────────────
    fcParkLamp(ctx, isLight, pal, 124, top + 4);
    fcParkLamp(ctx, isLight, pal, 326, top + 4);
    fcParkLamp(ctx, isLight, pal, 440, top + 2);
    fcParkLamp(ctx, isLight, pal, 622, top + 4);
    fcParkLamp(ctx, isLight, pal, 26, top + 62);

    // ── 6. Driveway at the bottom edge ────────────────────────────────────
    ctx.fillStyle = out;
    ctx.fillRect(0, driveTop, WORLD_W, 1);
    ctx.fillStyle = isLight ? '#cfc8b8' : '#4b5470';
    ctx.fillRect(0, driveTop + 1, WORLD_W, 3);
    ctx.fillStyle = isLight ? '#e6e0d2' : '#5b6580';
    ctx.fillRect(0, driveTop + 1, WORLD_W, 1);
    ctx.fillStyle = isLight ? '#555b66' : '#222839';
    ctx.fillRect(0, driveTop + 4, WORLD_W, bottom - driveTop - 4);

    // crosswalk on the entrance axis
    ctx.fillStyle = isLight ? '#f1efe8' : '#d6dbe8';
    for (var cw = 0; cw < 6; cw++) {
      ctx.fillRect(axL + 4 + cw * 10, driveTop + 6, 6, bottom - driveTop - 9);
    }
    // dashed lane marking
    for (var dl = 6; dl < WORLD_W - 8; dl += 26) {
      if (dl > axL - 16 && dl < axL + axW + 16) continue;
      ctx.fillStyle = isLight ? 'rgba(255,255,255,0.75)' : 'rgba(220,228,245,0.5)';
      ctx.fillRect(dl, driveTop + 8, 11, 2);
    }
  }

  function drawOpenArchJambs(ctx, xPx, yPx, wPx, hPx, isLight, outline) {
    var wood = isLight ? '#b07a4a' : '#7d5232';
    var hi = isLight ? '#d9a473' : '#a6744c';
    ctx.fillStyle = outline;
    ctx.fillRect(xPx, yPx, 4, hPx);
    ctx.fillRect(xPx + wPx - 4, yPx, 4, hPx);
    ctx.fillStyle = wood;
    ctx.fillRect(xPx + 1, yPx + 1, 2, hPx - 2);
    ctx.fillRect(xPx + wPx - 3, yPx + 1, 2, hPx - 2);
    ctx.fillStyle = hi;
    ctx.fillRect(xPx + 1, yPx + 1, 1, hPx - 2);
    ctx.fillRect(xPx + wPx - 3, yPx + 1, 1, hPx - 2);
    // Warm light threshold runner across open archway
    ctx.fillStyle = isLight ? 'rgba(255, 250, 232, 0.35)' : 'rgba(255, 238, 196, 0.12)';
    ctx.fillRect(xPx + 4, yPx + 2, wPx - 8, hPx - 4);
  }

  function renderStaticLayer(Art, themeName) {
    var off = document.createElement('canvas');
    off.width = WORLD_W;
    off.height = WORLD_H;
    var ctx = off.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    var pal = Art.getTheme(themeName);
    var isLight = themeName === 'light';

    // 1) Sky, skyline, stepped roof, C-shaped building shell, front entrance lawn
    drawSkyAndBuildingShell(ctx, Art, themeName);

    // 2) Open sunlit atrium & plaza floors (bright marble/ceramic tile, zero yellow arrows!)
    var plazaCol = isLight ? '#ece6da' : '#3d455e';
    for (var c = 0; c < LAYOUT.corridors.length; c++) {
      var cor = LAYOUT.corridors[c];
      Art.drawFloor(ctx, cor.x * TILE, cor.y * TILE, cor.w * TILE, cor.h * TILE, 'tile', {
        theme: themeName,
        color: plazaCol,
        tileSize: 16
      });
    }

    // Subtle sunlit architectural accents in Atrium & Plaza (rugs, soft inlay, greenery, water cooler)
    // Atrium light beam / welcome runner
    ctx.fillStyle = isLight ? 'rgba(255, 245, 215, 0.34)' : 'rgba(130, 185, 245, 0.08)';
    ctx.fillRect(23 * TILE + 5, 2 * TILE + 6, 2 * TILE - 10, 20 * TILE + 4);
    // Plaza decorative welcome rug & atrium entrance mat
    Art.drawFurniture(ctx, 'rug', 6.4 * TILE, 12.15 * TILE, {
      theme: themeName, w: 50, h: 26, color: isLight ? '#8a6b52' : '#4a5578'
    });
    Art.drawFurniture(ctx, 'rug', 15.6 * TILE, 11.05 * TILE, {
      theme: themeName, w: 46, h: 22, color: isLight ? '#5c7c8a' : '#345269'
    });
    Art.drawFurniture(ctx, 'rug', 23.08 * TILE, 21.6 * TILE, {
      theme: themeName, w: 30, h: 20, color: '#9c2d3a'
    });
    // Atrium top plants & plaza plants + PLAZA_NOOK water cooler
    Art.drawFurniture(ctx, 'plant', 23.05 * TILE, 2.1 * TILE, { theme: themeName });
    Art.drawFurniture(ctx, 'plant', 24.08 * TILE, 2.1 * TILE, { theme: themeName });
    Art.drawFurniture(ctx, 'plant', 1.25 * TILE,  12.15 * TILE, { theme: themeName });
    Art.drawFurniture(ctx, 'water_cooler', 15.15 * TILE, 10.6 * TILE, { theme: themeName });
    Art.drawFurniture(ctx, 'plant', 21.85 * TILE, 10.75 * TILE, { theme: themeName });

    // 3) Draw each of the 8 rooms: floor -> specialty overlays -> segmented walls -> static furniture -> signs
    for (var i = 0; i < LAYOUT.rooms.length; i++) {
      var r = LAYOUT.rooms[i];
      var rx = r.rect.x * TILE;
      var ry = r.rect.y * TILE;
      var rw = r.rect.w * TILE;
      var rh = r.rect.h * TILE;
      var wStyle = r.wallStyle || 'solid';

      // Interior floor
      Art.drawFloor(ctx, rx, ry, rw, rh, r.floor, {
        theme: themeName,
        color: r.floorColor || undefined
      });

      // Garden stone stepping footpath + outdoor wooden wellness deck (y=20..22)
      if (r.roomId === 'lounge_garden') {
        // Warm wooden fitness deck in lower section of garden
        Art.drawFloor(ctx, (r.rect.x + 1) * TILE, 20 * TILE + 2, (r.rect.w - 2) * TILE, 3 * TILE - 4, 'deck', {
          theme: themeName
        });
        // Crisp wooden deck border
        ctx.strokeStyle = pal.outline;
        ctx.lineWidth = 1;
        ctx.strokeRect((r.rect.x + 1) * TILE + 0.5, 20 * TILE + 2.5, (r.rect.w - 2) * TILE - 1, 3 * TILE - 5);

        // Stone stepping pathway linking top gate (18..19,14), left cafe (15,18..19), and right atrium (22,19)
        var stoneBase = isLight ? '#d8cfc0' : '#4a4f5e';
        var stoneHi = isLight ? '#ece5d8' : '#636a7d';
        ctx.fillStyle = stoneBase;
        ctx.fillRect(18 * TILE + 2, 15 * TILE, 2 * TILE - 4, 5 * TILE);
        ctx.fillRect(15 * TILE + 4, 18 * TILE + 2, 7 * TILE - 4, 2 * TILE - 4);
        ctx.fillStyle = stoneHi;
        for (var sy = 15 * TILE + 3; sy < 20 * TILE - 3; sy += 11) {
          ctx.fillRect(18 * TILE + 4, sy, 2 * TILE - 8, 7);
        }
        for (var sx = 16 * TILE + 2; sx < 22 * TILE - 4; sx += 12) {
          ctx.fillRect(sx, 18 * TILE + 4, 8, 2 * TILE - 8);
        }
      }

      // Build door lookup so ALL 4 perimeter walls skip doorways cleanly!
      var doorSet = {};
      for (var d = 0; d < r.doors.length; d++) {
        doorSet[r.doors[d].x + ',' + r.doors[d].y] = r.doors[d];
      }

      // Determine wall styles per side for architectural authenticity
      var wallColor = r.isOutdoor ? '#785a3d' : r.deptId;
      var topStyle = (wStyle === 'fence') ? 'fence' : 'solid';
      var leftStyle = (wStyle === 'fence') ? 'fence'
        : ((wStyle === 'glass' && r.rect.x === 25) ? 'glass' : 'solid');
      var rightStyle = (wStyle === 'fence') ? 'fence' : 'solid';
      var botStyle = wStyle; // 'solid' | 'glass' | 'fence'

      // --- TOP WALL (segmented around top doors) ---
      var topH = (topStyle === 'fence') ? 10 : TILE;
      var topY = (topStyle === 'fence') ? (ry + 4) : ry;
      var tx = r.rect.x;
      while (tx < r.rect.x + r.rect.w) {
        if (doorSet[tx + ',' + r.rect.y]) {
          tx++;
          continue;
        }
        var segStart = tx;
        while (tx < r.rect.x + r.rect.w && !doorSet[tx + ',' + r.rect.y]) tx++;
        Art.drawWall(ctx, segStart * TILE, topY, (tx - segStart) * TILE, topH, wallColor, {
          theme: themeName,
          style: topStyle
        });
      }

      // --- LEFT WALL (segmented around vertical doors) ---
      var leftWallX = rx;
      var ly = r.rect.y + 1;
      while (ly < r.rect.y + r.rect.h - 1) {
        if (doorSet[r.rect.x + ',' + ly]) {
          ly++;
          continue;
        }
        var lStart = ly;
        while (ly < r.rect.y + r.rect.h - 1 && !doorSet[r.rect.x + ',' + ly]) ly++;
        Art.drawWall(ctx, leftWallX, lStart * TILE, 5, (ly - lStart) * TILE, wallColor, {
          theme: themeName,
          style: leftStyle,
          shadow: false
        });
      }

      // --- RIGHT WALL (SEGMENTED around vertical doors — fixed from v1!) ---
      var rightWallX = rx + rw - 5;
      var rwy = r.rect.y + 1;
      while (rwy < r.rect.y + r.rect.h - 1) {
        if (doorSet[(r.rect.x + r.rect.w - 1) + ',' + rwy]) {
          rwy++;
          continue;
        }
        var rwStart = rwy;
        while (rwy < r.rect.y + r.rect.h - 1 && !doorSet[(r.rect.x + r.rect.w - 1) + ',' + rwy]) rwy++;
        Art.drawWall(ctx, rightWallX, rwStart * TILE, 5, (rwy - rwStart) * TILE, wallColor, {
          theme: themeName,
          style: rightStyle,
          shadow: false
        });
      }

      // --- BOTTOM WALL (lower 10px parapet/glass/fence, segmented around bottom doors) ---
      var botH = (botStyle === 'glass') ? 11 : 10;
      var botY = ry + rh - botH;
      var bx = r.rect.x;
      while (bx < r.rect.x + r.rect.w) {
        if (doorSet[bx + ',' + (r.rect.y + r.rect.h - 1)]) {
          bx++;
          continue;
        }
        var bStart = bx;
        while (bx < r.rect.x + r.rect.w && !doorSet[bx + ',' + (r.rect.y + r.rect.h - 1)]) bx++;
        Art.drawWall(ctx, bStart * TILE, botY, (bx - bStart) * TILE, botH, wallColor, {
          theme: themeName,
          style: botStyle
        });
      }

      // Draw wide open archway jambs for paired openArch doors (ai_studio & lounge_cafe)
      for (var da = 0; da < r.doors.length; da++) {
        var ad = r.doors[da];
        if (!ad.openArch) continue;
        // Pair horizontally adjacent openArch doors once
        var nextDoor = doorSet[(ad.x + 1) + ',' + ad.y];
        if (nextDoor && nextDoor.openArch) {
          var isTopArch = (ad.y === r.rect.y);
          drawOpenArchJambs(
            ctx,
            ad.x * TILE,
            isTopArch ? ry : botY,
            TILE * 2,
            isTopArch ? TILE : botH,
            isLight,
            pal.outline
          );
        }
      }

      // Static furniture inside room
      for (var fi = 0; fi < r.furniture.length; fi++) {
        var item = r.furniture[fi];
        if (item.layer !== 'static') continue;
        var fOpts = Object.assign({ theme: themeName, on: true, glow: false, frame: 0 }, item.opts || {});
        Art.drawFurniture(ctx, item.type, item.x * TILE, item.y * TILE, fOpts);
      }

      // Room Sign Plaque (using signOffsetX to avoid top doors, fontSize: 10, h: 17!)
      Art.drawRoomSign(ctx, rx + rw / 2 + (r.signOffsetX || 0), ry + 1, r.label, r.deptId, {
        theme: themeName,
        fontSize: 10,
        padX: 6,
        h: 17
      });
    }

    // 4) Atrium Front Glass Double Entrance Doors (x = 23..24, y = 23)
    var entY = 23 * TILE + 2;
    Art.drawDoor(ctx, 23 * TILE, entY, false, {
      theme: themeName, w: TILE, h: 14, color: '#3a6289', frameColor: '#2a3448'
    });
    Art.drawDoor(ctx, 24 * TILE, entY, false, {
      theme: themeName, w: TILE, h: 14, color: '#3a6289', frameColor: '#2a3448'
    });

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

    // Offscreen static world cache
    var staticCanvas = renderStaticLayer(Art, themeName);

    // World structures
    var roomById = buildRoomMap();
    var walkableGrid = buildWalkableGrid();

    // Collect foreground props, animated props & doors for fast dynamic pass
    var fgFurniture = [];
    var rackFurniture = [];
    var allDoors = [];
    for (var ri = 0; ri < LAYOUT.rooms.length; ri++) {
      var rm = LAYOUT.rooms[ri];
      for (var di = 0; di < rm.doors.length; di++) {
        var dSpec = rm.doors[di];
        allDoors.push({
          roomId: rm.roomId,
          deptId: rm.deptId,
          x: dSpec.x,
          y: dSpec.y,
          orient: dSpec.orient || 'horizontal',
          openArch: Boolean(dSpec.openArch),
          sharedHide: Boolean(dSpec.sharedHide),
          isGlass: rm.wallStyle === 'glass',
          isFence: rm.wallStyle === 'fence',
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
          rack: Boolean(fItem.rack),
          pingpong: Boolean(fItem.pingpong),
          cardTable: Boolean(fItem.cardTable),
          treadmill: Boolean(fItem.treadmill),
          studioProp: Boolean(fItem.studioProp),
          animatedProp: Boolean(fItem.animatedProp)
        };
        if (fItem.layer === 'fg') fgFurniture.push(entry);
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
        statusText: 'พักผ่อน/พร้อม',
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

    // Initialize 11 agents at their home seats
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
        // Pathfinding (tuned for 40x25 world)
        path: [],
        pathIdx: 0,
        speed: 48,
        // Handoff state
        handoffTargetRoom: null,
        handoffTargetAgentId: null,
        handoffLabel: '',
        handoffColor: '#f2c14e',
        handoffPause: 0,
        // Idle activity state
        activity: null,
        activityTimer: randRange(1.5, 6.0),
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
    var demoAiTimer = 3.0;

    // -----------------------------------------------------------------------
    // Helper: Room & Agent hit-testing (tuned for 14x22 sprites on 640x400)
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
      var bestDist = 18;
      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];
        var dx = wx - a.px;
        var dy = wy - (a.py - 11);
        var d = Math.hypot(dx, dy);
        if (d < bestDist) {
          bestDist = d;
          best = a;
        }
      }
      return best;
    }

    // Find a walkable delivery tile directly beside a target agent's seat (for intra-room handoffs!)
    function findAdjacentWalkableTile(tx, ty) {
      var candidates = [
        { x: tx - 1, y: ty },
        { x: tx + 1, y: ty },
        { x: tx,     y: ty - 1 },
        { x: tx,     y: ty + 1 },
        { x: tx - 1, y: ty - 1 },
        { x: tx + 1, y: ty - 1 }
      ];
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.x >= 0 && c.x < WORLD_W_TILES && c.y >= 0 && c.y < WORLD_H_TILES &&
            walkableGrid[c.y * WORLD_W_TILES + c.x]) {
          return c;
        }
      }
      return { x: tx, y: ty };
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
        agent.speed = speed || 50;
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
      agent.workBubble = bubble || (WORK_BUBBLES[agent.deptId] && WORK_BUBBLES[agent.deptId][0]) || '💻';
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
        setAgentDestination(agent, agent.seat.x, agent.seat.y, 74);
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

    // Supports target as: agentId (intra-room or cross-room!), roomId, or { x, y, roomId }
    function triggerHandoff(fromAgentId, target, label, folderColor) {
      var agent = agentById[fromAgentId];
      if (!agent || !target) return;
      if (agent.state === 'handoff') return;

      var destSpot = null;
      var destRoomId = null;
      var targetAgentId = null;
      var defaultLabel = 'ส่งต่องาน';

      if (typeof target === 'string') {
        if (agentById[target]) {
          var tAg = agentById[target];
          targetAgentId = tAg.id;
          destRoomId = tAg.homeRoom;
          destSpot = findAdjacentWalkableTile(tAg.seat.x, tAg.seat.y);
          defaultLabel = 'ส่งงานให้ ' + tAg.name;
        } else if (roomById[target]) {
          var destRm = roomById[target];
          destRoomId = destRm.roomId;
          destSpot = destRm.handoffSpot || destRm.doors[0] || { x: destRm.rect.x + 3, y: destRm.rect.y + 4 };
          defaultLabel = 'ส่งงานไป ' + destRm.label;
        }
      } else if (typeof target === 'object' && target.x != null && target.y != null) {
        destSpot = { x: target.x | 0, y: target.y | 0 };
        destRoomId = target.roomId || null;
      }

      if (!destSpot) return;

      releaseSpot(agent);
      agent.activity = null;
      agent.state = 'handoff';
      agent.handoffTargetRoom = destRoomId;
      agent.handoffTargetAgentId = targetAgentId;
      agent.handoffLabel = label || defaultLabel;
      agent.handoffColor = folderColor || '#f2c14e';
      agent.handoffPause = 0;
      agent.pose = 'carry';
      agent.bubble = '📦';

      setAgentDestination(agent, destSpot.x, destSpot.y, 70);
    }

    function pickIdleActivity(agent) {
      releaseSpot(agent);

      // Encourage lively group play (cards / pingpong / cafe chat / balcony / water cooler)
      if (Math.random() < 0.50) {
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
      var attempts = 7;
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
          agent.targetDir = agent.seat.dir || 'down';
          setAgentDestination(agent, agent.seat.x, agent.seat.y, 48);
          agent.bubble = '';
          return;
        }

        var targetRoom = roomById[chosen.roomId];
        if (!targetRoom) continue;
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

      // Fallback: chill at home desk
      agent.activity = IDLE_ACTIVITIES[IDLE_ACTIVITIES.length - 1];
      agent.activityTimer = randRange(6, 11);
      agent.targetDir = agent.seat.dir || 'down';
      setAgentDestination(agent, agent.seat.x, agent.seat.y, 46);
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
      setAgentDestination(agent, spot.x, spot.y, randRange(42, 54));
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

      for (var rKey in roomState) {
        if (!Object.prototype.hasOwnProperty.call(roomState, rKey)) continue;
        roomState[rKey].active = false;
        roomState[rKey].alert = false;
        roomState[rKey].statusText = 'พักผ่อน/พร้อม';
        roomState[rKey].detail = roomById[rKey].desc;
      }

      var workAssign = {}; // agentId -> { detail, bubble }
      var assign = function (agId, detail, bubble, customStatus) {
        workAssign[agId] = { detail: detail, bubble: bubble };
        var ag = agentById[agId];
        if (ag && roomState[ag.homeRoom]) {
          roomState[ag.homeRoom].active = true;
          roomState[ag.homeRoom].statusText = customStatus || '⚡ กำลังทำงาน';
          if (detail) roomState[ag.homeRoom].detail = detail;
        }
      };

      // ---- 1) AI Chat Mapping (Stage 1: Architect -> Stage 2: Devs 1+2 -> Stage 3: Review) ----
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
          assign('ai_review', 'ด่าน 3 รีวิว: ' + chatTitle, '🔍');
        } else if (/(ด่าน\s*2|worker|เวิร์กเกอร์|เดฟ|build|code|เขียน|implement)/.test(stepRaw)) {
          curAiStage = 2;
          assign('ai_worker_1', 'ด่าน 2 โค้ด: ' + chatTitle, '💻');
          assign('ai_worker_2', 'ด่าน 2 ทดสอบ: ' + chatTitle, '⚡');
        } else if (/(ด่าน\s*1|architect|สถาปนิก|plan|วางแผน|blueprint)/.test(stepRaw)) {
          curAiStage = 1;
          assign('ai_architect', 'ด่าน 1 พิมพ์เขียว: ' + chatTitle, '📐');
        } else {
          curAiStage = 1;
          assign('ai_architect', 'รับงาน/วิเคราะห์: ' + chatTitle, '🤖');
          assign('ai_worker_1', 'ประมวลผล: ' + chatTitle, '💻');
          if (aiRunningCount >= 2) assign('ai_worker_2', 'แชทซ้อน #' + aiRunningCount, '⚡');
        }

        // Intra-room handoff inside ai_studio between architect -> worker_1 -> review!
        if (prevAiStage >= 0 && curAiStage > prevAiStage) {
          if (curAiStage === 2) {
            triggerHandoff('ai_architect', 'ai_worker_1', 'ส่งพิมพ์เขียว → น้องเดฟ 1', '#9b7eff');
          } else if (curAiStage === 3) {
            triggerHandoff('ai_worker_1', 'ai_review', 'ส่งงานตรวจ QA → น้องรีวิว', '#9b7eff');
          }
        }
      }
      prevAiStage = curAiStage;

      // ---- 2) Video Studio 5-Stage Pipeline Mapping ----
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

        if (prevVideoStage >= 0 && curVidStage > prevVideoStage) {
          var nextTargetAg = VIDEO_STAGE_AGENTS[curVidStage];
          triggerHandoff(
            VIDEO_STAGE_AGENTS[prevVideoStage],
            nextTargetAg,
            'ส่งต่อคลิป → ' + agentById[nextTargetAg].name,
            '#ff8fa3'
          );
        }
      } else if (ovVidActive > 0) {
        curVidStage = 3;
        assign('vid_edit', 'กำลังเรนเดอร์วิดีโอ (' + ovVidActive + ' งาน)', '✂️');
      }

      if (socialActive) {
        assign('vid_publish', 'กำลังอัปโหลด/โพสต์โซเชียล', '🚀');
      } else if (qcPending > 0 && !workAssign.vid_edit && !workAssign.vid_publish) {
        roomState.vid_edit.statusText = 'รอตรวจ QC (' + qcPending + ')';
        roomState.vid_edit.detail = 'มีคลิปเสร็จรอตรวจ QC ' + qcPending + ' รายการ';
      }
      prevVideoStage = curVidStage;

      // ---- 3) Cron Mapping (News/Video Cron -> Video Wing; System Cron -> ops_sys in ops_hub) ----
      var nowMs = Date.now();
      var activeCrons = [];
      for (var ci = 0; ci < crons.length; ci++) {
        var cj = crons[ci];
        if (!cj) continue;
        var isRunningCron = Boolean(cj.running) || String(cj.status || '').toLowerCase() === 'running';
        var ms = cj.lastRunAt ? Number(cj.lastRunAt) : NaN;
        var recentCron = isFinite(ms) && (nowMs - ms) >= 0 && (nowMs - ms) < 180000;
        if (isRunningCron || recentCron) {
          activeCrons.push(cj);
        }
      }
      var cronNewsNow = false;
      if (activeCrons.length > 0) {
        for (var ac = 0; ac < activeCrons.length; ac++) {
          var cName = String(activeCrons[ac].name || activeCrons[ac].id || 'Cron Job');
          if (/(news|ข่าว|broadcast|daily-news|video|คลิป)/i.test(cName)) {
            cronNewsNow = true;
            var newsTarget = /(render|edit|ตัดต่อ|mix)/i.test(cName) ? 'vid_edit' : 'vid_script';
            assign(newsTarget, '📰 ข่าวเช้า: ' + truncateText(cName, 22), '📰', '📰 ข่าวเช้า');
          } else {
            assign('ops_sys', '⏰ Cron ระบบ: ' + truncateText(cName, 22), '⏰');
          }
        }
        if (cronNewsNow && !prevCronNewsActive) {
          triggerHandoff('ops_sys', 'vid_script', 'ทริกเกอร์ข่าวเช้า → สตูดิโอวิดีโอ', '#f2c94c');
        }
      }
      prevCronNewsActive = cronNewsNow;

      // ---- 4) Agent Hub & Worker Nodes Mapping (hub_dispatch in ops_hub) ----
      var agHub = (ov.agents && typeof ov.agents === 'object') ? ov.agents : {};
      var hubActiveCount = Number(agHub.activeJobCount || 0);
      var hubActiveJobs = Array.isArray(agHub.activeJobs) ? agHub.activeJobs : [];
      var hubNodes = Array.isArray(agHub.nodes) ? agHub.nodes : [];
      var onlineNodes = Number(agHub.onlineNodes != null ? agHub.onlineNodes : hubNodes.filter(function (n) { return n && n.online; }).length);
      var totalNodes = Number(agHub.totalNodes != null ? agHub.totalNodes : hubNodes.length);

      hubOfflineAlert = (totalNodes > 0 && onlineNodes === 0);
      var opsDetails = [];
      if (hubOfflineAlert) {
        roomState.ops_hub.alert = true;
        roomState.ops_hub.statusText = '⚠️ ลูกข่ายออฟไลน์';
        opsDetails.push('ลูกข่ายออฟไลน์ (0/' + totalNodes + ')');
      } else if (totalNodes > 0) {
        opsDetails.push('โหนด ' + onlineNodes + '/' + totalNodes + ' ออนไลน์');
      }

      var hubBusy = (hubActiveCount > 0 || hubActiveJobs.length > 0);
      if (hubBusy) {
        var hJobName = truncateText((hubActiveJobs[0] && (hubActiveJobs[0].name || hubActiveJobs[0].kind)) || ('งาน Offload ' + hubActiveCount + ' รายการ'), 24);
        assign('hub_dispatch', 'Offload โหนด: ' + hJobName, '📡');
        if (!prevHubActive) {
          var sender = workAssign.ai_worker_1 ? 'ai_worker_1' : (workAssign.vid_edit ? 'vid_edit' : 'ops_sys');
          triggerHandoff(sender, 'hub_dispatch', 'โยนงานหนักไปลูกข่าย GPU', '#52b4ff');
        }
      }
      prevHubActive = hubBusy;

      // ---- 5) Infra & PZEM-01 Energy Mapping (ops_sys in ops_hub) ----
      var infra = (ov.infra && typeof ov.infra === 'object') ? ov.infra : {};
      var problems = Array.isArray(infra.problems) ? infra.problems : [];
      var downCount = Number((ov.attention && ov.attention.servicesDown) || problems.length || 0);
      opsAlert = (problems.length > 0 || downCount > 0);

      if (opsAlert) {
        var probText = problems[0]
          ? truncateText(typeof problems[0] === 'string' ? problems[0] : (problems[0].name || problems[0].message || 'เซอร์วิสขัดข้อง'), 24)
          : ('พบปัญหา ' + downCount + ' รายการ');
        roomState.ops_hub.alert = true;
        assign('ops_sys', 'ตรวจแก้: ' + probText, '🚨', '🚨 แจ้งเตือน!');
      } else {
        opsDetails.push('เซอร์วิสปกติ');
      }

      var energy = infra.energy && typeof infra.energy === 'object' ? infra.energy : null;
      if (energy) {
        var watts = Number(energy.watts != null ? energy.watts : (energy.power != null ? energy.power : NaN));
        var kwh = Number(energy.todayKwh != null ? energy.todayKwh : NaN);
        var eParts = [];
        if (isFinite(watts)) eParts.push(Math.round(watts) + 'W');
        if (isFinite(kwh)) eParts.push(kwh.toFixed(2) + ' kWh');
        if (eParts.length > 0) {
          opsDetails.push('ไฟ ' + eParts.join(' / '));
        }
        if (isFinite(watts) && watts >= 900 && !workAssign.ops_sys) {
          assign('ops_sys', 'โหลดไฟสูง ' + Math.round(watts) + 'W', '⚡');
        }
      }

      if (!workAssign.hub_dispatch && !workAssign.ops_sys && opsDetails.length > 0) {
        roomState.ops_hub.detail = opsDetails.join(' · ');
      }

      var activeKeys = Object.keys(workAssign);
      hasLiveWork = activeKeys.length > 0;

      if (hasLiveWork) {
        var hl = [];
        if (curAiStage >= 0) hl.push('🤖 AI (' + Math.max(1, aiRunningCount) + ')');
        if (curVidStage >= 0 || socialActive) hl.push('🎬 วิดีโอ (' + VIDEO_STAGE_LABELS[Math.max(0, curVidStage)] + ')');
        if (cronNewsNow) hl.push('📰 ข่าวเช้า');
        if (hubBusy) hl.push('🖥️ Hub (' + Math.max(1, hubActiveCount) + ')');
        if (opsAlert) hl.push('🚨 ระบบแจ้งเตือน');
        if (hl.length === 0 && activeCrons.length > 0) hl.push('⏰ Cron (' + activeCrons.length + ')');
        if (hl.length === 0 && workAssign.ops_sys) hl.push('⚡ โหลดไฟสูง');
        liveHeadline = '⚡ กำลังทำงานจริง · ' + hl.join(' · ');
      } else {
        liveHeadline = '';
      }

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
    // Demo Mode Choreographer (3-4 working & handing off, 7-8 chilling/playing!)
    // -----------------------------------------------------------------------
    function stepDemoSimulation(dt) {
      if (!demoMode) return;
      demoClock += dt;
      demoStageTimer += dt;
      demoAiTimer += dt;

      // Cycle Video Pipeline every 6.5s with intra-room & cross-room handoffs!
      if (demoStageTimer >= 6.5) {
        demoStageTimer = 0;
        var prevV = demoVideoStage;
        demoVideoStage = (demoVideoStage + 1) % VIDEO_STAGE_AGENTS.length;
        if (demoVideoStage > prevV) {
          var toAgV = VIDEO_STAGE_AGENTS[demoVideoStage];
          triggerHandoff(
            VIDEO_STAGE_AGENTS[prevV],
            toAgV,
            'ส่งต่อคลิปข่าวเช้า → ' + agentById[toAgV].name,
            '#ff8fa3'
          );
        }
      }

      // Cycle AI Pipeline inside ai_studio every 7.2s (intra-room + cross-room to ops_hub!)
      if (demoAiTimer >= 7.2) {
        demoAiTimer = 0;
        var prevA = demoAiStage;
        demoAiStage = (demoAiStage + 1) % 3; // 0=architect, 1=devs, 2=review
        if (prevA === 0 && demoAiStage === 1) {
          triggerHandoff('ai_architect', 'ai_worker_1', 'ส่งพิมพ์เขียว → น้องเดฟ 1', '#9b7eff');
        } else if (prevA === 1 && demoAiStage === 2) {
          triggerHandoff('ai_worker_1', 'ai_review', 'ส่งโค้ดรีวิว → น้องรีวิว', '#9b7eff');
        } else if (prevA === 2 && demoAiStage === 0) {
          triggerHandoff('ai_review', 'hub_dispatch', 'โยนงานทดสอบไปลูกข่าย GPU', '#52b4ff');
        }
      }

      // Assign 3-4 active workers so 7-8 agents actively chill/play cards/pingpong/balcony/garden!
      var demoWork = {};
      var vBubbles = ['📝', '🎨', '🎙️', '✂️', '🚀'];
      var vDetails = [
        '📰 เขียนสคริปต์ข่าวเช้า v2',
        'วาดสตอรี่บอร์ดและภาพประกอบ',
        'พากย์เสียงไทย + ซิงค์ซับ',
        'เรนเดอร์ Remotion + มิกซ์ BGM',
        'ตรวจ QC และส่ง Telegram'
      ];
      demoWork[VIDEO_STAGE_AGENTS[demoVideoStage]] = { detail: vDetails[demoVideoStage], bubble: vBubbles[demoVideoStage] };

      if (demoAiStage === 0) {
        demoWork.ai_architect = { detail: 'ด่าน 1 · วางพิมพ์เขียวระบบ', bubble: '📐' };
      } else if (demoAiStage === 1) {
        demoWork.ai_worker_1 = { detail: 'ด่าน 2 · เขียนฟีเจอร์หลัก', bubble: '💻' };
        demoWork.ai_worker_2 = { detail: 'ด่าน 2 · ทำ Unit Test', bubble: '⚡' };
      } else {
        demoWork.ai_review = { detail: 'ด่าน 3 · โค้ดรีวิวและ QA', bubble: '🔍' };
      }

      // Alternate Hub vs Ops System worker (1 active in ops_hub)
      var bgPhase = Math.floor(demoClock / 9) % 2;
      if (bgPhase === 0) {
        demoWork.hub_dispatch = { detail: 'โยนงานเรนเดอร์ไป asridaytrade', bubble: '📡' };
      } else {
        demoWork.ops_sys = { detail: 'ตรวจ Docker/PM2 · PZEM 342W', bubble: '🛡️' };
      }

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
      for (var d = 0; d < allDoors.length; d++) {
        if (allDoors[d].openTimer > 0) allDoors[d].openTimer = Math.max(0, allDoors[d].openTimer - dt);
      }
      for (var rk in roomState) {
        if (roomState[rk].pulse > 0) roomState[rk].pulse = Math.max(0, roomState[rk].pulse - dt * 1.4);
      }

      for (var i = 0; i < agents.length; i++) {
        var a = agents[i];

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
              a.handoffPause = 1.15;
              a.pose = 'talk';
              // Face target agent if intra-room or targeted delivery
              if (a.handoffTargetAgentId && agentById[a.handoffTargetAgentId]) {
                var tAg = agentById[a.handoffTargetAgentId];
                var dtx = tAg.px - a.px;
                var dty = tAg.py - a.py;
                a.dir = Math.abs(dtx) >= Math.abs(dty) ? (dtx >= 0 ? 'right' : 'left') : (dty >= 0 ? 'down' : 'up');
              } else {
                a.dir = 'down';
              }
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
          if (a.state === 'working') {
            a.pose = 'type';
            a.dir = a.seat.dir || 'down';
            if (((animTick + a.frameOffset) % 90) === 0) {
              var bList = WORK_BUBBLES[a.deptId] || ['💻'];
              a.bubble = a.workBubble || bList[((animTick / 90 + i) | 0) % bList.length];
            }
          } else if (a.state === 'handoff' && a.subState === 'delivering') {
            a.handoffPause -= dt;
            if (a.handoffPause <= 0) {
              a.handoffTargetRoom = null;
              a.handoffTargetAgentId = null;
              if (a.assignedWork) {
                a.state = 'returning';
                a.bubble = '⚡';
                setAgentDestination(a, a.seat.x, a.seat.y, 72);
              } else {
                a.state = 'idle';
                a.subState = 'at_spot';
                a.activityTimer = 0.4;
              }
            }
          } else if (a.state === 'idle') {
            a.activityTimer -= dt;
            if (a.activity && a.activity.wander && a.activityTimer > 2 && Math.random() < dt * 0.25) {
              var gRm = roomById.lounge_garden;
              if (gRm && gRm.idleSpots.length > 0) {
                var strolls = gRm.idleSpots.filter(function (s) { return s.kind === 'garden_stroll'; });
                var gs = strolls.length > 0 ? strolls[(Math.random() * strolls.length) | 0] : gRm.idleSpots[0];
                setAgentDestination(a, gs.x, gs.y, 38);
              }
            }
            if (a.activityTimer <= 0) {
              pickIdleActivity(a);
            }
          } else if (a.state === 'returning') {
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

        var curRm = getRoomAtPixel(a.px, a.py);
        a.currentRoomId = curRm ? curRm.roomId : null;
      }
    }

    // -----------------------------------------------------------------------
    // Camera Smooth Interpolation & Focus Helpers (with alias mapping!)
    // -----------------------------------------------------------------------
    function focusRect(minX, minY, maxX, maxY, padTiles) {
      var pad = (padTiles != null ? padTiles : 1.2) * TILE;
      var bw = Math.max(96, (maxX - minX) + pad * 2);
      var bh = Math.max(64, (maxY - minY) + pad * 2);
      var zx = WORLD_W / bw;
      var zy = WORLD_H / bh;
      var z = clamp(Math.min(zx, zy), 1.0, 2.45);
      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;

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
      var raw = String(deptId || 'all');
      var id = DEPT_ALIASES[raw] || raw;
      cam.focusedRoomId = null;

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
        focusRect(minX, minY, maxX, maxY, 1.4);
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
        1.2
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
        lines.push('ตำแหน่ง: ' + (curRmObj ? curRmObj.label : 'โถงกลางออฟฟิศ'));
      } else if (hoverRoom) {
        var rs = roomState[hoverRoom.roomId];
        var deptMeta = DEPTS[hoverRoom.deptId];
        lines.push(hoverRoom.label + (deptMeta ? ' (' + deptMeta.label.replace(/^[^\s]+\s/, '') + ')' : ''));
        lines.push((rs && rs.statusText ? rs.statusText + ' · ' : '') + (rs ? rs.detail : hoverRoom.desc));
        lines.push('คลิกเพื่อซูมดูโซนนี้');
      }

      tooltipEl.textContent = lines.join('\n');
      tooltipEl.style.whiteSpace = 'pre-line';
      tooltipEl.hidden = false;

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
    // Cover-with-clamp: fill the viewport edge-to-edge (no letterbox band) but never
    // crop more than 6% of the world, so rooms, signs and the forecourt stay visible.
    // Campus safety bounds (world px): rooms must always stay inside the frame.
    var CAMPUS_TOP_SAFE = 20;
    var CAMPUS_BOTTOM_SAFE = 404;

    // Fill the frame edge-to-edge horizontally: the world is exactly WORLD_W wide,
    // so a fill-width scale guarantees zero side gutters. Vertical overflow (extra
    // sky above / forecourt road below) is cropped, campus itself never is.
    function getFitScale() {
      return viewW / WORLD_W;
    }

    // Keep the camera vertically inside the canvas so no blank band can appear.
    function getClampedCamY(scale) {
      var halfWin = (viewH / 2) / scale;
      if (halfWin * 2 >= WORLD_H) return WORLD_H / 2;      // whole world fits
      var lo = CAMPUS_BOTTOM_SAFE - halfWin;               // campus bottom visible
      var hi = CAMPUS_TOP_SAFE + halfWin;                  // campus top visible
      if (lo > hi) return (lo + hi) / 2;                   // frame taller than campus band
      return Math.max(lo, Math.min(hi, cam.y));
    }

    function getViewportTransform() {
      var scale = getFitScale() * cam.zoom;
      var cy = cam.zoom === 1 ? getClampedCamY(scale) : cam.y;
      var offsetX = (viewW / 2) - cam.x * scale;
      var offsetY = (viewH / 2) - cy * scale;
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

      // 1b) Living forecourt fountain — spray droplets + expanding ripple
      var fcLight = themeName === 'light';
      var fcxL = 176, fcyL = 436;
      for (var fi = 0; fi < 7; fi++) {
        var fph = ((animTick * 0.05) + fi * 0.33) % 1;
        var fsx = fcxL + Math.sin((fph * 3.1) + fi * 1.7) * (4 + fph * 15);
        var fsy = fcyL - 30 - Math.sin(fph * Math.PI) * 14 + fph * 26;
        ctx.globalAlpha = 0.85 - fph * 0.5;
        ctx.fillStyle = fcLight ? '#ffffff' : '#bfeaff';
        ctx.fillRect(fsx | 0, fsy | 0, 1, 2);
      }
      ctx.globalAlpha = 1;
      var frp = (animTick * 0.018) % 1;
      ctx.strokeStyle = fcLight
        ? 'rgba(255,255,255,' + (0.45 * (1 - frp)).toFixed(2) + ')'
        : 'rgba(170,225,255,' + (0.42 * (1 - frp)).toFixed(2) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(fcxL, fcyL - 1, 9 + frp * 25, 5 + frp * 14, 0, 0, Math.PI * 2);
      ctx.stroke();

      // 2) Subtle glowing guidance trail ONLY when an agent is carrying a handoff!
      for (var ha = 0; ha < agents.length; ha++) {
        var hag = agents[ha];
        if (hag.state !== 'handoff' || hag.subState !== 'walking' || !hag.path || hag.pathIdx >= hag.path.length) continue;
        var endIdx = Math.min(hag.path.length, hag.pathIdx + 10);
        for (var wpIdx = hag.pathIdx; wpIdx < endIdx; wpIdx++) {
          var wpt = hag.path[wpIdx];
          var phase = ((animTick >> 2) - wpIdx) & 3;
          var alpha = phase === 0 ? 0.65 : 0.25;
          ctx.fillStyle = hag.handoffColor || '#ffe066';
          ctx.globalAlpha = alpha;
          ctx.fillRect((wpt.x * TILE + 6) | 0, (wpt.y * TILE + 6) | 0, 4, 4);
        }
        ctx.globalAlpha = 1;
      }

      // 3) Warm subtle spotlight glow around active working desks
      var deskPulse = 0.14 + 0.06 * Math.sin(animTick * 0.18);
      for (var wa = 0; wa < agents.length; wa++) {
        var wag = agents[wa];
        if (wag.state !== 'working') continue;
        ctx.fillStyle = 'rgba(255, 224, 130, ' + deskPulse.toFixed(2) + ')';
        ctx.fillRect((wag.seat.x * TILE - 8) | 0, (wag.seat.y * TILE - 2) | 0, 32, 24);
      }

      // 4) Animated server rack LEDs in ops_hub
      for (var rk = 0; rk < rackFurniture.length; rk++) {
        var rf = rackFurniture[rk];
        var isAlert = (rf.roomId === 'ops_hub') && (hubOfflineAlert || opsAlert);
        var isHot = roomState[rf.roomId] && roomState[rf.roomId].active;
        Art.drawFurniture(ctx, 'server_rack', rf.x, rf.y, {
          theme: themeName,
          frame: isHot ? (animTick >> 1) : (animTick >> 3),
          alert: isAlert
        });
      }

      // 5) Room active / alert / handoff pulse / focus / hover overlays
      for (var ri = 0; ri < LAYOUT.rooms.length; ri++) {
        var rm = LAYOUT.rooms[ri];
        var st = roomState[rm.roomId];
        var rx = rm.rect.x * TILE;
        var ry = rm.rect.y * TILE;
        var rw = rm.rect.w * TILE;
        var rh = rm.rect.h * TILE;

        if (st.alert) {
          var al = 0.15 + 0.12 * Math.sin(animTick * 0.45);
          ctx.fillStyle = 'rgba(255, 72, 92, ' + al.toFixed(2) + ')';
          ctx.fillRect(rx + 4, ry + TILE, rw - 8, rh - TILE - 8);
          ctx.strokeStyle = 'rgba(255, 95, 110, 0.9)';
          ctx.lineWidth = 2;
          ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
        } else if (st.pulse > 0) {
          ctx.fillStyle = 'rgba(255, 224, 102, ' + (st.pulse * 0.26).toFixed(2) + ')';
          ctx.fillRect(rx + 4, ry + TILE, rw - 8, rh - TILE - 8);
        } else if (st.active) {
          ctx.strokeStyle = 'rgba(110, 235, 200, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
        }

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

      // 6) Dynamic doors (skip openArch portals & duplicate sharedHide sides)
      for (var di = 0; di < allDoors.length; di++) {
        var dr = allDoors[di];
        if (dr.openArch || dr.sharedHide) continue;
        var isOpen = dr.openTimer > 0;
        var dOpts = {
          theme: themeName,
          orient: dr.orient,
          w: TILE,
          h: TILE
        };
        if (dr.isGlass) {
          dOpts.color = '#3b6a94';
          dOpts.frameColor = '#283347';
        } else if (dr.isFence) {
          dOpts.color = '#8a5a34';
          dOpts.frameColor = '#5e3c22';
        }
        Art.drawDoor(ctx, dr.x * TILE, dr.y * TILE, isOpen, dOpts);
      }

      // Check which lounge interactive props have active players right now!
      var pingpongActive = false;
      var cardTableActive = false;
      var treadmillActive = false;
      for (var ip = 0; ip < agents.length; ip++) {
        var pag = agents[ip];
        if (pag.state !== 'idle' || pag.subState !== 'at_spot' || !pag.activity) continue;
        if (pag.activity.id === 'pingpong_group') pingpongActive = true;
        else if (pag.activity.id === 'cards_group') cardTableActive = true;
        else if (pag.activity.id === 'treadmill') treadmillActive = true;
      }

      // 7) Y-Sorted Render List: Foreground Furniture + 11 Agents (~14x22px)
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
          var propActive = rmActive;
          if (ff.pingpong) propActive = pingpongActive;
          else if (ff.cardTable) propActive = cardTableActive;
          else if (ff.treadmill) propActive = treadmillActive;
          else if (ff.animatedProp) propActive = true;

          var fOpts = Object.assign({
            theme: themeName,
            on: true,
            active: propActive,
            glow: ff.screen && (rmActive || themeName === 'dark'),
            screenColor: ff.screenCol,
            frame: propActive ? (animTick >> 1) : (animTick >> 3)
          }, ff.opts);
          Art.drawFurniture(ctx, ff.type, ff.x, ff.y, fOpts);
        } else {
          var ag = item.ref;
          if (hoverAgent === ag) {
            ctx.fillStyle = 'rgba(255, 232, 112, 0.58)';
            ctx.fillRect((ag.px - 8) | 0, (ag.py - 3) | 0, 16, 5);
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

      // 8) Floating Status / Activity Bubbles (above 22px tall characters)
      for (var bi = 0; bi < agents.length; bi++) {
        var ba = agents[bi];
        if (!ba.bubble) continue;
        if (ba.state === 'idle' && ba.subState === 'walking') continue;
        var bob = Math.sin((animTick * 0.14) + bi) > 0.35 ? -1 : 0;
        Art.drawBubble(ctx, ba.px, ba.py - 24 + bob, ba.bubble, {
          theme: themeName,
          style: ba.pose === 'sleep' ? 'thought' : 'speech'
        });
      }

      // 9) Agent name tags when zoomed in (>= 1.45x) or hovered
      if (cam.zoom >= 1.45 || hoverAgent) {
        ctx.font = '700 8px "Noto Sans Thai", "Sarabun", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (var ni = 0; ni < agents.length; ni++) {
          var na = agents[ni];
          if (cam.zoom < 1.45 && hoverAgent !== na) continue;
          var tw = ctx.measureText(na.name).width + 6;
          var nx = (na.px - tw / 2) | 0;
          var ny = (na.py + 2) | 0;
          ctx.fillStyle = 'rgba(15, 18, 30, 0.80)';
          ctx.fillRect(nx, ny, tw, 11);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(na.name, na.px, ny + 1.5);
        }
      }

      ctx.restore();

      // 10) Screen-space Pixel Mini HUD
      drawMiniHud(ctx, computeSummary());

      ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Animation Loop (30fps cap, 8fps under reduced-motion, paused when hidden)
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
      dpr = clamp((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1, 2);
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

    // Seed lively initial idle spread across cafe/cards/pingpong/balcony/garden/plaza nook!
    var seedSpots = [
      { agId: 'vid_art',      roomId: 'lounge_cafe',   spotIdx: 6,  actId: 'cards_group' },
      { agId: 'vid_edit',     roomId: 'lounge_cafe',   spotIdx: 7,  actId: 'cards_group' },
      { agId: 'ai_worker_2',  roomId: 'lounge_cafe',   spotIdx: 10, actId: 'pingpong_group' },
      { agId: 'vid_publish',  roomId: 'lounge_cafe',   spotIdx: 11, actId: 'pingpong_group' },
      { agId: 'ai_review',    roomId: 'lounge_cafe',   spotIdx: 0,  actId: 'coffee' },
      { agId: 'vid_tts',      roomId: 'vid_balcony',   spotIdx: 0,  actId: 'balcony_chill' },
      { agId: 'ops_sys',      roomId: 'lounge_garden', spotIdx: 4,  actId: 'treadmill' },
      { agId: 'hub_dispatch', roomId: 'ops_hub',       spotIdx: 0,  actId: 'water_chat_group' }
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
      getAgents: function () {
        return agents.map(function (a) {
          var rm = roomById[a.currentRoomId];
          return {
            id: a.id, name: a.name, role: a.role, deptId: a.deptId,
            state: a.state, subState: a.subState, working: Boolean(a.assignedWork),
            workDetail: a.workDetail || '', bubble: a.bubble || '',
            activityLabel: a.activity ? a.activity.label : '',
            roomId: a.currentRoomId, roomLabel: rm ? rm.label : '',
            handoffLabel: a.handoffLabel || '', handoffTo: a.handoffTargetAgentId || '',
            shirt: (a.look && a.look.shirt) || '#8b6ae6'
          };
        });
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
