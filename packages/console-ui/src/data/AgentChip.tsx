import {
  Bot,
  BookOpen,
  Bug,
  Compass,
  Database,
  Eye,
  FlaskConical,
  GitBranch,
  Hammer,
  Layers,
  PenTool,
  Search,
  Shield,
  Sparkles,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

/** The curated agent glyph vocabulary — a fixed set, not an icon browser, so
 *  agents stay visually cohesive (P9). Names match the console-viewmodel wire enum. */
export const AGENT_GLYPHS = {
  bot: Bot,
  hammer: Hammer,
  wrench: Wrench,
  flask: FlaskConical,
  shield: Shield,
  book: BookOpen,
  bug: Bug,
  search: Search,
  pen: PenTool,
  branch: GitBranch,
  terminal: SquareTerminal,
  database: Database,
  layers: Layers,
  eye: Eye,
  compass: Compass,
  sparkles: Sparkles,
} as const satisfies Record<string, LucideIcon>;
export type AgentIconName = keyof typeof AGENT_GLYPHS;

/** Categorical identity colors (Okabe-Ito-anchored semantic tokens). Statically
 *  listed so Tailwind sees every class; brass is deliberately not offered. */
export const AGENT_COLOR_CLASSES = {
  slate: 'text-agent-slate bg-agent-slate/15',
  sky: 'text-agent-sky bg-agent-sky/15',
  blue: 'text-agent-blue bg-agent-blue/15',
  teal: 'text-agent-teal bg-agent-teal/15',
  green: 'text-agent-green bg-agent-green/15',
  mauve: 'text-agent-mauve bg-agent-mauve/15',
  violet: 'text-agent-violet bg-agent-violet/15',
  coral: 'text-agent-coral bg-agent-coral/15',
} as const;
export type AgentColorName = keyof typeof AGENT_COLOR_CLASSES;

/** Solid fills for the places the identity color paints a surface (color swatches,
 *  the rail's active marker) rather than tinting a chip ground. */
export const AGENT_SOLID_CLASSES: Record<AgentColorName, string> = {
  slate: 'bg-agent-slate',
  sky: 'bg-agent-sky',
  blue: 'bg-agent-blue',
  teal: 'bg-agent-teal',
  green: 'bg-agent-green',
  mauve: 'bg-agent-mauve',
  violet: 'bg-agent-violet',
  coral: 'bg-agent-coral',
};

export const AGENT_ICON_NAMES = Object.keys(AGENT_GLYPHS) as AgentIconName[];
export const AGENT_COLOR_NAMES = Object.keys(AGENT_COLOR_CLASSES) as AgentColorName[];

const SIZE_CLASSES = {
  sm: 'h-5 w-5 rounded-[3px]',
  md: 'h-7 w-7 rounded-control',
  lg: 'h-10 w-10 rounded-surface',
} as const;
const GLYPH_SIZES = { sm: 12, md: 15, lg: 20 } as const;

export interface AgentChipProps {
  icon: AgentIconName;
  color: AgentColorName;
  size?: keyof typeof SIZE_CLASSES;
  /** If provided the chip is meaningful (role=img); otherwise decorative — pair
   *  it with visible text (color is never the only encoding, §15). */
  label?: string;
  className?: string;
}

/** An agent's identity mark: its glyph on its categorical color ground. */
export function AgentChip({
  icon,
  color,
  size = 'md',
  label,
  className,
}: AgentChipProps): React.JSX.Element {
  return (
    <span
      {...(label !== undefined ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-color={color}
      className={cx(
        'inline-flex shrink-0 items-center justify-center',
        SIZE_CLASSES[size],
        AGENT_COLOR_CLASSES[color],
        className,
      )}
    >
      <Icon name={AGENT_GLYPHS[icon]} size={GLYPH_SIZES[size]} />
    </span>
  );
}
