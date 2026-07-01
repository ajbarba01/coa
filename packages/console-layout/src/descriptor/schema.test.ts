import { describe, expect, it } from 'vitest';
import { LayoutDescriptorSchema, LAYOUT_VERSION, type LayoutDescriptor } from './schema.js';

const valid: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: {
    type: 'split',
    direction: 'row',
    adjustability: 'resizable',
    children: [
      { type: 'leaf', panelId: 'nav' },
      { type: 'leaf', panelId: 'chat', size: 70 },
    ],
  },
};

describe('LayoutDescriptorSchema', () => {
  it('accepts a well-formed descriptor', () => {
    expect(LayoutDescriptorSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a nested split tree', () => {
    const nested: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'nav' },
          {
            type: 'split',
            direction: 'column',
            adjustability: 'resizable',
            children: [
              { type: 'leaf', panelId: 'chat' },
              { type: 'leaf', panelId: 'input' },
            ],
          },
        ],
      },
    };
    expect(LayoutDescriptorSchema.parse(nested)).toEqual(nested);
  });

  it('rejects an unknown version', () => {
    expect(() => LayoutDescriptorSchema.parse({ ...valid, version: 999 })).toThrow();
  });

  it('rejects an unknown adjustability value', () => {
    const bad = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'floaty',
        children: [{ type: 'leaf', panelId: 'a' }],
      },
    };
    expect(() => LayoutDescriptorSchema.parse(bad)).toThrow();
  });

  it('rejects a leaf without a panelId', () => {
    const bad = { version: LAYOUT_VERSION, root: { type: 'leaf' } };
    expect(() => LayoutDescriptorSchema.parse(bad)).toThrow();
  });

  it('rejects a split with no children', () => {
    const bad = {
      version: LAYOUT_VERSION,
      root: { type: 'split', direction: 'row', adjustability: 'static', children: [] },
    };
    expect(() => LayoutDescriptorSchema.parse(bad)).toThrow();
  });
});
