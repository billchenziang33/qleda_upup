import { useEffect, useRef } from "react";

const palette = {
  green: 0x0f765e,
  greenDark: 0x073f34,
  mint: 0xdcefe3,
  gold: 0xd69a2d,
  paper: 0xfff9ea
};

export function IeltsBackgroundScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targetCanvas = canvas;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function startScene() {
      const THREE = await import("three");
      if (disposed) return;

      function createSoftMaterial(color: number, opacity: number) {
        return new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.NormalBlending
        });
      }

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas: targetCanvas,
        powerPreference: "low-power"
      });
      renderer.setClearAlpha(0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.z = 3;

      const group = new THREE.Group();
      scene.add(group);

      const pageGeometry = new THREE.PlaneGeometry(0.42, 0.56, 1, 1);
      const pages = [
        { x: -1.18, y: 0.48, rotation: -0.22, color: palette.paper, opacity: 0.34 },
        { x: 1.02, y: 0.28, rotation: 0.18, color: palette.mint, opacity: 0.28 },
        { x: -0.32, y: -0.5, rotation: 0.28, color: palette.paper, opacity: 0.24 },
        { x: 0.72, y: -0.66, rotation: -0.14, color: palette.gold, opacity: 0.16 }
      ];
      pages.forEach((page) => {
        const mesh = new THREE.Mesh(pageGeometry, createSoftMaterial(page.color, page.opacity));
        mesh.position.set(page.x, page.y, -0.3);
        mesh.rotation.z = page.rotation;
        group.add(mesh);
      });

      const ringGeometry = new THREE.RingGeometry(0.18, 0.188, 96);
      const rings = [
        { x: -0.94, y: -0.06, scale: 1.4, color: palette.green, opacity: 0.2 },
        { x: 1.08, y: -0.26, scale: 1.9, color: palette.gold, opacity: 0.16 },
        { x: 0.04, y: 0.62, scale: 1.18, color: palette.greenDark, opacity: 0.12 }
      ];
      rings.forEach((ring) => {
        const mesh = new THREE.Mesh(ringGeometry, createSoftMaterial(ring.color, ring.opacity));
        mesh.position.set(ring.x, ring.y, -0.2);
        mesh.scale.setScalar(ring.scale);
        group.add(mesh);
      });

      const bandGeometry = new THREE.BufferGeometry();
      const bandPoints = [];
      for (let index = 0; index <= 120; index += 1) {
        const progress = index / 120;
        const x = -1.42 + progress * 2.84;
        const y = Math.sin(progress * Math.PI * 2.2) * 0.12 + 0.2;
        bandPoints.push(new THREE.Vector3(x, y, 0));
      }
      bandGeometry.setFromPoints(bandPoints);
      const writingBand = new THREE.Line(
        bandGeometry,
        new THREE.LineBasicMaterial({ color: palette.greenDark, transparent: true, opacity: 0.36 })
      );
      group.add(writingBand);

      const speakingGeometry = new THREE.BufferGeometry();
      const speakingPoints = [];
      for (let index = 0; index <= 180; index += 1) {
        const progress = index / 180;
        const x = -1.34 + progress * 2.68;
        const y = Math.sin(progress * Math.PI * 16) * (0.018 + progress * 0.056) - 0.22;
        speakingPoints.push(new THREE.Vector3(x, y, 0.05));
      }
      speakingGeometry.setFromPoints(speakingPoints);
      const speakingLine = new THREE.Line(
        speakingGeometry,
        new THREE.LineBasicMaterial({ color: palette.gold, transparent: true, opacity: 0.38 })
      );
      group.add(speakingLine);

      const pointCount = 140;
      const positions = new Float32Array(pointCount * 3);
      const velocities = new Float32Array(pointCount);
      for (let index = 0; index < pointCount; index += 1) {
        positions[index * 3] = Math.random() * 2.5 - 1.25;
        positions[index * 3 + 1] = Math.random() * 1.9 - 0.95;
        positions[index * 3 + 2] = Math.random() * 0.2 - 0.1;
        velocities[index] = 0.0008 + Math.random() * 0.0016;
      }
      const pointGeometry = new THREE.BufferGeometry();
      pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(
        pointGeometry,
        new THREE.PointsMaterial({
          color: palette.green,
          transparent: true,
          opacity: 0.36,
          size: 0.016,
          sizeAttenuation: false,
          depthWrite: false
        })
      );
      group.add(points);

      let animationFrame = 0;

      function resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        renderer.setSize(width, height, false);
        const aspect = width / Math.max(height, 1);
        camera.left = -aspect;
        camera.right = aspect;
        camera.top = 1;
        camera.bottom = -1;
        camera.updateProjectionMatrix();
      }

      function animate(time: number) {
        const elapsed = time * 0.001;
        group.rotation.z = Math.sin(elapsed * 0.08) * 0.015;
        group.position.x = Math.sin(elapsed * 0.12) * 0.035;
        writingBand.position.y = Math.sin(elapsed * 0.22) * 0.025;
        speakingLine.position.y = Math.cos(elapsed * 0.3) * 0.018;

        const pointPositions = pointGeometry.attributes.position.array as Float32Array;
        for (let index = 0; index < pointCount; index += 1) {
          const yIndex = index * 3 + 1;
          pointPositions[yIndex] += velocities[index];
          if (pointPositions[yIndex] > 1.05) pointPositions[yIndex] = -1.05;
        }
        pointGeometry.attributes.position.needsUpdate = true;

        renderer.render(scene, camera);
        animationFrame = window.requestAnimationFrame(animate);
      }

      resize();
      window.addEventListener("resize", resize);
      animationFrame = window.requestAnimationFrame(animate);

      cleanup = () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", resize);
        pageGeometry.dispose();
        bandGeometry.dispose();
        speakingGeometry.dispose();
        pointGeometry.dispose();
        ringGeometry.dispose();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
            const material = object.material;
            if (Array.isArray(material)) {
              material.forEach((item) => item.dispose());
            } else {
              material.dispose();
            }
          }
        });
        renderer.dispose();
      };
    }

    void startScene();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <canvas ref={canvasRef} className="ielts-background-scene" aria-hidden="true" />;
}
