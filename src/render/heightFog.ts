import { Color, DataTexture, Material, RedFormat, ShaderChunk, Vector2, Vector4, type Texture } from 'three';

/**
 * Height haze on top of three's distance fog: valleys hazier, ridges standing clear above them.
 * x: altitude (m) of the valley floor, y: metres over which the haze halves (0: off, as in the arcade).
 * Patched into three's fog chunks at import, so every fogged material gets it; the uniform is handed over in
 * onBeforeCompile (a material with its own hook calls addHeightFog; without the uniform the haze is simply off).
 * The same hook adds the relief's shadows to every lit material (RELIEF).
 */
export const HEIGHT_FOG = { value: new Vector2(0, 0) };

/**
 * The haze takes the sky's colour in its direction (set by Sky every time of day): fogColor towards the sun, fogAway
 * on the far side, fogHaze (bluer) where it is still thin, so distance reads as depth and not as a flat wall.
 * fogSun (xz towards the sun, unit) stays 0 without a sky: the haze is then the plain fogColor.
 */
export const FOG_SKY = {
  fogAway: { value: new Color() },
  fogHaze: { value: new Color() },
  fogSun: { value: new Vector2(0, 0) },
};

/**
 * Shadows of the relief (worked out on the CPU, see MountainView): a texture over the massif, 1 lit / 0 in a ridge's
 * shadow, that scales the sun's direct light of every lit material. Off (uReliefOn 0) without a mountain.
 */
export const RELIEF = {
  uRelief: { value: new DataTexture(new Uint8Array([255]), 1, 1, RedFormat) as Texture },
  uReliefRect: { value: new Vector4(0, 0, 1, 1) }, // x0, z0 of the texture, 1 / its width, 1 / its depth (m)
  uReliefOn: { value: 0 },
};

export function addHeightFog(sh: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }): void {
  sh.uniforms.heightFog = HEIGHT_FOG;
  Object.assign(sh.uniforms, FOG_SKY);
  if (!sh.fragmentShader.includes('#include <lights_fragment_end>')) return; // unlit (basic, shader materials)
  Object.assign(sh.uniforms, RELIEF);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vReliefW;')
    .replace('#include <project_vertex>', `#include <project_vertex>
    vReliefW = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xz + cameraPosition.xz; // world xz (see fog_vertex)`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vReliefW;\nuniform sampler2D uRelief;\nuniform vec4 uReliefRect;\nuniform float uReliefOn;')
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    if (uReliefOn > 0.5) {
      vec2 ruv = (vReliefW - uReliefRect.xy) * uReliefRect.zw;
      if (ruv.x > 0.0 && ruv.y > 0.0 && ruv.x < 1.0 && ruv.y < 1.0) reflectedLight.directDiffuse *= texture2D(uRelief, ruv).r;
    }`);
}
Material.prototype.onBeforeCompile = addHeightFog;

ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogW;
#endif`;
ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world height from the view-space position (every shader has mvPosition, sprites have no 'transformed'):
  // world = transpose(view rotation) × view position + camera position; instancing is already in mvPosition
  vFogW = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz; // world offset from the camera (direction of the haze too)
#endif`;
ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec2 heightFog;
  uniform vec3 fogAway;
  uniform vec3 fogHaze;
  uniform vec2 fogSun;
  varying float vFogDepth;
  varying vec3 vFogW;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  if ( heightFog.y > 0.0 ) {
    float low = exp2( - max( vFogW.y + cameraPosition.y - heightFog.x, 0.0 ) / heightFog.y ); // 1 on the valley floor, 0.5 a half-height above
    fogFactor = max( fogFactor * mix( 0.6, 1.0, low ), smoothstep( 0.0, fogFar * 0.5, vFogDepth ) * low * 0.75 );
  }
  vec3 fogTint = fogColor;
  if ( dot( fogSun, fogSun ) > 0.0 ) {
    // the sky's horizon in this direction (same law as the dome), then bluer while the haze is still thin
    float toward = clamp( dot( normalize( vFogW.xz + 1e-4 ), fogSun ) * 0.5 + 0.5, 0.0, 1.0 );
    fogTint = mix( fogAway, fogColor, toward * sqrt( toward ) );
    fogTint = mix( fogHaze, fogTint, fogFactor );
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif`;
