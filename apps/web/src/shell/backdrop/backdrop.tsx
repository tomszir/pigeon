// The dark room behind the monitor, as a WebGL fragment shader: the screen's light falling faintly
// on a room you can't see, uneven and breathing slightly. It renders at half the
// window's size at a steady 30 frames a second, pauses with the tab, draws one still frame when
// motion is reduced, and leaves plain black where WebGL isn't available.
import { createEffect, onCleanup, onMount } from 'solid-js'
import styles from './backdrop.module.css'

/** Render at half the window's size: soft enough to scale up smoothly, fine enough not to step. */
const DOWNSCALE = 2

/** The light moves slowly, so 30 steady frames a second look smoother than 60 that drop. */
const FRAME_MS = 1000 / 30

const VERTEX = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform float time;
uniform vec4 monitor; // x, y, width, height in pixels, y up

// A hash without sin(), which loses precision and breaks into blocks on many GPUs.
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

// How much of the screen's light reaches p: strong at the monitor's edge, fading into the room,
// uneven like light bouncing off surfaces you can't see, and breathing very slightly.
float light(vec2 p, vec2 centre, vec2 extent) {
  vec2 edge = abs(p - centre) - extent;
  float outside = length(max(edge, 0.0));
  float near = exp(-outside * 6.0);
  float far = exp(-outside * 1.6) * 0.35;
  float uneven = 0.85 + 0.3 * fbm(p * 1.6 + vec2(time * 0.01, 0.0));
  float breath = 0.97 + 0.03 * sin(time * 0.7) * sin(time * 0.23);
  return (near + far) * uneven * breath;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * resolution) / resolution.y;
  vec2 centre = (monitor.xy + 0.5 * monitor.zw - 0.5 * resolution) / resolution.y;
  vec2 extent = 0.5 * monitor.zw / resolution.y;

  // The room: black, and faintly lit by the screen in a cool white, like a tube at 6500 K.
  vec3 colour = vec3(0.002) + vec3(0.055, 0.057, 0.062) * light(p, centre, extent);

  colour *= smoothstep(1.4, 0.25, length(p - centre * 0.5));
  // A still dither, so the dark gradients don't band; it doesn't move, so it doesn't flicker.
  colour += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(colour, 1.0);
}
`

export interface BackdropProps {
  /** Where the monitor sits, in CSS pixels from the top left, so the glow can surround it. */
  monitor: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
  /** Draw one still frame instead of animating. */
  still: boolean
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader
  // Without this a broken shader just leaves the room black.
  if (import.meta.env.DEV) console.warn('backdrop shader:', gl.getShaderInfoLog(shader))
  return null
}

export function Backdrop(props: BackdropProps) {
  let canvas: HTMLCanvasElement | undefined
  let frame = 0
  let draw: (() => void) | undefined

  onMount(() => {
    const gl = canvas?.getContext('webgl', { antialias: false, depth: false, alpha: false })
    if (canvas === undefined || gl === null || gl === undefined) return
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()
    if (vertex === null || fragment === null || program === null) return
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return
    gl.useProgram(program)

    // One triangle that covers the whole canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const resolution = gl.getUniformLocation(program, 'resolution')
    const time = gl.getUniformLocation(program, 'time')
    const monitor = gl.getUniformLocation(program, 'monitor')
    const started = performance.now()
    const target = canvas

    draw = () => {
      const width = Math.max(1, Math.ceil(target.clientWidth / DOWNSCALE))
      const height = Math.max(1, Math.ceil(target.clientHeight / DOWNSCALE))
      if (target.width !== width || target.height !== height) {
        target.width = width
        target.height = height
        gl.viewport(0, 0, width, height)
      }
      const m = props.monitor
      gl.uniform2f(resolution, width, height)
      gl.uniform1f(time, props.still ? 40 : (performance.now() - started) / 1000)
      gl.uniform4f(
        monitor,
        m.left / DOWNSCALE,
        height - (m.top + m.height) / DOWNSCALE,
        m.width / DOWNSCALE,
        m.height / DOWNSCALE,
      )
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  })

  // Runs after the set-up above: animate, or draw one still frame and redraw it when the
  // monitor moves.
  createEffect(() => {
    void props.monitor.left
    void props.monitor.top
    void props.monitor.width
    void props.monitor.height
    cancelAnimationFrame(frame)
    if (props.still) draw?.()
    else {
      let last = 0
      const loop = (now: number) => {
        if (now - last >= FRAME_MS) {
          last = now
          draw?.()
        }
        frame = requestAnimationFrame(loop)
      }
      if (draw !== undefined) frame = requestAnimationFrame(loop)
    }
  })

  onCleanup(() => cancelAnimationFrame(frame))

  return (
    <div class={styles.backdrop} aria-hidden="true">
      <canvas ref={canvas} class={styles.canvas} />
    </div>
  )
}
