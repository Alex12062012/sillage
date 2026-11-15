import { describe, expect, it } from 'vitest';
import { autoTier, type DeviceInfo } from '../../src/core/tier';

const pc = (gpu: string, cores = 8, mem = 8): DeviceInfo => ({ webgl2: true, gpu, touch: false, mem, cores });
const phone = (gpu: string, cores = 8, mem = 8): DeviceInfo => ({ webgl2: true, gpu, touch: true, mem, cores });

describe('the auto graphics tier', () => {
  it('never picks high on a weak device', () => {
    for (const d of [
      pc('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'),
      pc('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)'),
      pc('ANGLE (Intel, Intel(R) UHD Graphics 730 Direct3D11 vs_5_0 ps_5_0)'),
      pc('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)'), // an APU
      pc('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'),
      pc('Apple GPU'), // Safari hides the model
      pc(''),
      pc('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', 4), // 4 threads
      pc('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', 8, 4), // 4 GB
      pc('Mali-G57 MC2'), // a Chromebook
      phone('Adreno (TM) 740'),
      phone('Apple GPU'),
    ]) expect(autoTier(d), d.gpu || '(hidden)').not.toBe('high');
  });

  it('gives low to software and weak GPUs, and to small phones', () => {
    expect(autoTier({ ...pc('x'), webgl2: false })).toBe('low');
    expect(autoTier(pc('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'))).toBe('low');
    expect(autoTier(phone('Mali-G710 MC10'))).toBe('low');
    expect(autoTier(phone('Mali-G31 MP2'))).toBe('low');
    expect(autoTier(phone('Adreno (TM) 610'))).toBe('low');
    expect(autoTier(phone('PowerVR Rogue GE8320'))).toBe('low');
    expect(autoTier(phone('Adreno (TM) 740', 8, 4))).toBe('low');
  });

  it('gives medium to the other phones and to ordinary computers, high to strong ones', () => {
    expect(autoTier(phone('Adreno (TM) 740'))).toBe('medium');
    expect(autoTier(phone('Apple GPU', 6, 8))).toBe('medium');
    expect(autoTier(pc('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)'))).toBe('medium');
    expect(autoTier(pc('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)', 12))).toBe('high');
    expect(autoTier(pc('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)', 16))).toBe('high');
    expect(autoTier(pc('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)', 12))).toBe('high');
  });
});
