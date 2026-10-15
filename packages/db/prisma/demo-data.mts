/**
 * The demo workspace's forms and respondents, as pure data.
 *
 * Separate from `seed.mts` so it can be unit tested without a database:
 * `src/demo-data.test.ts` runs every generated response through the same
 * `validateSubmission` the API runs, so the seed can never store an answer the
 * application itself would refuse. A seed that bypassed the rules would make the
 * results page demonstrate data that cannot exist.
 *
 * Deterministic: a seeded PRNG (mulberry32), a fixed reference instant, and
 * response ids derived from the PRNG in v4 shape. Two runs produce the same rows.
 */
import type { Answers, AnswerValue, Field, FieldId, FormDefinition } from '@forms/shared';
import { firstField, nextField, submission, walk } from '@forms/form-logic';

// --- Ids ----------------------------------------------------------------------

export const F = {
  welcome: 'f_welcome1',
  role: 'f_role0001',
  teamSize: 'f_teamsiz1',
  frequency: 'f_freq0001',
  started: 'f_started1',
  features: 'f_feature1',
  ease: 'f_ease0001',
  recommend: 'f_recomm01',
  love: 'f_love0001',
  improve: 'f_improv01',
  followUp: 'f_follow01',
  email: 'f_email001',
} as const satisfies Record<string, FieldId>;

export const O = {
  engineer: 'o_enginee1',
  designer: 'o_designe1',
  manager: 'o_manager1',
  researcher: 'o_researc1',
  daily: 'o_daily001',
  weekly: 'o_weekly01',
  monthly: 'o_monthly1',
  rarely: 'o_rarely01',
  logic: 'o_logic001',
  analytics: 'o_analyti1',
  exportCsv: 'o_export01',
  embeds: 'o_embeds01',
} as const;

// --- The demo form, version 1 and version 2 --------------------------------------

const v1Fields: Field[] = [
  {
    id: F.welcome,
    type: 'statement',
    title: 'Two minutes, ten questions. Your answers shape what we build next.',
    required: false,
  },
  {
    id: F.role,
    type: 'single_choice',
    title: 'What best describes your role?',
    required: true,
    options: [
      { id: O.engineer, label: 'Engineer' },
      { id: O.designer, label: 'Designer' },
      { id: O.manager, label: 'Manager' },
      { id: O.researcher, label: 'Researcher' },
    ],
  },
  {
    id: F.teamSize,
    type: 'number',
    title: 'How many people are on your team?',
    description: 'Including you.',
    required: true,
    integer: true,
    min: 1,
    max: 50,
    showIf: { op: 'eq', field: F.role, value: O.manager },
  },
  {
    id: F.frequency,
    type: 'single_choice',
    title: 'How often do you build a form?',
    required: true,
    options: [
      { id: O.daily, label: 'Every day' },
      { id: O.weekly, label: 'Every week' },
      { id: O.monthly, label: 'Every month' },
      { id: O.rarely, label: 'Rarely' },
    ],
  },
  {
    id: F.features,
    type: 'multi_choice',
    title: 'Which features do you rely on?',
    description: 'Choose all that apply.',
    required: false,
    options: [
      { id: O.logic, label: 'Branching logic' },
      { id: O.analytics, label: 'Results report' },
      { id: O.exportCsv, label: 'CSV export' },
      { id: O.embeds, label: 'Embedding' },
    ],
  },
  { id: F.ease, type: 'rating', title: 'How easy was your first form to build?', required: true, scale: 5 },
  {
    id: F.recommend,
    type: 'nps',
    title: 'How likely are you to recommend us to a colleague?',
    required: true,
    jumps: [{ when: { op: 'lt', field: F.recommend, value: 7 }, to: F.improve }],
  },
  {
    id: F.love,
    type: 'long_text',
    title: 'What do you love most?',
    required: false,
    maxLength: 2000,
    // Promoters and passives say what works, then skip the improvement question.
    jumps: [{ when: { op: 'all', of: [] }, to: F.followUp }],
  },
  { id: F.improve, type: 'long_text', title: 'What should we improve first?', required: false, maxLength: 2000 },
  {
    id: F.followUp,
    type: 'yes_no',
    title: 'May we follow up with you about your answers?',
    required: true,
    jumps: [{ when: { op: 'eq', field: F.followUp, value: false }, to: 'end' }],
  },
  { id: F.email, type: 'email', title: 'Where should we write to you?', required: true },
];

export const DEMO_V1: FormDefinition = {
  schemaVersion: 1,
  title: 'Product feedback survey',
  description: 'Help us decide what to build next.',
  fields: v1Fields,
  ending: { title: 'Thank you', message: 'Your answers have been recorded. We read every one.' },
};

/**
 * Version 2: one question reworded, one added (a date), and the team-size range
 * widened. The reworded question keeps its id, so results and logic follow it.
 */
export const DEMO_V2: FormDefinition = {
  ...DEMO_V1,
  fields: v1Fields.flatMap((field): Field[] => {
    if (field.id === F.frequency) {
      return [
        { ...field, title: 'How often do you create or edit a form?' },
        { id: F.started, type: 'date', title: 'When did you start using us?', required: false },
      ];
    }
    if (field.id === F.teamSize && field.type === 'number') return [{ ...field, max: 200 }];
    return [field];
  }),
};

/** A second form that has never been published: the "draft only" state. */
export const OFFSITE_DRAFT: FormDefinition = {
  schemaVersion: 1,
  title: 'Team offsite poll',
  fields: [
    {
      id: 'f_offsite1',
      type: 'single_choice',
      title: 'Which month suits you best?',
      required: true,
      options: [
        { id: 'o_march001', label: 'March' },
        { id: 'o_april001', label: 'April' },
        { id: 'o_may00001', label: 'May' },
      ],
    },
    { id: 'f_offsite2', type: 'yes_no', title: 'Can you stay the weekend?', required: false },
  ],
  ending: { title: 'Thanks', message: 'We will share the dates soon.' },
};

// --- Deterministic respondents -------------------------------------------------------

/** mulberry32: a tiny, well-distributed 32-bit PRNG. Same seed, same sequence. */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[], weights?: readonly number[]): T {
  const w = weights ?? items.map(() => 1);
  let roll = random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i += 1) {
    roll -= w[i]!;
    if (roll < 0) return items[i]!;
  }
  return items.at(-1)!;
}

/** A v4-shaped UUID from the PRNG, so response ids are deterministic and valid. */
export function uuid(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = '89ab'[Math.floor(random() * 4)]!;
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const LOVE = [
  'The branching is the first I have seen that I can actually read.',
  'Seeing the jumps drawn next to the questions.',
  'Results per version. We changed a question mid-survey and nothing broke.',
  'One question per screen keeps people answering on their phones.',
  'The CSV opens in Excel with accents intact.',
];

const IMPROVE = [
  'Let me duplicate a question with its logic.',
  'A way to share the results report with my team.',
  'More question types, like a file upload.',
  'Templates to start from.',
  'Faster loading on slow connections.',
];

/** One respondent's answer to a field, by persona. */
function answerFor(field: Field, random: () => number, persona: { promoter: number }): AnswerValue | undefined {
  switch (field.id) {
    case F.role:
      return pick(random, [O.engineer, O.designer, O.manager, O.researcher], [5, 3, 2, 1]);
    case F.teamSize:
      return 2 + Math.floor(random() * random() * 30);
    case F.frequency:
      return pick(random, [O.daily, O.weekly, O.monthly, O.rarely], [2, 5, 3, 1]);
    case F.started: {
      const month = 1 + Math.floor(random() * 9);
      const day = 1 + Math.floor(random() * 28);
      return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    case F.features: {
      const chosen = [O.logic, O.analytics, O.exportCsv, O.embeds].filter((_, i) => random() < [0.7, 0.55, 0.4, 0.15][i]!);
      return chosen.length === 0 ? undefined : chosen;
    }
    case F.ease:
      return pick(random, [1, 2, 3, 4, 5], [1, 2, 5, 9, 7]);
    case F.recommend:
      return persona.promoter < 0.5
        ? 9 + Math.floor(random() * 2)
        : persona.promoter < 0.78
          ? 7 + Math.floor(random() * 2)
          : Math.floor(random() * 7);
    case F.love:
      return random() < 0.7 ? pick(random, LOVE) : undefined;
    case F.improve:
      return random() < 0.8 ? pick(random, IMPROVE) : undefined;
    case F.followUp:
      return random() < 0.45;
    case F.email:
      return `respondent${String(Math.floor(random() * 10_000))}@example.com`;
    default:
      return undefined;
  }
}

export interface DemoResponse {
  readonly id: string;
  readonly answers: Answers;
  readonly reached: FieldId[];
  readonly startedAt: Date;
  readonly updatedAt: Date;
  readonly submittedAt: Date | null;
}

/**
 * `count` respondents through `definition`, moving with the real navigator. A
 * fraction stop part-way, so the funnel has drop-off to show.
 */
export function respondents(
  definition: FormDefinition,
  options: { seed: number; count: number; abandonRate: number; from: Date; spacingMinutes: number },
): DemoResponse[] {
  const random = prng(options.seed);
  const out: DemoResponse[] = [];
  for (let n = 0; n < options.count; n += 1) {
    const persona = { promoter: random() };
    const abandons = random() < options.abandonRate;
    const stopAfter = abandons ? 1 + Math.floor(random() * 6) : Number.POSITIVE_INFINITY;

    const answers: Answers = {};
    const history: FieldId[] = [];
    let current = firstField(definition);
    let finished = false;
    while (current !== null) {
      history.push(current);
      const field = definition.fields.find((candidate) => candidate.id === current)!;
      const value = answerFor(field, random, persona);
      if (value !== undefined) answers[field.id] = value;
      if (history.length >= stopAfter) break;
      current = nextField(definition, history, answers);
      if (current === null) finished = true;
    }

    const sent = submission(history, answers);
    const startedAt = new Date(options.from.getTime() + n * options.spacingMinutes * 60_000);
    const seconds = 35 + Math.floor(random() * 260);
    const endedAt = new Date(startedAt.getTime() + seconds * 1000);
    out.push({
      id: uuid(random),
      answers: sent,
      // What the API would store: the server's own walk, cut at the current
      // question for an abandoned response.
      reached: finished ? walk(definition, sent) : history,
      startedAt,
      updatedAt: endedAt,
      submittedAt: finished ? endedAt : null,
    });
  }
  return out;
}
