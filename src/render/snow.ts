import { DataTexture, RGBAFormat, Vector4, type Texture } from 'three';

/**
 * The snow's own surface, for the snow materials only (massif, detail patch, land around, arcade terrain), no triangle:
 * - the groomer's corduroy: ridges every 30 cm along the piste and 4.5 m passes, on groomed snow (a texture of the
 *   10 m grid with the piste's direction, see MountainView), faded before it aliases (ridges past 70 m, passes past 90 m);
 * - a grain of crystals (12 cm), near the camera only;
 * - the shade lit by the blue sky: the light that does not come from the sun is a touch bluer.
 * Needs the world position varying of the relief patch (addHeightFog, called first by the same hook).
 */
export const SNOW = {
  uGroom: { value: new DataTexture(new Uint8Array([0, 128, 128, 0]), 1, 1, RGBAFormat) as Texture },
  uGroomRect: { value: new Vector4(0, 0, 1, 1) },
  uGroomOn: { value: 0 },
};

export function addSnowSurface(sh: { uniforms: Record<string, unknown>; fragmentShader: string }): void {
  if (!sh.fragmentShader.includes('vReliefW')) return;
  Object.assign(sh.uniforms, SNOW);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uGroom;\nuniform vec4 uGroomRect;\nuniform float uGroomOn;')
    .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
    {
      vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      float dist = length(vViewPosition);
      float near = 1.0 - smoothstep(25.0, 70.0, dist);
      vec2 cell = floor(vReliefW / 0.12);
      float g = 1.0 + (fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.07 * near;
      if (uGroomOn > 0.5) {
        vec2 guv = (vReliefW - uGroomRect.xy) * uGroomRect.zw;
        vec4 gt = (guv.x > 0.0 && guv.y > 0.0 && guv.x < 1.0 && guv.y < 1.0) ? texture2D(uGroom, guv) : vec4(0.0);
        float groomed = gt.r;
        vec2 c2 = gt.gb * 2.0 - 1.0; // (cos 2θ, sin 2θ) of the piste's direction
        float tilt = length(wN.xz);
        if (groomed > 0.05 && dot(c2, c2) > 0.04) {
          float th = 0.5 * atan(c2.y, c2.x);
          float u = dot(vReliefW, vec2(-sin(th), cos(th))); // across the piste
          float ridge = 0.5 + 0.5 * cos(u * 20.944); // 2π / 0.3 m
          float aa = clamp(1.0 - fwidth(u) / 0.15, 0.0, 1.0);
          float pass = step(0.5, fract(u / 4.5));
          float k = groomed * smoothstep(0.0, 0.05, tilt); // not on the flat (no fall to groom along)
          g *= 1.0 - k * (ridge * 0.07 * aa * near + pass * 0.02 * (1.0 - smoothstep(25.0, 90.0, dist))); // a groomer's work reads only up close
        }
      }
      reflectedLight.directDiffuse *= g;
      reflectedLight.indirectDiffuse *= g * vec3(0.93, 0.97, 1.07);
    }`);
}
