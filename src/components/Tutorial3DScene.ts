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
  private starfieldFar: THREE.Points | null = null;
  private dataDustNear: THREE.Points | null = null;
  private gridPlate: THREE.GridHelper | null = null;

  // Dynamic animation object handles
  private step1DataRibbon: THREE.Mesh | null = null;
  private step1BmRibbon: THREE.Mesh | null = null;
  private step1Pillars: THREE.Mesh[] = [];
  private step2SectorArcs: THREE.Mesh[] = [];
  private step2CoreMesh: THREE.Mesh | null = null;
  private step2OrbitNodes: THREE.Mesh[] = [];
  private step3HeatmapBars: THREE.Mesh[] = [];
  private step3Beacon: THREE.Mesh | null = null;
  private step4Blocks: { mesh: THREE.Mesh; targetPos: THREE.Vector3; initialPos: THREE.Vector3 }[] = [];
  private step4CoreEnergyRing: THREE.Mesh | null = null;

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
    this.scene.fog = new THREE.FogExp2(0x060913, 0.03);

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

    // 6. Build Rich 3D objects for all 4 tutorial steps
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
    const ambientLight = new THREE.AmbientLight(0x1e293b, 1.8);
    this.scene.add(ambientLight);

    // Primary Cyan glow light
    const cyanLight = new THREE.PointLight(0x00e5ff, 3.8, 35);
    cyanLight.position.set(6, 9, 6);
    this.scene.add(cyanLight);

    // Secondary Violet/Magenta backlight
    const magentaLight = new THREE.PointLight(0xa855f7, 3.2, 35);
    magentaLight.position.set(-7, 7, -6);
    this.scene.add(magentaLight);

    // Warm accent light (Gold/Amber)
    const amberLight = new THREE.PointLight(0xf59e0b, 2.5, 25);
    amberLight.position.set(0, -3, 8);
    this.scene.add(amberLight);

    // Key directional light with soft specular
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(2, 16, 12);
    this.scene.add(dirLight);
  }

  private setupEnvironment(): void {
    // 1. Futuristic Holographic floor grid
    const gridHelper = new THREE.GridHelper(26, 26, 0x00e5ff, 0x1e293b);
    gridHelper.position.y = -3.2;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.35;
    this.gridPlate = gridHelper;
    this.scene.add(gridHelper);

    // 2. Far Starfield Particles (Deep blue/cyan cosmic background)
    const farCount = 280;
    const farPositions = new Float32Array(farCount * 3);
    for (let i = 0; i < farCount * 3; i += 3) {
      farPositions[i] = (Math.random() - 0.5) * 45;
      farPositions[i + 1] = (Math.random() - 0.5) * 35;
      farPositions[i + 2] = (Math.random() - 0.5) * 45;
    }
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute("position", new THREE.BufferAttribute(farPositions, 3));
    const farMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.14,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    this.starfieldFar = new THREE.Points(farGeo, farMat);
    this.scene.add(this.starfieldFar);

    // 3. Near Floating Data Dust (Luminous micro particles)
    const nearCount = 120;
    const nearPositions = new Float32Array(nearCount * 3);
    for (let i = 0; i < nearCount * 3; i += 3) {
      nearPositions[i] = (Math.random() - 0.5) * 20;
      nearPositions[i + 1] = (Math.random() - 0.5) * 14;
      nearPositions[i + 2] = (Math.random() - 0.5) * 20;
    }
    const nearGeo = new THREE.BufferGeometry();
    nearGeo.setAttribute("position", new THREE.BufferAttribute(nearPositions, 3));
    const nearMat = new THREE.PointsMaterial({
      color: 0xa855f7,
      size: 0.18,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });
    this.dataDustNear = new THREE.Points(nearGeo, nearMat);
    this.scene.add(this.dataDustNear);
  }

  // =========================================================================
  // Step 1: 3D Financial Ribbon Wave & Benchmark Alpha Orbit
  // =========================================================================
  private buildStep1Objects(): void {
    const group = new THREE.Group();
    group.name = "step1";

    // 1. Base Reference Platform (Base 1000 level)
    const basePlaneGeo = new THREE.PlaneGeometry(10, 4, 10, 4);
    const basePlaneMat = new THREE.MeshBasicMaterial({
      color: 0x1e293b,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    const basePlane = new THREE.Mesh(basePlaneGeo, basePlaneMat);
    basePlane.rotation.x = -Math.PI * 0.5;
    basePlane.position.y = -0.5;
    group.add(basePlane);

    // 2. Custom Index 3D Ribbon (Cyan - Outperforming Wave Curve)
    const customPoints: THREE.Vector3[] = [];
    const bmPoints: THREE.Vector3[] = [];
    const sampleCount = 36;
    for (let i = 0; i <= sampleCount; i++) {
      const u = i / sampleCount;
      const x = (u - 0.5) * 8.5;
      // Custom Index: dynamic upward growth with peaks
      const yCustom = Math.sin(u * Math.PI * 2.5) * 0.9 + u * 1.8 - 0.2;
      const zCustom = Math.cos(u * Math.PI * 1.8) * 0.8;
      customPoints.push(new THREE.Vector3(x, yCustom, zCustom));

      // Benchmark Index: modest baseline growth
      const yBm = Math.sin(u * Math.PI * 2.2) * 0.6 + u * 0.7 - 0.4;
      const zBm = Math.sin(u * Math.PI * 1.5) * 0.6 - 0.5;
      bmPoints.push(new THREE.Vector3(x, yBm, zBm));
    }

    const customCurve = new THREE.CatmullRomCurve3(customPoints);
    const customTubeGeo = new THREE.TubeGeometry(customCurve, 48, 0.16, 12, false);
    const customTubeMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x00a3cc,
      emissiveIntensity: 0.7,
      roughness: 0.15,
      metalness: 0.85,
    });
    const customTube = new THREE.Mesh(customTubeGeo, customTubeMat);
    group.add(customTube);
    this.step1DataRibbon = customTube;

    // Benchmark Tube (Purple/Muted Dash-like appearance)
    const bmCurve = new THREE.CatmullRomCurve3(bmPoints);
    const bmTubeGeo = new THREE.TubeGeometry(bmCurve, 48, 0.11, 10, false);
    const bmTubeMat = new THREE.MeshStandardMaterial({
      color: 0xa855f7,
      emissive: 0x7e22ce,
      emissiveIntensity: 0.5,
      roughness: 0.35,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
    });
    const bmTube = new THREE.Mesh(bmTubeGeo, bmTubeMat);
    group.add(bmTube);
    this.step1BmRibbon = bmTube;

    // 3. Alpha Gap Connectors (Luminous vertical beams connecting Custom vs Benchmark)
    const pillarIndices = [8, 16, 24, 32];
    this.step1Pillars = [];
    pillarIndices.forEach((idx) => {
      const p1 = customPoints[idx];
      const p2 = bmPoints[idx];
      const height = Math.abs(p1.y - p2.y);
      const midY = (p1.y + p2.y) / 2;
      const pillarGeo = new THREE.CylinderGeometry(0.04, 0.04, Math.max(0.2, height), 8);
      const pillarMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.5,
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(p1.x, midY, (p1.z + p2.z) / 2);
      group.add(pillar);
      this.step1Pillars.push(pillar);
    });

    // 4. Terminal Crystal Node (Custom Index Top Peak - Cyan Star)
    const topNode = customPoints[customPoints.length - 1];
    const nodeGeo = new THREE.IcosahedronGeometry(0.5, 2);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.85,
      roughness: 0.1,
      metalness: 0.9,
    });
    const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
    nodeMesh.position.copy(topNode);
    nodeMesh.name = "step1TopNode";
    group.add(nodeMesh);

    // Glowing orbital halo around terminal node
    const haloGeo = new THREE.TorusGeometry(0.85, 0.03, 16, 48);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.65,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(topNode);
    halo.rotation.x = Math.PI * 0.45;
    halo.name = "step1Halo";
    group.add(halo);

    this.scene.add(group);
    this.stepGroups.set(1, group);
  }

  // =========================================================================
  // Step 2: 3D Multi-Sector Allocation Pie Ring & Orbiting Stock Nodes
  // =========================================================================
  private buildStep2Objects(): void {
    const group = new THREE.Group();
    group.name = "step2";

    // 1. Central Quantum Index Core
    const coreGeo = new THREE.IcosahedronGeometry(1.2, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x0891b2,
      emissiveIntensity: 0.7,
      roughness: 0.15,
      metalness: 0.9,
      wireframe: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 0.4, 0);
    group.add(coreMesh);
    this.step2CoreMesh = coreMesh;

    // Core Wireframe Halo
    const coreWireGeo = new THREE.IcosahedronGeometry(1.4, 1);
    const coreWireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.4,
    });
    const coreWire = new THREE.Mesh(coreWireGeo, coreWireMat);
    coreMesh.add(coreWire);

    // 2. Multi-Sector 3D Extruded Pie Ring
    // Sector weights and color palette
    const sectors = [
      { name: "Tech / Semi", weight: 0.35, color: 0x00e5ff, height: 1.1 },
      { name: "Finance", weight: 0.22, color: 0x10b981, height: 0.85 },
      { name: "Consumer", weight: 0.18, color: 0xa855f7, height: 0.75 },
      { name: "Industrial", weight: 0.14, color: 0xf59e0b, height: 0.65 },
      { name: "Healthcare", weight: 0.11, color: 0xf43f5e, height: 0.55 },
    ];

    const innerRadius = 2.4;
    const outerRadius = 4.0;
    let startAngle = 0;
    this.step2SectorArcs = [];

    sectors.forEach((sec) => {
      const arcAngle = sec.weight * Math.PI * 2 * 0.94; // slight gap between sectors
      const shape = new THREE.Shape();
      const segments = 24;

      // Outer curve
      for (let s = 0; s <= segments; s++) {
        const theta = startAngle + (s / segments) * arcAngle;
        const x = Math.cos(theta) * outerRadius;
        const y = Math.sin(theta) * outerRadius;
        if (s === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      // Inner curve in reverse
      for (let s = segments; s >= 0; s--) {
        const theta = startAngle + (s / segments) * arcAngle;
        const x = Math.cos(theta) * innerRadius;
        const y = Math.sin(theta) * innerRadius;
        shape.lineTo(x, y);
      }
      shape.closePath();

      const extrudeSettings = {
        depth: sec.height,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.05,
        bevelThickness: 0.05,
      };

      const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const mat = new THREE.MeshStandardMaterial({
        color: sec.color,
        emissive: sec.color,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.7,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI * 0.5; // lay flat in X-Z plane
      mesh.position.y = -0.2;
      group.add(mesh);
      this.step2SectorArcs.push(mesh);

      // Light beam from core to sector center
      const midTheta = startAngle + arcAngle * 0.5;
      const beamTarget = new THREE.Vector3(
        Math.cos(midTheta) * (innerRadius + 0.3),
        0.3,
        Math.sin(midTheta) * (innerRadius + 0.3),
      );
      const beamLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.4, 0),
        beamTarget,
      ]);
      const beamLineMat = new THREE.LineBasicMaterial({
        color: sec.color,
        transparent: true,
        opacity: 0.45,
      });
      const beamLine = new THREE.Line(beamLineGeo, beamLineMat);
      group.add(beamLine);

      startAngle += sec.weight * Math.PI * 2;
    });

    // 3. Orbiting Constituent Stock Nodes (Floating satellite cubes)
    this.step2OrbitNodes = [];
    const nodeCount = 8;
    for (let i = 0; i < nodeCount; i++) {
      const angle = (i / nodeCount) * Math.PI * 2;
      const r = 4.8;
      const cubeGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      const cubeMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        roughness: 0.2,
      });
      const cube = new THREE.Mesh(cubeGeo, cubeMat);
      cube.position.set(Math.cos(angle) * r, 0.6 + Math.sin(i) * 0.4, Math.sin(angle) * r);
      group.add(cube);
      this.step2OrbitNodes.push(cube);
    }

    this.scene.add(group);
    this.stepGroups.set(2, group);
  }

  // =========================================================================
  // Step 3: Volatility Surface & Dynamic 3D Heatmap Matrix
  // =========================================================================
  private buildStep3Objects(): void {
    const group = new THREE.Group();
    group.name = "step3";

    // 1. Smooth 3D Volatility Landscape Surface (Risk / Return Curvature)
    const size = 8;
    const segments = 24;
    const planeGeo = new THREE.PlaneGeometry(size, size, segments, segments);
    const pos = planeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      // Volatility mountain with optimal Sharpe ridge
      const vz =
        Math.sin(vx * 0.8) * Math.cos(vy * 0.8) * 0.85 +
        Math.cos(vx * 0.5) * 0.4;
      pos.setZ(i, vz);
    }
    planeGeo.computeVertexNormals();

    const planeMat = new THREE.MeshStandardMaterial({
      color: 0x0d2847,
      emissive: 0x0284c7,
      emissiveIntensity: 0.2,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
    });
    const surfaceMesh = new THREE.Mesh(planeGeo, planeMat);
    surfaceMesh.rotation.x = -Math.PI * 0.42;
    surfaceMesh.position.y = -0.4;
    group.add(surfaceMesh);

    // Surface Wireframe Overlay for Cyberpunk/Fintech High-Tech Look
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const wireMesh = new THREE.Mesh(planeGeo, wireMat);
    wireMesh.rotation.x = surfaceMesh.rotation.x;
    wireMesh.position.copy(surfaceMesh.position);
    group.add(wireMesh);

    // 2. Dynamic 3D Theme Heatmap Blocks (Rising building-like data prisms)
    this.step3HeatmapBars = [];
    const gridDim = 5;
    const spacing = 1.3;
    const colors = [
      0x10b981, // Outperform (Green)
      0x34d399, // Moderate gain
      0x00e5ff, // Neutral Cyan
      0xf59e0b, // Mild risk
      0xf43f5e, // Drawdown (Rose)
    ];

    for (let r = 0; r < gridDim; r++) {
      for (let c = 0; c < gridDim; c++) {
        const x = (c - (gridDim - 1) / 2) * spacing;
        const z = (r - (gridDim - 1) / 2) * spacing * 0.9;
        const colorIdx = (r + c * 2) % colors.length;
        const col = colors[colorIdx];
        const height = 0.5 + Math.abs(Math.sin(r * 1.2 + c * 1.5)) * 1.8;

        const barGeo = new THREE.BoxGeometry(0.85, height, 0.85);
        const barMat = new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 0.45,
          roughness: 0.25,
          metalness: 0.7,
        });
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(x, height / 2 - 0.2, z);
        group.add(bar);
        this.step3HeatmapBars.push(bar);
      }
    }

    // 3. Optimum Sharpe Ratio Beacon (High-Peak Luminous Marker)
    const beaconGroup = new THREE.Group();
    const beaconGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.5, 12);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.75,
    });
    const beaconLight = new THREE.Mesh(beaconGeo, beaconMat);
    beaconGroup.add(beaconLight);

    const diamondGeo = new THREE.OctahedronGeometry(0.35, 1);
    const diamondMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x34d399,
      emissiveIntensity: 0.9,
    });
    const diamond = new THREE.Mesh(diamondGeo, diamondMat);
    diamond.position.y = 1.8;
    beaconGroup.add(diamond);

    beaconGroup.position.set(1.4, 1.2, -0.6);
    group.add(beaconGroup);
    this.step3Beacon = beaconGroup as unknown as THREE.Mesh;

    this.scene.add(group);
    this.stepGroups.set(3, group);
  }

  // =========================================================================
  // Step 4: Quantum Index Assembler & Block Build Engine
  // =========================================================================
  private buildStep4Objects(): void {
    const group = new THREE.Group();
    group.name = "step4";

    // 1. Golden Central Super-Index Core (The completed strategy)
    const coreGeo = new THREE.DodecahedronGeometry(1.3, 1);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.8,
      roughness: 0.15,
      metalness: 0.95,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 0.5, 0);
    group.add(coreMesh);

    // Glowing Pulse Rings around core
    const ringGeo = new THREE.TorusGeometry(2.4, 0.05, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.5,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI * 0.45;
    ringMesh.position.set(0, 0.5, 0);
    group.add(ringMesh);
    this.step4CoreEnergyRing = ringMesh;

    // 2. Assembling Stock Blocks (Matrix blocks floating and docking into the core)
    this.step4Blocks = [];
    const blockTargets = [
      new THREE.Vector3(-1.6, 0.5, 0),
      new THREE.Vector3(1.6, 0.5, 0),
      new THREE.Vector3(0, 2.1, 0),
      new THREE.Vector3(0, -1.1, 0),
      new THREE.Vector3(-1.1, 1.5, 1.1),
      new THREE.Vector3(1.1, 1.5, -1.1),
      new THREE.Vector3(-1.1, -0.6, -1.1),
      new THREE.Vector3(1.1, -0.6, 1.1),
      new THREE.Vector3(0, 0.5, 1.8),
      new THREE.Vector3(0, 0.5, -1.8),
    ];

    blockTargets.forEach((target, idx) => {
      const size = 0.65;
      const bGeo = new THREE.BoxGeometry(size, size, size);
      const isAlt = idx % 2 === 0;
      const bMat = new THREE.MeshStandardMaterial({
        color: isAlt ? 0x00e5ff : 0x10b981,
        emissive: isAlt ? 0x0891b2 : 0x059669,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(bGeo, bMat);

      // Add luminous wireframe edges
      const edges = new THREE.EdgesGeometry(bGeo);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
      );
      mesh.add(line);

      // Initial exploded position
      const initialPos = target.clone().multiplyScalar(2.6);
      initialPos.y += (Math.random() - 0.5) * 1.5;
      mesh.position.copy(initialPos);

      group.add(mesh);
      this.step4Blocks.push({ mesh, targetPos: target, initialPos });
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

    // Step-specific camera target focus & angles
    switch (this.currentStep) {
      case 1:
        this.targetLookAt.set(0, 0.4, 0);
        this.targetRadius = 13.5;
        this.targetPhi = Math.PI * 0.36;
        break;
      case 2:
        this.targetLookAt.set(0, 0.3, 0);
        this.targetRadius = 14.5;
        this.targetPhi = Math.PI * 0.28; // slightly steeper angle to view circular ring
        break;
      case 3:
        this.targetLookAt.set(0, 0.4, 0);
        this.targetRadius = 13.0;
        this.targetPhi = Math.PI * 0.32;
        break;
      case 4:
        this.targetLookAt.set(0, 0.5, 0);
        this.targetRadius = 13.0;
        this.targetPhi = Math.PI * 0.36;
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
      this.targetTheta += 0.0032;
    }

    // 2. Camera positioning
    this.updateCameraPosition();

    // 3. Step groups transitions and rich micro animations
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
          // Step 1: Subtle wave breathing & pulse
          group.rotation.y = Math.sin(t * 0.4) * 0.08;
          const topNode = group.getObjectByName("step1TopNode");
          const halo = group.getObjectByName("step1Halo");
          if (topNode) {
            topNode.rotation.y = t * 1.2;
            topNode.rotation.x = t * 0.8;
          }
          if (halo) {
            halo.rotation.z = t * 1.5;
            const scale = 1 + Math.sin(t * 3) * 0.12;
            halo.scale.set(scale, scale, 1);
          }
        } else if (id === 2) {
          // Step 2: Continuous smooth rotation of sector ring & orbiting satellites
          group.rotation.y = -t * 0.18;
          if (this.step2CoreMesh) {
            this.step2CoreMesh.rotation.y = t * 0.5;
            this.step2CoreMesh.rotation.z = Math.sin(t * 0.8) * 0.2;
          }
          this.step2OrbitNodes.forEach((node, i) => {
            const orbitAngle = t * 0.4 + (i / this.step2OrbitNodes.length) * Math.PI * 2;
            const r = 4.8;
            node.position.x = Math.cos(orbitAngle) * r;
            node.position.z = Math.sin(orbitAngle) * r;
            node.position.y = 0.5 + Math.sin(t * 2 + i) * 0.3;
            node.rotation.x = t * 1.5;
            node.rotation.y = t * 1.2;
          });
        } else if (id === 3) {
          // Step 3: Heatmap bars dynamic fluctuation (live market breathing)
          group.rotation.y = Math.sin(t * 0.2) * 0.1;
          this.step3HeatmapBars.forEach((bar, idx) => {
            const pulse = Math.sin(t * 2.5 + idx * 0.6) * 0.25;
            bar.scale.y = 1 + pulse;
          });
          if (this.step3Beacon) {
            this.step3Beacon.rotation.y = t * 1.8;
          }
        } else if (id === 4) {
          // Step 4: Quantum blocks smoothly docking towards the central core
          group.rotation.y = t * 0.15;
          const dockProgress = (Math.sin(t * 1.2) + 1) * 0.5; // 0 to 1 loop
          this.step4Blocks.forEach((item) => {
            item.mesh.position.lerpVectors(item.initialPos, item.targetPos, dockProgress);
            item.mesh.rotation.x = t * 0.8;
            item.mesh.rotation.y = t * 0.6;
          });
          if (this.step4CoreEnergyRing) {
            this.step4CoreEnergyRing.rotation.z = t * 2.0;
            const ringPulse = 1 + Math.sin(t * 4) * 0.08;
            this.step4CoreEnergyRing.scale.set(ringPulse, ringPulse, 1);
          }
        }
      }
    });

    // 4. Multi-layer starfield gentle motion
    if (!this.isReducedMotion) {
      if (this.starfieldFar) {
        this.starfieldFar.rotation.y = t * 0.015;
      }
      if (this.dataDustNear) {
        this.dataDustNear.rotation.y = -t * 0.025;
      }
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
      if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line) {
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
