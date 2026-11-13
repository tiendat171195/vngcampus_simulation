import { z } from 'zod';
import type { LocalizedText } from './missions';

/**
 * Live operations (docs/08 §5): settings the team changes without a deploy, kill switches and
 * announcements. The API stores them, the realtime server applies them within seconds.
 */

const vnDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ngày dạng YYYY-MM-DD');

export const operationalSettingsSchema = z.object({
  /** Kill switch: nearby chat for everyone. */
  chatEnabled: z.boolean(),
  /** Maintenance: nobody but staff gets in; people inside are told. */
  maintenance: z.object({ on: z.boolean(), message: z.string().trim().min(1).max(300) }),
  /** Most points one mission may give (checked before publishing). */
  rewardCap: z.number().int().min(10).max(100_000),
  /** Vietnam days that never break a streak. */
  holidays: z.array(vnDate).max(200),
  /** Fill tomorrow from templates when nobody planned a daily mission (docs/08 §4.5). */
  autofill: z.object({
    enabled: z.boolean(),
    /** A template is not reused within this many days. */
    avoidDays: z.number().int().min(0).max(365),
  }),
});
export type OperationalSettings = z.infer<typeof operationalSettingsSchema>;
export const settingsPatchSchema = operationalSettingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const DEFAULT_SETTINGS: OperationalSettings = {
  chatEnabled: true,
  maintenance: { on: false, message: 'Campus đang bảo trì, quay lại sau ít phút nhé.' },
  rewardCap: 1000,
  holidays: [],
  autofill: { enabled: true, avoidDays: 14 },
};

/** Ticker: a line along the top · popup: a box to close · fullscreen: covers the game. */
export const ANNOUNCEMENT_LEVELS = ['ticker', 'popup', 'fullscreen'] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

export const announcementInputSchema = z
  .object({
    level: z.enum(ANNOUNCEMENT_LEVELS),
    text: z.object({
      vi: z.string().trim().min(1).max(300),
      en: z.string().trim().max(300).optional(),
    }),
    /** Omitted: on air now. */
    startsAt: z.iso.datetime({ offset: true }).optional(),
    /** How long it stays on air. */
    minutes: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60),
  })
  .strict();
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export interface AnnouncementDto {
  id: string;
  level: AnnouncementLevel;
  text: LocalizedText;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  state: 'scheduled' | 'live' | 'ended' | 'cancelled';
  createdByName: string | null;
}

/** What a player is told about the campus as a whole (MSG.ops). */
export interface OpsMessage {
  chatEnabled: boolean;
  /** Set while maintenance is on: the message to show. */
  maintenance: string | null;
  announcements: AnnouncementView[];
}
export interface AnnouncementView {
  id: string;
  level: AnnouncementLevel;
  text: LocalizedText;
  endsAt: string;
}

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    active: z.boolean().default(true),
  })
  .strict();

export interface TemplateDto {
  id: string;
  name: string;
  tags: string[];
  /** Used when filling empty days. */
  active: boolean;
  lastUsedOn: string | null;
  title: LocalizedText;
  objectives: number;
  points: number;
  /** The template no longer passes the schema (the map or rules moved on). */
  broken: boolean;
  createdAt: string;
}
export interface TemplateDetailDto extends TemplateDto {
  definition: unknown;
}
