/**
 * フィルム風ポストエフェクト。カメラに 1 枚かける。
 * 設計は docs/film-effect.md を参照。縦キズ（スクラッチ）は作為的に見えるため入れない。
 *
 * 時間は 1/FILM_FPS 秒に量子化して渡す。粒とゆらぎだけが古いコマ速で動くことで、
 * 「映像は滑らかなのに素材が古い」というカートゥーン特有の質感になる。
 */

import Phaser from 'phaser';
import { FILM_PRESETS, FILM_DEFAULT, FILM_FPS } from '../config';

const FRAG = `
#define SHADER_NAME BI_PLANES_FILM

precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBlur;
uniform float uSat;
uniform float uSepia;
uniform float uContrast;
uniform float uGrain;
uniform float uFlicker;
uniform float uWeave;
uniform float uHalo;

varying vec2 outTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/** ざらつき。時間で更新する */
float grainAt(vec2 uv) {
  return hash(uv * uResolution + vec2(uTime * 71.3, uTime * 39.7)) - 0.5;
}

/** 小さなブラー。線のくっきり感を殺して映写のにじみを出す */
vec3 softFocus(vec2 uv, float amount) {
  vec2 px = amount / uResolution;
  vec3 c = texture2D(uMainSampler, uv).rgb * 0.36;
  c += texture2D(uMainSampler, uv + vec2( px.x, 0.0)).rgb * 0.16;
  c += texture2D(uMainSampler, uv + vec2(-px.x, 0.0)).rgb * 0.16;
  c += texture2D(uMainSampler, uv + vec2(0.0,  px.y)).rgb * 0.16;
  c += texture2D(uMainSampler, uv + vec2(0.0, -px.y)).rgb * 0.16;
  return c;
}

void main() {
  vec2 uv = outTexCoord;

  // ゲートウィーブ: フィルムが映写機のゲートで暴れる揺れ。
  // 1px 未満で漂い、ときどき縦に飛ぶ
  float wob = sin(uTime * 3.1) * 0.5 + sin(uTime * 7.7) * 0.3 + sin(uTime * 1.3) * 0.2;
  float jump = step(0.985, hash(vec2(floor(uTime * 8.0), 3.0))) * (hash(vec2(floor(uTime * 8.0), 7.0)) - 0.5) * 5.0;
  uv += vec2(wob * 0.9, wob * 0.6 + jump) * uWeave / uResolution;

  vec3 col = uBlur > 0.001 ? softFocus(uv, uBlur) : texture2D(uMainSampler, uv).rgb;

  // ハレーション: 明るいところがにじんで発光する
  if (uHalo > 0.001) {
    vec2 px = 3.0 / uResolution;
    vec3 bloom = texture2D(uMainSampler, uv + px).rgb + texture2D(uMainSampler, uv - px).rgb
               + texture2D(uMainSampler, uv + vec2(px.x, -px.y)).rgb
               + texture2D(uMainSampler, uv + vec2(-px.x, px.y)).rgb;
    bloom *= 0.25;
    col += max(bloom - 0.72, 0.0) * uHalo * 0.55;
  }

  // 退色したフィルムの色
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat);
  vec3 sepia = vec3(lum * 1.07 + 0.03, lum * 0.95, lum * 0.78);
  col = mix(col, sepia, uSepia);
  col = (col - 0.5) * uContrast + 0.5;

  // 露光のゆらぎ
  col *= 1.0 + (hash(vec2(floor(uTime * 24.0), 11.0)) - 0.5) * 2.0 * uFlicker;

  // フィルムグレイン
  col += grainAt(outTexCoord) * uGrain * 0.55;

  // ビネット
  vec2 d = outTexCoord - 0.5;
  float vig = 1.0 - smoothstep(0.42, 0.78, dot(d, d) * 2.0) * 0.42;
  col *= vig;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class FilmPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private level = FILM_DEFAULT;
  private time = 0;

  constructor(game: Phaser.Game) {
    super({ game, name: 'Film', fragShader: FRAG } as never);
  }

  /** 0=切 1=弱 2=既定 3=標準 4=強 */
  setLevel(level: number): void {
    this.level = Phaser.Math.Clamp(level, 0, FILM_PRESETS.length - 1);
  }

  getLevel(): number {
    return this.level;
  }

  /** ゲーム側から毎フレーム呼ぶ。時間はコマ速に量子化する */
  advance(dt: number): void {
    this.time += dt;
  }

  override onPreRender(): void {
    const p = FILM_PRESETS[this.level];
    const quantized = Math.floor(this.time * FILM_FPS) / FILM_FPS;
    this.set2f('uResolution', this.renderer.width, this.renderer.height);
    this.set1f('uTime', quantized);
    this.set1f('uBlur', p.blur);
    this.set1f('uSat', p.sat);
    this.set1f('uSepia', p.sepia);
    this.set1f('uContrast', p.contrast);
    this.set1f('uGrain', p.grain);
    this.set1f('uFlicker', p.flicker);
    this.set1f('uWeave', p.weave);
    this.set1f('uHalo', p.halo);
  }
}
