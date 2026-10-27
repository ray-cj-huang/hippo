"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CallStatus } from "@/lib/use-call";

const COLORS: Record<CallStatus, string> = {
  idle: "#94a3b8",
  connecting: "#94a3b8",
  listening: "#14b8a6",
  thinking: "#f59e0b",
  speaking: "#6366f1",
  ended: "#94a3b8",
  error: "#ef4444",
};

const vertexShader = `
  uniform float uTime;
  uniform float uLevel;
  varying vec3 vNormal;
  varying float vWave;
  void main() {
    vec3 p = position;
    float wave = sin(p.x * 4.0 + uTime * 1.7) * sin(p.y * 5.0 + uTime * 1.3) * sin(p.z * 3.0 + uTime);
    float amp = 0.03 + uLevel * 0.22;
    p += normal * wave * amp;
    vWave = wave;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying float vWave;
  void main() {
    float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
    vec3 color = mix(uColor * 0.55, uColor, 0.5 + vWave * 0.5) + rim * 0.35;
    gl_FragColor = vec4(color, 0.95);
  }
`;

type OrbProps = { status: CallStatus; level: () => number };

export function Orb({ status, level }: OrbProps) {
  const mount = useRef<HTMLDivElement>(null);
  const statusRef = useRef(status);
  const levelRef = useRef(level);
  statusRef.current = status;
  levelRef.current = level;

  useEffect(() => {
    const el = mount.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    camera.position.z = 4;

    const uniforms = {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uColor: { value: new THREE.Color(COLORS[statusRef.current]) },
    };
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 48),
      new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true }),
    );
    scene.add(mesh);

    const resize = () => {
      const size = el.clientWidth;
      renderer.setSize(size, size);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const target = new THREE.Color();
    const started = performance.now();
    let frame = 0;
    const tick = () => {
      const t = (performance.now() - started) / 1000;
      const current = statusRef.current;
      const pulse = current === "thinking" ? 0.08 + Math.sin(t * 4) * 0.05 : 0;
      const live = Math.min(levelRef.current() * 3, 1);
      uniforms.uTime.value = t;
      uniforms.uLevel.value += (Math.max(live, pulse) - uniforms.uLevel.value) * 0.15;
      uniforms.uColor.value.lerp(target.set(COLORS[current]), 0.06);
      mesh.rotation.y = t * 0.15;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mount} className="aspect-square w-full max-w-[220px]" data-testid="orb" />;
}
