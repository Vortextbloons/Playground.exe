import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BLOCK_HEIGHT, BLOCK_LENGTH, BLOCK_WIDTH, BLOCK_COUNT, LEVEL_COUNT, TABLE_SIZE } from './layout';
import type { BlockPose } from './physics';

export interface Quality {
  shadows: boolean;
  shadowSize: number;
  dpr: number;
  antialias: boolean;
}

export const QUALITY_LEVELS: Record<'high' | 'low', Quality> = {
  high: { shadows: true, shadowSize: 2048, dpr: 2, antialias: true },
  low: { shadows: false, shadowSize: 512, dpr: 1.25, antialias: false },
};

export interface Scene3D {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  syncPoses(poses: readonly BlockPose[]): void;
  highlight(index: number | null, legal: boolean): void;
  showGuide(visible: boolean, y: number, yaw: number): void;
  shake(strength: number): void;
  setQuality(quality: Quality): void;
  update(dt: number): void;
  render(): void;
  resize(): void;
  dispose(): void;
  orbit: { rotate(dx: number, dy: number): void; zoom(delta: number): void };
}

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#caa075';
  context.fillRect(0, 0, 256, 128);
  for (let line = 0; line < 240; line++) {
    const y = Math.random() * 128;
    context.strokeStyle = `rgba(${90 + Math.random() * 50 | 0}, ${58 + Math.random() * 34 | 0}, ${28 + Math.random() * 28 | 0}, ${0.04 + Math.random() * 0.12})`;
    context.lineWidth = 0.5 + Math.random() * 1.6;
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) context.lineTo(x, y + Math.sin(x * 0.06 + line) * 1.8);
    context.stroke();
  }
  context.fillStyle = 'rgba(255, 236, 200, 0.05)';
  context.fillRect(0, 0, 256, 40);
  context.fillStyle = 'rgba(40, 22, 8, 0.06)';
  context.fillRect(0, 92, 256, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createScene(canvas: HTMLCanvasElement, quality: Quality): Scene3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11151b);
  scene.fog = new THREE.Fog(0x11151b, 10, 20);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 60);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2c2b34, 0.65));
  const key = new THREE.DirectionalLight(0xfff1dd, 2.6);
  key.position.set(2.6, 5.6, 3.1);
  key.castShadow = true;
  key.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  const extent = 2.4;
  key.shadow.camera.left = -extent;
  key.shadow.camera.right = extent;
  key.shadow.camera.top = extent;
  key.shadow.camera.bottom = -extent;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.5);
  fill.position.set(-3.2, 2.4, -2.6);
  scene.add(fill);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_SIZE, 0.5, TABLE_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.93, metalness: 0.02 }),
  );
  table.position.set(0, -0.25, 0);
  table.receiveShadow = true;
  scene.add(table);

  const material = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.68, metalness: 0.02 });
  const mesh = new THREE.InstancedMesh(
    new RoundedBoxGeometry(BLOCK_LENGTH, BLOCK_HEIGHT, BLOCK_WIDTH, 2, 0.014),
    material,
    BLOCK_COUNT,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const baseTints: THREE.Color[] = [];
  const color = new THREE.Color();
  for (let index = 0; index < BLOCK_COUNT; index++) {
    const level = Math.floor(index / 3);
    color.setHSL(0.085 + Math.random() * 0.02, 0.42 + Math.random() * 0.1, 0.56 + Math.random() * 0.09 - (level % 2) * 0.015);
    baseTints.push(color.clone());
    mesh.setColorAt(index, color);
  }
  mesh.instanceColor!.needsUpdate = true;

  const guide = new THREE.Group();
  const guideSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(0.79, 0.79),
    new THREE.MeshBasicMaterial({ color: 0x8ef0c8, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
  );
  guideSurface.rotation.x = -Math.PI / 2;
  const guideEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.79, 0.79)),
    new THREE.LineBasicMaterial({ color: 0x8ef0c8, transparent: true, opacity: 0.55 }),
  );
  guideEdges.rotation.x = -Math.PI / 2;
  guide.add(guideSurface, guideEdges);
  guide.visible = false;
  scene.add(guide);

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  const orbit = { theta: 0.78, phi: 1.18, radius: 3.6, targetTheta: 0.78, targetPhi: 1.18, targetRadius: 3.6 };
  const focus = new THREE.Vector3(0, LEVEL_COUNT * BLOCK_HEIGHT * 0.52, 0);
  let trauma = 0;
  let lastHighlight = -2;
  let lastLegal = true;

  function applyHighlight(index: number, legal: boolean) {
    if (index < 0 || index >= BLOCK_COUNT) return;
    const base = baseTints[index]!;
    tint.copy(base);
    if (legal) tint.offsetHSL(0.01, 0.05, 0.16);
    else tint.setRGB(0.55, 0.12, 0.1).lerp(base, 0.35);
    mesh.setColorAt(index, tint);
    mesh.instanceColor!.needsUpdate = true;
  }

  function restore(index: number) {
    if (index < 0 || index >= BLOCK_COUNT) return;
    mesh.setColorAt(index, baseTints[index]!);
    mesh.instanceColor!.needsUpdate = true;
  }

  return {
    renderer,
    camera,
    orbit: {
      rotate(dx, dy) {
        orbit.targetTheta -= dx * 0.0062;
        orbit.targetPhi = Math.min(Math.max(orbit.targetPhi - dy * 0.0055, 0.34), 1.46);
      },
      zoom(delta) {
        orbit.targetRadius = Math.min(Math.max(orbit.targetRadius * (1 + delta * 0.0013), 1.9), 7.5);
      },
    },
    syncPoses(poses) {
      for (let index = 0; index < poses.length; index++) {
        const pose = poses[index]!;
        dummy.position.set(pose.x, pose.y, pose.z);
        dummy.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    highlight(index, legal) {
      if (index === lastHighlight && legal === lastLegal) return;
      restore(lastHighlight);
      lastHighlight = index ?? -1;
      lastLegal = legal;
      if (lastHighlight >= 0) applyHighlight(lastHighlight, legal);
    },
    showGuide(visible, y, yaw) {
      guide.visible = visible;
      guide.position.set(0, y, 0);
      guide.rotation.y = yaw;
    },
    shake(strength) {
      trauma = Math.min(trauma + strength, 1);
    },
    setQuality(next) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, next.dpr));
      renderer.shadowMap.enabled = next.shadows;
      key.castShadow = next.shadows;
      key.shadow.mapSize.set(next.shadowSize, next.shadowSize);
      key.shadow.dispose();
    },
    update(dt) {
      orbit.theta += (orbit.targetTheta - orbit.theta) * Math.min(dt * 9, 1);
      orbit.phi += (orbit.targetPhi - orbit.phi) * Math.min(dt * 9, 1);
      orbit.radius += (orbit.targetRadius - orbit.radius) * Math.min(dt * 9, 1);
      trauma = Math.max(trauma - dt * 1.4, 0);
      const swing = trauma * trauma;
      camera.position.set(
        focus.x + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta) + swing * 0.09 * (Math.random() - 0.5),
        focus.y + orbit.radius * Math.cos(orbit.phi) + swing * 0.09 * (Math.random() - 0.5),
        focus.z + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta) + swing * 0.09 * (Math.random() - 0.5),
      );
      camera.lookAt(focus);
      focus.y += (LEVEL_COUNT * BLOCK_HEIGHT * 0.52 - focus.y) * Math.min(dt * 2, 1);
    },
    render() {
      renderer.render(scene, camera);
    },
    resize() {
      const width = canvas.clientWidth || 960;
      const height = canvas.clientHeight || 540;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      mesh.geometry.dispose();
      material.map?.dispose();
      material.dispose();
      table.geometry.dispose();
      (table.material as THREE.Material).dispose();
      guideSurface.geometry.dispose();
      (guideSurface.material as THREE.Material).dispose();
      guideEdges.geometry.dispose();
      (guideEdges.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}

export function towerTopHeight(): number {
  return LEVEL_COUNT * BLOCK_HEIGHT;
}
