import { smoothstep } from './track';

/**
 * How a free-ride tree is drawn, and so how solid it is (DECISIONS.md, points 97 and 107). One rule for the view
 * (species, width, scale) and the simulation (collision radius), so the two cannot drift apart.
 * species: 0 spruce, 1 fir (the conifer shape), 2 winter beech, 3 larch (the bare shape).
 * scale: of the unit tree (4.4 high, its foot 0.3 m under the snow), wide: across, tall: up (beeches are squat).
 * r: what stands at a skier's hip, 1 m over the snow: the lowest boughs if they come down that far, else the trunk
 * (never under 0.7 m for a conifer: dense dead branches round the trunk); the bare trunk for beeches and larches.
 */
export interface TreeLook { species: 0 | 1 | 2 | 3; scale: number; wide: number; tall: number; r: number }

/** u: the tree's height within the station's forest (0 lowest tree, 1 highest); alps: Avoriaz. */
export function treeLook(id: number, h: number, u: number, alps: boolean): TreeLook {
  const h1 = (id * 0.754877) % 1, h2 = (id * 0.56984) % 1;
  const species: TreeLook['species'] = u < 0.16 && h1 < 0.2 ? 2 : alps && u > 0.5 && h1 < 0.2 + 0.6 * (u - 0.5) ? 3 : !alps && u < 0.55 && h1 < 0.38 ? 1 : 0;
  const scale = (h / 4.4) * (alps ? 1 - 0.3 * smoothstep(0.7, 1, u) : 1); // stunted near the top of the Alpine forest
  const wide = [0.66 + h2 * 0.14, 0.86 + h2 * 0.1, 1.05 + h2 * 0.2, 0.5 + h2 * 0.1][species];
  const tall = species === 2 ? 0.8 : 1;
  const yu = 1.3 / (scale * tall); // the hip, in the unit tree's height
  let r: number;
  if (species >= 2) r = Math.max(0.3, (0.17 - (0.1 * Math.min(yu, 3.6)) / 3.6) * scale * wide + 0.05); // bare trunk (0.17 → 0.07 over 3.6)
  else {
    // the lowest tier (trees.ts coniferNear): tips at 0.45, apex at 2.2, radius 1.05; a star, so 0.9 of it on average
    const skirt = yu >= 0.45 && yu < 2.2 ? ((1.05 * (2.2 - yu)) / 1.75) * scale * wide * 0.9 : 0;
    r = Math.max(0.7, 0.16 * scale * wide + 0.1, skirt);
  }
  return { species, scale, wide, tall, r };
}
