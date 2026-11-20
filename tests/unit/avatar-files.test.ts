import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The player's realistic skier as built by scripts/build-avatar.mjs (DECISIONS.md, point 113)
describe('the skier model files', () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const [tier, maxTris] of [['low', 10_000], ['high', 30_000]] as const) {
    it(`${tier}: under 3 MB, under ${maxTris} triangles, only the jacket's and the pants' textures (no brand)`, async () => {
      const file = `public/models/skier-${tier}.glb`;
      expect(statSync(file).size).toBeLessThan(3e6);
      const doc = await io.read(file);
      let tris = 0;
      for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
      expect(tris).toBeLessThanOrEqual(maxTris);
      const textured = doc.getRoot().listMaterials().filter((m) => m.getBaseColorTexture() || m.getNormalTexture()).map((m) => m.getName()).sort();
      expect(textured).toEqual(['jacket', 'pants']);
      expect(doc.getRoot().listSkins().length).toBeGreaterThan(0);
      expect(doc.getRoot().listAnimations().length).toBe(1); // its first frame: the fingers' grip
    }, 20_000);
  }
});
