/**
 * The 'auto' graphics tier, from what the browser tells of the device (DECISIONS.md, point 102). Prudent: when in
 * doubt, the lower tier. High needs a computer that is clearly strong: a discrete or high-end GPU, 8 threads or more
 * and 8 GB or more (Chrome caps deviceMemory at 8; browsers that hide it count as 8, those that hide the GPU never get
 * high). Low for a software or weak GPU, and for small phones.
 */
export interface DeviceInfo {
  webgl2: boolean;
  /** WebGL's unmasked renderer string ('' when hidden). */
  gpu: string;
  /** A coarse pointer: phone or tablet. */
  touch: boolean;
  /** navigator.deviceMemory (GB), 8 when unknown. */
  mem: number;
  /** navigator.hardwareConcurrency. */
  cores: number;
}

export type Tier = 'low' | 'medium' | 'high';

const WEAK = /SwiftShader|llvmpipe|Software|Mali|Adreno \(TM\) ([3-5]\d\d|6[01]\d)\b|PowerVR/i;
const STRONG = /NVIDIA|GeForce|Quadro|RTX|Radeon(\(TM\))? (RX|Pro)\b|Intel.*\bArc\b|Apple M\d+ (Pro|Max|Ultra)\b/i;

export function autoTier(d: DeviceInfo): Tier {
  if (!d.webgl2 || WEAK.test(d.gpu)) return 'low';
  if (d.touch) return d.mem <= 4 || d.cores <= 4 ? 'low' : 'medium';
  return STRONG.test(d.gpu) && d.cores >= 8 && d.mem >= 8 ? 'high' : 'medium';
}
