import { useEffect, useRef, useState } from "react";
import type { Line, LineBasicMaterial } from "three";

function createCurtainTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 680;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#fff9ea");
  gradient.addColorStop(0.45, "#f1f5e8");
  gradient.addColorStop(1, "#e8f1e5");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 18; index += 1) {
    const x = (index / 17) * canvas.width;
    const fold = context.createLinearGradient(x - 42, 0, x + 42, 0);
    fold.addColorStop(0, "rgba(7, 63, 52, 0)");
    fold.addColorStop(0.48, "rgba(7, 63, 52, 0.075)");
    fold.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = fold;
    context.fillRect(x - 42, 0, 84, canvas.height);
  }

  context.fillStyle = "#0f765e";
  context.font = "900 38px Arial, sans-serif";
  context.letterSpacing = "12px";
  context.fillText("IELTS TEACHING OPERATIONS", 58, 92);

  context.save();
  context.globalAlpha = 0.16;
  context.fillStyle = "#0f765e";
  context.font = "900 30px Georgia, serif";
  context.fillText("LISTENING", 1180, 118);
  context.fillText("READING", 1235, 188);
  context.fillText("WRITING", 1160, 258);
  context.fillText("SPEAKING", 1215, 328);
  context.fillStyle = "#d69a2d";
  context.font = "900 46px Arial Black, sans-serif";
  context.fillText("IELTS", 1250, 438);
  context.fillText("QULEDA", 1130, 514);
  context.restore();

  context.save();
  context.translate(60, 360);
  context.transform(1, 0, -0.08, 1, 0, 0);
  context.font = "1000 220px Arial Black, Impact, sans-serif";
  context.letterSpacing = "-13px";
  context.fillStyle = "#d69a2d";
  context.fillText("QULEDA", 18, 22);
  context.fillStyle = "#b9d7c5";
  context.fillText("QULEDA", 36, 38);
  context.fillStyle = "#064536";
  context.fillText("QULEDA", 0, 0);
  context.restore();

  context.fillStyle = "rgba(214, 154, 45, 0.78)";
  context.fillRect(84, 520, 980, 46);
  context.fillStyle = "#0f765e";
  context.font = "900 34px Arial, sans-serif";
  context.letterSpacing = "14px";
  context.fillText("TEACHING TASK FLOW", 74, 608);

  context.strokeStyle = "rgba(7, 63, 52, 0.1)";
  context.lineWidth = 14;
  context.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);

  context.save();
  context.translate(1210, 560);
  context.rotate(-0.14);
  context.fillStyle = "rgba(7, 63, 52, 0.18)";
  context.fillRect(-4, 12, 210, 34);
  context.fillStyle = "#fffaf0";
  context.fillRect(0, 0, 190, 122);
  context.fillStyle = "#0f765e";
  context.fillRect(0, 0, 18, 122);
  context.strokeStyle = "rgba(7, 63, 52, 0.2)";
  context.lineWidth = 5;
  context.strokeRect(0, 0, 190, 122);
  context.fillStyle = "rgba(15, 118, 94, 0.72)";
  context.font = "900 21px Arial, sans-serif";
  context.fillText("ENGLISH", 42, 48);
  context.fillText("BOOK", 56, 82);
  context.restore();

  return canvas;
}

export function CurtainBrandHero({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const windActiveRef = useRef(false);
  const [windActive, setWindActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targetCanvas = canvas;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function startScene() {
      const THREE = await import("three");
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        canvas: targetCanvas,
        powerPreference: "high-performance"
      });
      renderer.setClearAlpha(0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 12);
      camera.position.set(0, 0.08, 5.6);

      const ambient = new THREE.AmbientLight(0xffffff, 1.9);
      scene.add(ambient);
      const keyLight = new THREE.DirectionalLight(0xfff4dc, 2.2);
      keyLight.position.set(-2.4, 2.6, 3.4);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x0f765e, 1.2);
      rimLight.position.set(2.6, 0.2, 2.4);
      scene.add(rimLight);

      const curtainGeometry = new THREE.PlaneGeometry(4.95, 2.08, 84, 30);
      const basePositions = new Float32Array(curtainGeometry.attributes.position.array as Float32Array);
      const texture = new THREE.CanvasTexture(createCurtainTexture());
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const curtain = new THREE.Mesh(
        curtainGeometry,
        new THREE.MeshPhysicalMaterial({
          map: texture,
          roughness: 0.66,
          metalness: 0,
          clearcoat: 0.34,
          clearcoatRoughness: 0.56,
          side: THREE.DoubleSide
        })
      );
      curtain.position.set(-0.38, 0.04, 0);
      curtain.rotation.set(-0.035, -0.06, 0);
      scene.add(curtain);

      const curtainBack = new THREE.Mesh(
        new THREE.BoxGeometry(5.04, 2.18, 0.08, 1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0xd7e7d8,
          roughness: 0.8,
          metalness: 0,
          transparent: true,
          opacity: 0.72
        })
      );
      curtainBack.position.set(-0.38, 0.015, -0.085);
      curtainBack.rotation.copy(curtain.rotation);
      scene.add(curtainBack);

      const curtainBottomWeight = new THREE.Mesh(
        new THREE.BoxGeometry(4.82, 0.08, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xd69a2d, roughness: 0.46, metalness: 0.22 })
      );
      curtainBottomWeight.position.set(-0.38, -1.04, 0.04);
      curtainBottomWeight.rotation.copy(curtain.rotation);
      scene.add(curtainBottomWeight);

      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 5.08, 24),
        new THREE.MeshStandardMaterial({ color: 0xd69a2d, roughness: 0.42, metalness: 0.36 })
      );
      rod.rotation.z = Math.PI / 2;
      rod.position.set(-0.38, 1.08, 0.045);
      scene.add(rod);

      const fan = new THREE.Group();
      fan.position.set(2.38, -0.26, 0.45);
      fan.rotation.set(-0.18, -0.78, 0.1);
      scene.add(fan);

      const fanMaterial = new THREE.MeshStandardMaterial({ color: 0x0b5a48, roughness: 0.38, metalness: 0.22 });
      const fanAccent = new THREE.MeshStandardMaterial({ color: 0xd69a2d, roughness: 0.34, metalness: 0.42 });
      const fanShadowMaterial = new THREE.MeshBasicMaterial({
        color: 0x073f34,
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      });
      const fanGuardMaterial = new THREE.MeshStandardMaterial({
        color: 0xfff6dc,
        roughness: 0.28,
        metalness: 0.16,
        transparent: true,
        opacity: 0.58
      });
      const fanBladeMaterial = new THREE.MeshStandardMaterial({
        color: 0xe8f1e5,
        roughness: 0.34,
        metalness: 0.08,
        transparent: true,
        opacity: 0.82
      });

      const fanBase = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.34, 0.16, 36), fanMaterial);
      fanBase.position.y = -0.72;
      fan.add(fanBase);
      const fanBaseShadow = new THREE.Mesh(new THREE.CircleGeometry(0.52, 48), fanShadowMaterial);
      fanBaseShadow.rotation.x = -Math.PI / 2;
      fanBaseShadow.position.set(0.04, -0.82, -0.05);
      fanBaseShadow.scale.set(1.42, 0.58, 1);
      fan.add(fanBaseShadow);
      const fanStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.7, 18), fanMaterial);
      fanStem.position.y = -0.36;
      fan.add(fanStem);
      const fanNeck = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16), fanAccent);
      fanNeck.position.y = -0.04;
      fan.add(fanNeck);
      const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.024, 12, 72), fanAccent);
      fan.add(fanRing);
      const fanBackRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 12, 72), fanMaterial);
      fanBackRing.position.z = -0.08;
      fan.add(fanBackRing);
      const fanFrontGuard = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.022, 64), fanGuardMaterial);
      fanFrontGuard.rotation.x = Math.PI / 2;
      fanFrontGuard.position.z = 0.045;
      fan.add(fanFrontGuard);
      const fanHub = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), fanMaterial);
      fan.add(fanHub);
      const fanBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.22, 32), fanMaterial);
      fanBody.rotation.x = Math.PI / 2;
      fanBody.position.z = -0.12;
      fan.add(fanBody);
      const fanBackMotor = new THREE.Mesh(new THREE.SphereGeometry(0.21, 28, 18), fanMaterial);
      fanBackMotor.scale.set(1, 1, 0.74);
      fanBackMotor.position.z = -0.24;
      fan.add(fanBackMotor);
      const fanSideKnob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), fanAccent);
      fanSideKnob.position.set(0.24, 0, -0.16);
      fan.add(fanSideKnob);

      for (let index = 0; index < 16; index += 1) {
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.72, 8), fanAccent);
        spoke.rotation.z = (Math.PI * index) / 16;
        spoke.rotation.x = Math.PI / 2;
        spoke.position.z = 0.012;
        fan.add(spoke);
      }
      for (let index = 0; index < 3; index += 1) {
        const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.14 + index * 0.09, 0.0045, 8, 64), fanGuardMaterial);
        innerRing.position.z = 0.062 + index * 0.002;
        fan.add(innerRing);
      }

      const bladeGroup = new THREE.Group();
      fan.add(bladeGroup);
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0.03, 0.02);
      bladeShape.bezierCurveTo(0.22, 0.04, 0.37, 0.14, 0.42, 0.26);
      bladeShape.bezierCurveTo(0.26, 0.31, 0.11, 0.19, 0.02, 0.06);
      bladeShape.closePath();
      const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
        depth: 0.036,
        bevelEnabled: true,
        bevelSize: 0.012,
        bevelThickness: 0.012
      });
      for (let index = 0; index < 5; index += 1) {
        const blade = new THREE.Mesh(bladeGeometry, fanBladeMaterial);
        blade.rotation.z = (Math.PI * 2 * index) / 5;
        blade.position.z = 0.02;
        bladeGroup.add(blade);
      }

      const sideBookGroup = new THREE.Group();
      sideBookGroup.position.set(-2.42, -0.92, 0.26);
      sideBookGroup.rotation.set(-0.1, 0.22, -0.08);
      scene.add(sideBookGroup);
      const bookCoverMaterial = new THREE.MeshStandardMaterial({ color: 0x0f765e, roughness: 0.46, metalness: 0.08 });
      const bookPageMaterial = new THREE.MeshStandardMaterial({ color: 0xfff9ea, roughness: 0.82, metalness: 0 });
      const bookCover = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.76, 0.06), bookCoverMaterial);
      const bookPages = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.08), bookPageMaterial);
      bookPages.position.set(0.05, -0.015, 0.05);
      sideBookGroup.add(bookCover, bookPages);

      const gustGeometry = new THREE.BufferGeometry();
      const gustCount = 7;
      const gustLines: Line[] = [];
      for (let gustIndex = 0; gustIndex < gustCount; gustIndex += 1) {
        const points = [];
        for (let index = 0; index <= 42; index += 1) {
          const progress = index / 42;
          points.push(
            new THREE.Vector3(
              2.05 - progress * 2.34,
              -0.42 + gustIndex * 0.125 + progress * 0.22 + Math.sin(progress * Math.PI * 2) * 0.025,
              0.2
            )
          );
        }
        gustGeometry.setFromPoints(points);
        const line = new THREE.Line(
          gustGeometry.clone(),
          new THREE.LineBasicMaterial({ color: 0x0f765e, transparent: true, opacity: 0 })
        );
        scene.add(line);
        gustLines.push(line);
      }
      gustGeometry.dispose();

      let width = 0;
      let height = 0;
      let animationFrame = 0;
      let windPower = 0;

      function resize() {
        width = targetCanvas.clientWidth || 1;
        height = targetCanvas.clientHeight || 1;
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(height, 1);
        const isMobile = width < 640;
        const isTablet = width >= 640 && width < 980;
        const curtainScale = isMobile ? 0.82 : isTablet ? 0.92 : 1;
        camera.position.set(0, isMobile ? 0.02 : 0.08, isMobile ? 7.6 : isTablet ? 6.6 : 5.6);
        curtain.scale.setScalar(curtainScale);
        curtainBack.scale.setScalar(curtainScale);
        curtainBottomWeight.scale.setScalar(curtainScale);
        rod.scale.setScalar(curtainScale);
        sideBookGroup.visible = !isMobile;
        fan.scale.setScalar(isMobile ? 1.18 : isTablet ? 1.16 : 1.28);
        fan.position.set(isMobile ? 1.48 : isTablet ? 2.02 : 2.36, isMobile ? -0.84 : -0.34, isMobile ? 0.72 : 0.54);
        fan.rotation.set(isMobile ? -0.28 : -0.22, isMobile ? -0.98 : -0.86, isMobile ? 0.16 : 0.11);
        camera.updateProjectionMatrix();
      }

      function animate(time: number) {
        const elapsed = time * 0.001;
        const targetWind = windActiveRef.current ? 1 : 0;
        windPower += (targetWind - windPower) * 0.075;
        bladeGroup.rotation.z += 0.075 + windPower * 0.62;

        const positions = curtainGeometry.attributes.position.array as Float32Array;
        for (let index = 0; index < positions.length; index += 3) {
          const x = basePositions[index];
          const y = basePositions[index + 1];
          const normalizedX = (x + 2.475) / 4.95;
          const edgeFalloff = Math.sin(normalizedX * Math.PI);
          const foldWave = Math.sin(normalizedX * Math.PI * 18 + elapsed * 0.38) * 0.02;
          const baseWave = Math.sin(elapsed * 1.15 + x * 3.1 + y * 1.7) * 0.036 + foldWave;
          const windWave = Math.sin(elapsed * 7.2 + x * 6.6 + y * 2.4) * (0.055 + normalizedX * 0.2) * windPower;
          positions[index + 2] = basePositions[index + 2] + (baseWave + windWave) * edgeFalloff;
          positions[index] = basePositions[index] + Math.sin(elapsed * 4.8 + y * 5.8) * 0.046 * windPower * normalizedX;
        }
        curtainGeometry.attributes.position.needsUpdate = true;
        curtainGeometry.computeVertexNormals();

        gustLines.forEach((line, index) => {
          line.position.x = Math.sin(elapsed * 2.5 + index) * 0.06 * windPower;
          line.position.y = Math.cos(elapsed * 1.7 + index) * 0.035 * windPower + index * 0.006 * windPower;
          line.rotation.z = -0.34 + Math.sin(elapsed * 1.1 + index) * 0.025 * windPower;
          const material = line.material as LineBasicMaterial;
          material.opacity = windPower * (0.2 + index * 0.024);
        });

        renderer.render(scene, camera);
        animationFrame = window.requestAnimationFrame(animate);
      }

      resize();
      window.addEventListener("resize", resize);
      animationFrame = window.requestAnimationFrame(animate);

      cleanup = () => {
        window.cancelAnimationFrame(animationFrame);
        window.removeEventListener("resize", resize);
        curtainGeometry.dispose();
        texture.dispose();
        bladeGeometry.dispose();
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
            const material = object.material;
            if (Array.isArray(material)) {
              material.forEach((item) => item.dispose());
            } else {
              material.dispose();
            }
            if ("geometry" in object) object.geometry.dispose();
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

  function setFanPressed(pressed: boolean) {
    windActiveRef.current = pressed;
    setWindActive(pressed);
  }

  const rootClassName = ["curtain-brand-hero", className, windActive ? "wind-active" : ""].filter(Boolean).join(" ");

  return (
    <div className={rootClassName}>
      <canvas ref={canvasRef} className="curtain-brand-canvas" aria-hidden="true" />
      <button
        type="button"
        className="fan-wind-button"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setFanPressed(true);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setFanPressed(false);
        }}
        onPointerCancel={() => setFanPressed(false)}
        onPointerLeave={() => setFanPressed(false)}
        aria-label="长按小风扇给 QULEDA 幕布吹风"
      >
        <span>长按一下 夏日清凉</span>
      </button>
    </div>
  );
}
