import * as THREE from "three";

/**
 * Helper to check WebGL availability before instantiating renderer.
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export interface Tutorial3DSceneOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  initialStep?: number;
  isReducedMotion?: boolean;
}

export class Tutorial3DScene {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private animationFrameId: number | null = null;
  private isDestroyed = false;

  // Step groups
  private stepGroups: Map<number, THREE.Group> = new Map();
  private currentStep: number = 1;

  // Background particles & grid
  private particlesMesh: THREE.Points | null = null;

  // Camera Orbit State (Spherical coordinates)
  private defaultRadius = 14;
  private defaultTheta = Math.PI * 0.25;
  private defaultPhi = Math.PI * 0.35;

  private currentRadius = 14;
  private targetRadius = 14;
  private currentTheta = Math.PI * 0.25;
  private targetTheta = Math.PI * 0.25;
  private currentPhi = Math.PI * 0.35;
  private targetPhi = Math.PI * 0.35;

  private targetLookAt = new THREE.Vector3(0, 0, 0);
  private currentLookAt = new THREE.Vector3(0, 0, 0);

  // Behavior flags
  public isAutoRotatePaused: boolean = false;
  public isReducedMotion: boolean = false;

  constructor(options: Tutorial3DSceneOptions) {
    this.canvas = options.canvas;
    this.isReducedMotion = !!options.isReducedMotion;
    this.currentStep = options.initialStep ?? 1;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x090d16, 0.035);

    // 2. Camera setup
    const aspect = options.width / Math.max(1, options.height);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.updateCameraPosition(true);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(options.width, options.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // 4. Lights
    this.setupLighting();

    // 5. Environment & Particles
    this.setupEnvironment();

    // 6. Build 3D objects for all 4 tutorial steps
    this.buildStep1Objects();
    this.buildStep2Objects();
    this.buildStep3Objects();
    this.buildStep4Objects();

    // Apply initial step visibility
    this.setStep(this.currentStep, true);

    // 7. Start render loop
    this.animate = this.animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0x334155, 1.2);
    this.scene.add(ambientLight);

    const cyanLight = new THREE.PointLight(0x06b6d4, 3, 30);
    cyanLight.position.set(5, 8, 5);
    this.scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xa855f7, 2.5, 30);
    magentaLight.position.set(-6, 6, -5);
    this.scene.add(magentaLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(0, 15, 10);
    this.scene.add(dirLight);
  }

  private setupEnvironment(): void {
    // Holographic floor grid
    const gridHelper = new THREE.GridHelper(24, 24, 0x06b6d4, 0x1e293b);
    gridHelper.position.y = -2.5;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.35;
    this.scene.add(gridHelper);

    // Starfield / floating particles
    const particleCount = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 30;
      positions[i + 1] = (Math.random() - 0.5) * 20;
      positions[i + 2] = (Math.random() - 0.5) * 30;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.12,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    this.particlesMesh = new THREE.Points(geometry, material);
    this.scene.add(this.particlesMesh);
  }

  // --- Step 1: Benchmark & Custom Index Crystals ---
  private buildStep1Objects(): void {
    const group = new THREE.Group();
    group.name = "step1";

    // Custom Index Orb (Cyan)
    const customGeo = new THREE.IcosahedronGeometry(1.4, 2);
    const customMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.8,
      wireframe: false,
    });
    const customMesh = new THREE.Mesh(customGeo, customMat);
    customMesh.position.set(-2.5, 0.8, 0);
    customMesh.name = "customOrb";
    group.add(customMesh);

    // Benchmark Orb (Magenta)
    const bmGeo = new THREE.OctahedronGeometry(1.2, 2);
    const bmMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0x9333ea,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.7,
    });
    const bmMesh = new THREE.Mesh(bmGeo, bmMat);
    bmMesh.position.set(2.5, 0.2, 0);
    bmMesh.name = "bmOrb";
    group.add(bmMesh);

    // Glowing orbital ring
    const ringGeo = new THREE.TorusGeometry(3.8, 0.05, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.4,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI * 0.5;
    group.add(ringMesh);

    this.scene.add(group);
    this.stepGroups.set(1, group);
  }

  // --- Step 2: Constituents & Weighting 3D Ring ---
  private buildStep2Objects(): void {
    const group = new THREE.Group();
    group.name = "step2";

    // Create 6 cylindrical bars arranged in a circle representing sector weights
    const sectorColors = [0x06b6d4, 0x38bdf8, 0xa855f7, 0xc084fc, 0x10b981, 0xeab308];
    const heights = [3.2, 2.4, 2.8, 1.8, 2.0, 1.5];
    const count = sectorColors.length;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 3.0;
      const height = heights[i];
      const geo = new THREE.CylinderGeometry(0.5, 0.5, height, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: sectorColors[i],
        emissive: sectorColors[i],
        emissiveIntensity: 0.35,
        roughness: 0.25,
        metalness: 0.7,
      });
      const cylinder = new THREE.Mesh(geo, mat);
      cylinder.position.set(
        Math.cos(angle) * radius,
        height / 2 - 1.2,
        Math.sin(angle) * radius,
      );
      group.add(cylinder);
    }

    // Inner core sphere
    const coreGeo = new THREE.SphereGeometry(0.8, 24, 24);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.8,
      roughness: 0.1,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 0, 0);
    group.add(coreMesh);

    this.scene.add(group);
    this.stepGroups.set(2, group);
  }

  // --- Step 3: Risk Surface & Volatility Landscape ---
  private buildStep3Objects(): void {
    const group = new THREE.Group();
    group.name = "step3";

    // 3D Wireframe surface representing risk/return landscape
    const gridX = 14;
    const gridY = 14;
    const planeGeo = new THREE.PlaneGeometry(6.5, 6.5, gridX, gridY);
    const pos = planeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = Math.sin(x * 1.2) * Math.cos(y * 1.2) * 0.9;
      pos.setZ(i, z);
    }
    planeGeo.computeVertexNormals();

    const planeMat = new THREE.MeshStandardMaterial({
      color: 0x0891b2,
      emissive: 0xa855f7,
      emissiveIntensity: 0.25,
      wireframe: true,
      roughness: 0.3,
    });
    const surfaceMesh = new THREE.Mesh(planeGeo, planeMat);
    surfaceMesh.rotation.x = -Math.PI * 0.4;
    surfaceMesh.position.y = 0.2;
    group.add(surfaceMesh);

    // Peak markers (Sharpe Ratio high points)
    const peakGeo = new THREE.ConeGeometry(0.35, 1.2, 16);
    const peakMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.6,
    });
    const peak = new THREE.Mesh(peakGeo, peakMat);
    peak.position.set(1.5, 1.6, 0.5);
    group.add(peak);

    this.scene.add(group);
    this.stepGroups.set(3, group);
  }

  // --- Step 4: Index Builder Assembling Cubes ---
  private buildStep4Objects(): void {
    const group = new THREE.Group();
    group.name = "step4";

    // Dynamic assembling cluster of modular stock cubes
    const cubeOffsets = [
      [-1.2, -1.2, -1.2],
      [1.2, -1.2, -1.2],
      [-1.2, 1.2, -1.2],
      [1.2, 1.2, -1.2],
      [-1.2, -1.2, 1.2],
      [1.2, -1.2, 1.2],
      [-1.2, 1.2, 1.2],
      [1.2, 1.2, 1.2],
      [0, 0, 0],
    ];

    cubeOffsets.forEach(([x, y, z], idx) => {
      const isCenter = idx === cubeOffsets.length - 1;
      const size = isCenter ? 1.4 : 0.85;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshStandardMaterial({
        color: isCenter ? 0xeab308 : 0x06b6d4,
        emissive: isCenter ? 0xf59e0b : 0x0284c7,
        emissiveIntensity: isCenter ? 0.7 : 0.3,
        roughness: 0.2,
        metalness: 0.8,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      group.add(mesh);
    });

    this.scene.add(group);
    this.stepGroups.set(4, group);
  }

  /**
   * Switches active step view with smooth transition.
   */
  public setStep(step: number, immediate: boolean = false): void {
    this.currentStep = Math.max(1, Math.min(4, step));

    this.stepGroups.forEach((group, id) => {
      const isActive = id === this.currentStep;
      if (immediate || this.isReducedMotion) {
        group.visible = isActive;
        group.scale.setScalar(isActive ? 1 : 0.001);
      } else {
        group.visible = true; // Handled dynamically in animate loop
      }
    });

    // Step-specific camera target focus
    switch (this.currentStep) {
      case 1:
        this.targetLookAt.set(0, 0.4, 0);
        this.targetRadius = 13.5;
        this.targetPhi = Math.PI * 0.38;
        break;
      case 2:
        this.targetLookAt.set(0, 0.2, 0);
        this.targetRadius = 14;
        this.targetPhi = Math.PI * 0.3;
        break;
      case 3:
        this.targetLookAt.set(0, 0.5, 0);
        this.targetRadius = 13;
        this.targetPhi = Math.PI * 0.26;
        break;
      case 4:
        this.targetLookAt.set(0, 0.2, 0);
        this.targetRadius = 12.5;
        this.targetPhi = Math.PI * 0.35;
        break;
    }

    if (immediate || this.isReducedMotion) {
      this.currentRadius = this.targetRadius;
      this.currentPhi = this.targetPhi;
      this.currentLookAt.copy(this.targetLookAt);
      this.updateCameraPosition(true);
    }
  }

  /**
   * Keyboard / Mouse Camera Orbit Controls.
   */
  public rotateCamera(deltaTheta: number, deltaPhi: number): void {
    this.targetTheta += deltaTheta;
    this.targetPhi = Math.max(0.1, Math.min(Math.PI * 0.48, this.targetPhi + deltaPhi));
    if (this.isReducedMotion) {
      this.currentTheta = this.targetTheta;
      this.currentPhi = this.targetPhi;
      this.updateCameraPosition();
    }
  }

  public zoomCamera(deltaRadius: number): void {
    this.targetRadius = Math.max(7, Math.min(22, this.targetRadius + deltaRadius));
    if (this.isReducedMotion) {
      this.currentRadius = this.targetRadius;
      this.updateCameraPosition();
    }
  }

  public resetCamera(): void {
    this.targetRadius = this.defaultRadius;
    this.targetTheta = this.defaultTheta;
    this.targetPhi = this.defaultPhi;
    this.targetLookAt.set(0, 0, 0);

    if (this.isReducedMotion) {
      this.currentRadius = this.defaultRadius;
      this.currentTheta = this.defaultTheta;
      this.currentPhi = this.defaultPhi;
      this.currentLookAt.set(0, 0, 0);
      this.updateCameraPosition();
    }
  }

  public toggleAutoRotate(paused?: boolean): boolean {
    this.isAutoRotatePaused = paused !== undefined ? paused : !this.isAutoRotatePaused;
    return this.isAutoRotatePaused;
  }

  public setReducedMotion(enabled: boolean): void {
    this.isReducedMotion = enabled;
    if (enabled) {
      this.isAutoRotatePaused = true;
      this.currentRadius = this.targetRadius;
      this.currentTheta = this.targetTheta;
      this.currentPhi = this.targetPhi;
      this.currentLookAt.copy(this.targetLookAt);
      this.updateCameraPosition();
    }
  }

  private updateCameraPosition(force: boolean = false): void {
    const lerpRate = this.isReducedMotion || force ? 1 : 0.08;
    this.currentRadius += (this.targetRadius - this.currentRadius) * lerpRate;
    this.currentTheta += (this.targetTheta - this.currentTheta) * lerpRate;
    this.currentPhi += (this.targetPhi - this.currentPhi) * lerpRate;
    this.currentLookAt.lerp(this.targetLookAt, lerpRate);

    const x = this.currentRadius * Math.sin(this.currentPhi) * Math.sin(this.currentTheta);
    const y = this.currentRadius * Math.cos(this.currentPhi);
    const z = this.currentRadius * Math.sin(this.currentPhi) * Math.cos(this.currentTheta);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Main animation loop.
   */
  private animate(timestamp: number): void {
    if (this.isDestroyed) return;

    // 1. Auto-rotation if enabled
    if (!this.isAutoRotatePaused && !this.isReducedMotion) {
      this.targetTheta += 0.003;
    }

    // 2. Camera positioning
    this.updateCameraPosition();

    // 3. Step groups transitions and subtle idle animations
    const t = timestamp * 0.001;

    this.stepGroups.forEach((group, id) => {
      const isActive = id === this.currentStep;
      const targetScale = isActive ? 1 : 0.001;
      const lerpScale = this.isReducedMotion ? 1 : 0.09;

      const newScale = group.scale.x + (targetScale - group.scale.x) * lerpScale;
      group.scale.setScalar(newScale);
      group.visible = newScale > 0.02;

      // Group-specific micro animations when active and not reduced motion
      if (isActive && !this.isReducedMotion) {
        if (id === 1) {
          group.rotation.y = t * 0.2;
          const orb = group.getObjectByName("customOrb");
          if (orb) orb.position.y = 0.8 + Math.sin(t * 1.5) * 0.2;
        } else if (id === 2) {
          group.rotation.y = -t * 0.15;
        } else if (id === 3) {
          group.rotation.z = Math.sin(t * 0.5) * 0.05;
        } else if (id === 4) {
          group.rotation.y = t * 0.25;
          group.rotation.x = Math.sin(t * 0.8) * 0.1;
        }
      }
    });

    // 4. Starfield gentle motion
    if (this.particlesMesh && !this.isReducedMotion) {
      this.particlesMesh.rotation.y = t * 0.02;
    }

    // 5. Render
    this.renderer.render(this.scene, this.camera);

    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  /**
   * Resize viewport handling.
   */
  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0 || this.isDestroyed) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Dispose all WebGL resources and stop animation loop.
   */
  public destroy(): void {
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    this.stepGroups.clear();
  }
}
