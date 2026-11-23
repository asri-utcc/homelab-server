/**
 * Scene Director — turns a StudioScene into a concrete illustrated "shot plan"
 * (camera setup + cast + props + mood) so every scene of an illustrated style is
 * drawn as its own staged moment instead of one static hero picture with cards on top.
 *
 * Priority: scene.direction (written by the script AI) → keyword/visual inference.
 * Consecutive scenes never reuse the same shot.
 */
import { SceneVisualType, StudioScene, normalizeSceneVisual } from '../types';

export const SHOT_TYPES = [
  'pov-desk',
  'interview',
  'whiteboard',
  'closeup',
  'crowd',
  'split',
  'stairs',
  'held-paper',
  'door',
  'phone',
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const MOODS = ['confident', 'worried', 'panic', 'happy', 'think', 'smug', 'tired', 'shock'] as const;
export type Mood = (typeof MOODS)[number];

export type Pose =
  | 'type'
  | 'stand'
  | 'point'
  | 'shrug'
  | 'cheer'
  | 'facepalm'
  | 'think'
  | 'wave'
  | 'hold'
  | 'present';

export const PROP_NAMES = [
  'laptop',
  'mug',
  'cup-tower',
  'calendar',
  'clock',
  'resume',
  'chair',
  'phone',
  'bulb',
  'money',
  'trophy',
  'plant',
  'window',
  'briefcase',
  'rocket',
  'chart',
  'question',
  'check',
  'cross',
  'robot',
  'book',
  'star',
  'heart',
  'fire',
] as const;
export type PropName = (typeof PROP_NAMES)[number];

export const CAST_ROLES = ['hero', 'interviewer', 'boss', 'friend', 'crowd'] as const;
export type CastRole = (typeof CAST_ROLES)[number];

export type Environment = 'indoor' | 'outdoor';

export interface ShotPlan {
  shot: ShotType;
  mood: Mood;
  /** Mood at the start of the scene (face changes to `mood` part-way through) */
  startMood: Mood;
  pose: Pose;
  cast: CastRole[];
  props: PropName[];
  env: Environment;
  /** Day counter for the wall calendar (grows across the video) */
  day: number;
  visual: SceneVisualType;
}

/** Shape of the optional `direction` object the script AI can attach to a scene */
export interface SceneDirectionInput {
  shot?: string;
  mood?: string;
  pose?: string;
  props?: string[];
  cast?: string[];
  env?: string;
}

const POSES: readonly Pose[] = [
  'type',
  'stand',
  'point',
  'shrug',
  'cheer',
  'facepalm',
  'think',
  'wave',
  'hold',
  'present',
];

function sceneText(scene: StudioScene): string {
  const parts: string[] = [scene.title || '', scene.subtitle || '', scene.narration || '', scene.badge || ''];
  if (scene.bullets) parts.push(...scene.bullets);
  if (scene.compare) {
    parts.push(scene.compare.leftTitle || '', scene.compare.rightTitle || '');
    parts.push(...(scene.compare.leftItems || []), ...(scene.compare.rightItems || []));
  }
  if (scene.quote) parts.push(scene.quote.text || '');
  if (scene.stat) parts.push(String(scene.stat.value ?? ''), scene.stat.label || '');
  return parts.join(' ').toLowerCase();
}

const PROP_LEXICON: Array<[RegExp, PropName[]]> = [
  [/สัมภาษณ์|interview|hr\b|เรซูเม่|resume|ใบสมัคร|สมัครงาน|cv\b/, ['resume', 'chair']],
  [/เงิน|บาท|รายได้|เงินเดือน|ลงทุน|หุ้น|กำไร|หนี้|ออม|ราคา|฿|\$|ค่าใช้จ่าย/, ['money']],
  [/เวลา|นาที|ชั่วโมง|deadline|เดดไลน์|สาย|ด่วน/, ['clock']],
  [/วันที่|วันแรก|\d+\s*วัน|day|ปฏิทิน|สัปดาห์|เดือน/, ['calendar']],
  [/มือถือ|โทรศัพท์|แอป|app|ไลน์|แชท|โซเชียล|tiktok|facebook|ข้อความ/, ['phone']],
  [/\bai\b|เอไอ|หุ่นยนต์|robot|ระบบอัตโนมัติ|chatgpt|gemini|claude/, ['robot']],
  [/ไอเดีย|ความคิด|idea|แนวคิด|วิธี|เคล็ดลับ|สูตร|ทริค/, ['bulb']],
  [/กาแฟ|coffee|ง่วง|นอน|เหนื่อย|ดึก/, ['mug', 'cup-tower']],
  [/สำเร็จ|รางวัล|ชนะ|ได้งาน|ผ่าน|เป้าหมาย|win|success/, ['trophy', 'star']],
  [/เติบโต|กราฟ|สถิติ|ยอด|เพิ่มขึ้น|%|เปอร์เซ็นต์|ตัวเลข/, ['chart']],
  [/ธุรกิจ|บริษัท|งาน|ออฟฟิศ|ประชุม|หัวหน้า|บอส|ทีม/, ['briefcase']],
  [/เรียน|หนังสือ|อ่าน|ความรู้|สอบ|book/, ['book']],
  [/เปิดตัว|เริ่ม|launch|start|พุ่ง|ปัง/, ['rocket']],
  [/ทำไม|อะไร|ยังไง|อย่างไร|\?|ไหม/, ['question']],
  [/ห้าม|ผิด|พลาด|อย่า|เสี่ยง|ตก|ไม่ควร|แย่/, ['cross']],
  [/ถูก|ควร|ดี|ผ่าน|เยี่ยม|โอเค/, ['check']],
  [/รัก|ชอบ|ใจ|heart|love/, ['heart']],
  [/ร้อน|ไฟ|ไวรัล|hot|เดือด|พัง/, ['fire']],
];

const MOOD_LEXICON: Array<[RegExp, Mood]> = [
  [/ช็อก|ตกใจ|อึ้ง|ไม่น่าเชื่อ|ว้าว|shock/, 'shock'],
  [/ห้าม|พัง|ตกรอบ|ปัดตก|พลาด|เสี่ยง|กับดัก|อันตราย|หายนะ|ล้มเหลว/, 'panic'],
  [/กังวล|ยาก|ปัญหา|เครียด|จุดอ่อน|กดดัน|ตื่นเต้น/, 'worried'],
  [/เหนื่อย|ง่วง|ดึก|หมดแรง|เบื่อ/, 'tired'],
  [/ได้งาน|สำเร็จ|ชนะ|ผ่าน|ดีใจ|สุดยอด|ปัง|แน่นอน|ได้แน่/, 'happy'],
  [/ทำไม|ยังไง|อย่างไร|คิด|สงสัย|\?/, 'think'],
  [/เคล็ดลับ|สูตร|โปร|เทพ|ง่ายๆ|ชิล/, 'smug'],
];

function isShot(v: unknown): v is ShotType {
  return typeof v === 'string' && (SHOT_TYPES as readonly string[]).includes(v);
}
function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}
function isPose(v: unknown): v is Pose {
  return typeof v === 'string' && (POSES as readonly string[]).includes(v);
}
function isProp(v: unknown): v is PropName {
  return typeof v === 'string' && (PROP_NAMES as readonly string[]).includes(v);
}
function isRole(v: unknown): v is CastRole {
  return typeof v === 'string' && (CAST_ROLES as readonly string[]).includes(v);
}

function readDirection(scene: StudioScene): SceneDirectionInput {
  const raw = (scene as StudioScene & { direction?: unknown }).direction;
  if (!raw || typeof raw !== 'object') return {};
  return raw as SceneDirectionInput;
}

/** Parse "3 ใน 100", "3/100", "85%" → highlighted count out of 100 for crowd shots */
export function parseCrowdRatio(scene: StudioScene): { hit: number; of: number } | null {
  const hay = `${scene.stat?.value ?? ''} ${scene.stat?.label ?? ''} ${scene.title} ${scene.subtitle ?? ''} ${scene.highlight ?? ''}`;
  const ratio = /(\d+(?:\.\d+)?)\s*(?:ใน|\/|จาก|of)\s*(\d+(?:\.\d+)?)/i.exec(hay);
  if (ratio) {
    const a = parseFloat(ratio[1]);
    const b = parseFloat(ratio[2]);
    if (b > 0 && a <= b) return { hit: a, of: b };
  }
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(hay);
  if (pct) {
    const p = parseFloat(pct[1]);
    if (p >= 0 && p <= 100) return { hit: p, of: 100 };
  }
  return null;
}

function inferMood(text: string, index: number, total: number, visual: SceneVisualType): Mood {
  for (const [re, mood] of MOOD_LEXICON) {
    if (re.test(text)) return mood;
  }
  if (index === 0) return 'shock';
  if (index === total - 1) return 'happy';
  if (visual === 'stat') return 'shock';
  if (visual === 'steps') return 'confident';
  return 'confident';
}

function inferProps(text: string, max = 4): PropName[] {
  const out: PropName[] = [];
  for (const [re, props] of PROP_LEXICON) {
    if (re.test(text)) {
      for (const p of props) if (!out.includes(p)) out.push(p);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

/** Candidate shots per visual type, best first */
function candidateShots(visual: SceneVisualType, text: string, index: number, total: number, hasCrowd: boolean): ShotType[] {
  const dialog = /สัมภาษณ์|interview|hr\b|ถาม|ตอบ|คุย|บอส|หัวหน้า|ลูกค้า|เพื่อน/.test(text);
  if (index === 0) {
    if (/ห้อง|ประตู|เข้า|เปิด/.test(text)) return ['door', 'pov-desk', 'closeup'];
    return hasCrowd ? ['crowd', 'closeup', 'door'] : ['closeup', 'door', 'pov-desk'];
  }
  switch (visual) {
    case 'compare':
      return dialog ? ['split', 'interview', 'whiteboard'] : ['split', 'whiteboard', 'interview'];
    case 'stat':
      return hasCrowd ? ['crowd', 'closeup', 'whiteboard'] : ['closeup', 'whiteboard', 'crowd'];
    case 'steps':
      return ['stairs', 'whiteboard', 'held-paper'];
    case 'bullets':
      return dialog ? ['interview', 'held-paper', 'whiteboard'] : ['held-paper', 'whiteboard', 'pov-desk'];
    case 'quote':
      return index === total - 1 ? ['pov-desk', 'interview', 'closeup'] : ['interview', 'phone', 'closeup'];
    case 'icon':
      return dialog ? ['interview', 'phone', 'pov-desk'] : ['phone', 'pov-desk', 'closeup'];
    case 'image':
      return ['held-paper', 'phone', 'pov-desk'];
    default:
      return dialog ? ['interview', 'pov-desk', 'door'] : ['pov-desk', 'door', 'closeup'];
  }
}

function poseFor(shot: ShotType, mood: Mood): Pose {
  if (shot === 'pov-desk') {
    if (mood === 'happy') return 'cheer';
    if (mood === 'panic') return 'facepalm';
    if (mood === 'think') return 'think';
    return 'type';
  }
  if (shot === 'whiteboard') return 'present';
  if (shot === 'stairs') return mood === 'happy' ? 'cheer' : 'stand';
  if (shot === 'crowd') return mood === 'happy' ? 'cheer' : 'wave';
  if (shot === 'door') return mood === 'happy' ? 'wave' : 'stand';
  if (shot === 'interview') return mood === 'think' ? 'think' : 'shrug';
  if (shot === 'closeup') return mood === 'think' ? 'think' : mood === 'panic' ? 'facepalm' : 'stand';
  return 'stand';
}

/**
 * Plan every scene of a video at once so shots never repeat back-to-back and
 * the calendar day keeps counting forward.
 */
export function planAllScenes(scenes: StudioScene[]): ShotPlan[] {
  const plans: ShotPlan[] = [];
  const total = scenes.length;
  const usage: Partial<Record<ShotType, number>> = {};

  scenes.forEach((scene, index) => {
    const dir = readDirection(scene);
    const visual = normalizeSceneVisual(scene);
    const text = sceneText(scene);
    const crowd = parseCrowdRatio(scene);
    const prev = plans[index - 1]?.shot;

    let shot: ShotType;
    if (isShot(dir.shot) && dir.shot !== prev) {
      shot = dir.shot;
    } else {
      const cands = candidateShots(visual, text, index, total, Boolean(crowd));
      // Prefer the least-used candidate that is not the previous shot
      const ranked = cands
        .filter((c) => c !== prev)
        .sort((a, b) => (usage[a] || 0) - (usage[b] || 0) || cands.indexOf(a) - cands.indexOf(b));
      shot = ranked[0] || (SHOT_TYPES.find((s) => s !== prev) as ShotType);
    }
    usage[shot] = (usage[shot] || 0) + 1;

    const mood: Mood = isMood(dir.mood) ? dir.mood : inferMood(text, index, total, visual);
    const startMood: Mood =
      mood === 'panic' || mood === 'shock'
        ? 'confident'
        : mood === 'happy'
          ? 'think'
          : mood === 'worried'
            ? 'confident'
            : mood;
    const pose: Pose = isPose(dir.pose) ? dir.pose : poseFor(shot, mood);

    const aiProps = Array.isArray(dir.props) ? dir.props.filter(isProp) : [];
    const props = aiProps.length > 0 ? aiProps.slice(0, 4) : inferProps(text);

    let cast: CastRole[] = Array.isArray(dir.cast) ? dir.cast.filter(isRole) : [];
    if (cast.length === 0) {
      cast = ['hero'];
      if (shot === 'interview') cast.push(/บอส|หัวหน้า|boss/.test(text) ? 'boss' : 'interviewer');
      if (shot === 'crowd') cast.push('crowd');
    }
    if (shot === 'interview' && cast.length < 2) cast.push('interviewer');

    const env: Environment =
      dir.env === 'outdoor' || dir.env === 'indoor'
        ? dir.env
        : /ถนน|ข้างนอก|เดินทาง|สวน|รถเมล์|outdoor|ทะเล|ภูเขา|เมือง/.test(text)
          ? 'outdoor'
          : 'indoor';

    const day = Math.max(1, Math.round(((index + 1) / Math.max(1, total)) * 30));

    plans.push({ shot, mood, startMood, pose, cast, props, env, day, visual });
  });

  return plans;
}
