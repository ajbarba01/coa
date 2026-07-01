import { z } from 'zod';

/** Per-region resize dial. `dockable` is honored by a docking engine; the
 *  StaticEngine degrades it to `resizable`. */
export const AdjustabilitySchema = z.enum(['static', 'resizable', 'dockable']);
export type Adjustability = z.infer<typeof AdjustabilitySchema>;

/** A leaf hosts exactly one panel. `size` is its proportional size within its parent
 *  split (percent under a resizable split, flex weight under a static one). `fixedPx`
 *  makes it a fixed pixel region instead (the nav rail); `minPx` is a min size along
 *  the parent's main axis so it stops before its content crushes. */
export interface LeafRegion {
  type: 'leaf';
  panelId: string;
  size?: number | undefined;
  fixedPx?: number | undefined;
  minPx?: number | undefined;
}

/** A split arranges children along an axis; the resize dial lives here (it owns
 *  the boundary between its children). */
export interface SplitRegion {
  type: 'split';
  direction: 'row' | 'column';
  adjustability: Adjustability;
  children: Region[];
}

export type Region = LeafRegion | SplitRegion;

const LeafRegionSchema: z.ZodType<LeafRegion> = z.object({
  type: z.literal('leaf'),
  panelId: z.string().min(1),
  size: z.number().positive().optional(),
  fixedPx: z.number().positive().optional(),
  minPx: z.number().positive().optional(),
});

const SplitRegionSchema: z.ZodType<SplitRegion> = z.lazy(() =>
  z.object({
    type: z.literal('split'),
    direction: z.enum(['row', 'column']),
    adjustability: AdjustabilitySchema,
    children: z.array(RegionSchema).min(1),
  }),
);

export const RegionSchema: z.ZodType<Region> = z.lazy(() =>
  z.union([LeafRegionSchema, SplitRegionSchema]),
);

/** Current descriptor version. Bump + add a migration when the shape changes. */
export const LAYOUT_VERSION = 1;

export interface LayoutDescriptor {
  version: number;
  root: Region;
}

export const LayoutDescriptorSchema: z.ZodType<LayoutDescriptor> = z.object({
  version: z.literal(LAYOUT_VERSION),
  root: RegionSchema,
});
