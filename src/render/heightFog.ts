import { Material, ShaderChunk, Vector2 } from 'three';

/**
 * Height haze on top of three's distance fog: valleys hazier, ridges standing clear above them.
 * x: altitude (m) of the valley floor, y: metres over which the haze halves (0: off, as in the arcade).
 * Patched into three's fog chunks at import, so every fogged material gets it; the uniform is handed over in
 * onBeforeCompile (a material with its own hook calls addHeightFog; without the uniform the haze is simply off).
 */
export const HEIGHT_FOG = { value: new Vector2(0, 0) };

export function addHeightFog(sh: { uniforms: Record<string, unknown> }): void {
  sh.uniforms.heightFog = HEIGHT_FOG;
}
Material.prototype.onBeforeCompile = addHeightFog;

ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogY;
#endif`;
ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  #ifdef USE_INSTANCING
    vFogY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
  #else
    vFogY = (modelMatrix * vec4(transformed, 1.0)).y;
  #endif
#endif`;
ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec2 heightFog;
  varying float vFogDepth;
  varying float vFogY;
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
    float low = exp2( - max( vFogY - heightFog.x, 0.0 ) / heightFog.y ); // 1 on the valley floor, 0.5 a half-height above
    fogFactor = max( fogFactor * mix( 0.6, 1.0, low ), smoothstep( 0.0, fogFar * 0.5, vFogDepth ) * low * 0.75 );
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
