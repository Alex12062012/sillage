// The player's skier model, from "Skiing Lady" by lancehuang526 (Sketchfab, CC BY 4.0; docs/CREDITS.md):
//   node scripts/build-avatar.mjs        (source: scripts/raw/skiing_lady.glb, kept out of git)
// Writes public/models/skier-high.glb and skier-low.glb, ready for src/render/avatar.ts:
// - no ground plane; no texture that carries a real brand (the skis', the goggle strap's, the poles'): flat colours;
// - only the jacket's and the pants' textures kept (base colour and normals), 1024 px (high) or 512 px (low), WebP;
//   the knitted balaclava becomes a flat dark fabric;
// - the animation kept (its first frame gives the fingers' grip on the poles), resampled;
// - low: the meshes simplified to about 60 % of their triangles;
// - geometry left as floats: meshopt's quantisation moves the skin's bind matrices into a quantised space, where the
//   proportions src/render/avatar.ts measures would be wrong; the files stay well under 3 MB without it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { statSync } from 'node:fs';

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Flat colours (linear) for the materials whose textures go: the skis' top sheet, the strap, the poles, the knit. */
const FLAT = {
  'coated_tex.ski': [0.02, 0.022, 0.025, 1],
  'fabric_tex.goggles': [0.015, 0.015, 0.018, 1],
  'metal_tex.pole': [0.35, 0.37, 0.4, 1],
  fabric_woolen_black: [0.018, 0.018, 0.02, 1],
};

for (const [tier, size, ratio] of [['high', 1024, 1], ['low', 512, 0.6]]) {
  const doc = await io.read('scripts/raw/skiing_lady.glb');
  const root = doc.getRoot();
  for (const node of root.listNodes()) if (node.getMesh()?.getName().startsWith('ground')) node.dispose();
  for (const mesh of root.listMeshes()) if (mesh.getName().startsWith('ground')) mesh.dispose();
  for (const mat of root.listMaterials()) {
    const flat = FLAT[mat.getName()];
    if (flat) {
      mat.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setBaseColorFactor(flat);
      if (mat.getName() === 'fabric_woolen_black') mat.setRoughnessFactor(0.95).setMetallicFactor(0);
    }
    if (mat.getName() === 'jacket') mat.setMetallicRoughnessTexture(null).setRoughnessFactor(0.7).setMetallicFactor(0);
    if (mat.getName() === 'Material') mat.dispose(); // the ground's
  }
  await doc.transform(
    prune(),
    dedup(),
    resample(),
    weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 })] : []),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }),
    prune(),
  );
  // the fabrics' mean brightness (linear, over their UV islands), for the outfit tint (avatar.ts): no pixel readback in
  // the browser at load (it stalled frames and the adaptive resolution then stayed down)
  for (const mat of root.listMaterials()) {
    const tex = mat.getBaseColorTexture();
    if (!tex || !['jacket', 'pants'].includes(mat.getName())) continue;
    const { data, info } = await sharp(Buffer.from(tex.getImage())).resize(128, 128).raw().toBuffer({ resolveWithObject: true });
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (l > 0.06) { sum += l ** 2.2; n++; }
    }
    mat.setExtras({ ...mat.getExtras(), meanLum: n ? sum / n : 0.2 });
  }
  const out = `public/models/skier-${tier}.glb`;
  await io.write(out, doc);
  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  console.log(out, `${(statSync(out).size / 1e6).toFixed(2)} MB`, `${Math.round(tris)} triangles`, `${root.listTextures().length} textures`);
}
