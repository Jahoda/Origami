/**
 * Origami 3D Tutorial Engine
 *
 * Renders origami paper states in an interactive 3D viewer using Three.js.
 * Each step defines a set of 3D faces (triangles or quads). The engine
 * triangulates polygons, morphs between step states with smooth animation,
 * and provides orbit controls for interactive viewing.
 *
 * Usage:
 *   import { OrigamiEngine } from './engine.js';
 *   const engine = new OrigamiEngine({ steps: [...], frontColor: '#f5e6d3', ... });
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class OrigamiEngine {

    constructor(config) {
        this.frontColor = new THREE.Color(config.frontColor || '#f5e6d3');
        this.backColor = new THREE.Color(config.backColor || '#dcc8b0');
        this.foldColor = new THREE.Color(config.foldColor || '#e8d5be');
        this.accentColor = new THREE.Color(config.accentColor || '#e8833a');
        this.sceneBg = config.sceneBg || '#f5f0ea';

        // Preprocess: triangulate all polygon faces into triangles
        this.steps = this._preprocessSteps(config.steps);

        this.currentStep = 0;
        this.completed = new Set();

        // Animation state
        this.animating = false;
        this.animProgress = 1;
        this.animSpeed = 1.8;
        this.prevFaces = null;
        this.nextFaces = null;

        // Three.js objects
        this.faceMeshes = [];
        this.foldLineObj = null;
        this.arrowObjs = [];
        this.decorations = [];

        this.init3D();
        this.initUI();
        this.showStep(0, false);
        this.startLoop();
    }

    // ─── Preprocessing ────────────────────────────────────────────────

    /**
     * Convert polygon faces (quads etc.) into triangles via fan triangulation.
     * A face with N vertices becomes N-2 triangles sharing vertex 0.
     */
    _preprocessSteps(rawSteps) {
        return rawSteps.map(step => {
            const triangles = [];
            for (const face of step.faces) {
                const v = face.verts;
                if (v.length === 3) {
                    triangles.push({ verts: v, type: face.type, color: face.color });
                } else if (v.length >= 4) {
                    // Fan triangulation from vertex 0
                    for (let i = 1; i < v.length - 1; i++) {
                        triangles.push({
                            verts: [v[0], v[i], v[i + 1]],
                            type: face.type,
                            color: face.color,
                        });
                    }
                }
            }
            return {
                faces: triangles,
                foldLine: step.foldLine || null,
                decorations: step.decorations || null,
            };
        });
    }

    // ─── Three.js Setup ──────────────────────────────────────────────

    init3D() {
        const container = document.getElementById('viewer3d');
        if (!container) return;
        this.viewerEl = container;

        const w = container.clientWidth || 800;
        const h = 380;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.sceneBg);
        this.scene.fog = new THREE.Fog(this.sceneBg, 250, 450);

        // Camera
        this.camera = new THREE.PerspectiveCamera(42, w / h, 1, 600);
        this.camera.position.set(0, 100, 160);
        this.camera.lookAt(0, 10, 0);
        this.defaultCamPos = this.camera.position.clone();
        this.defaultCamTarget = new THREE.Vector3(0, 10, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(w, h);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        container.appendChild(this.renderer.domElement);

        // Orbit controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 60;
        this.controls.maxDistance = 320;
        this.controls.maxPolarAngle = Math.PI * 0.88;
        this.controls.target.copy(this.defaultCamTarget);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.55);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xfff5e6, 0.8);
        sun.position.set(60, 130, 80);
        sun.castShadow = true;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = 350;
        sun.shadow.camera.left = -120;
        sun.shadow.camera.right = 120;
        sun.shadow.camera.top = 120;
        sun.shadow.camera.bottom = -120;
        sun.shadow.mapSize.set(1024, 1024);
        this.scene.add(sun);

        const fill = new THREE.DirectionalLight(0xe8f0ff, 0.3);
        fill.position.set(-50, 60, -40);
        this.scene.add(fill);

        const rim = new THREE.DirectionalLight(0xffffff, 0.15);
        rim.position.set(0, 20, -100);
        this.scene.add(rim);

        // Ground
        const groundGeo = new THREE.CircleGeometry(160, 64);
        const groundMat = new THREE.MeshLambertMaterial({ color: 0xede6dc });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.5;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Subtle grid
        const grid = new THREE.GridHelper(200, 16, 0xddd6cc, 0xe8e2d8);
        grid.position.y = -0.3;
        grid.material.opacity = 0.4;
        grid.material.transparent = true;
        this.scene.add(grid);

        // Paper group
        this.paperGroup = new THREE.Group();
        this.scene.add(this.paperGroup);

        // Resize handler
        this._onResize = () => {
            const w2 = container.clientWidth || 800;
            this.renderer.setSize(w2, h);
            this.camera.aspect = w2 / h;
            this.camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', this._onResize);

        // Reset camera button
        const resetBtn = container.querySelector('.viewer-btn[data-action="reset-cam"]');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetCamera());
        }

        // Auto-rotate button
        const autoBtn = container.querySelector('.viewer-btn[data-action="auto-rotate"]');
        if (autoBtn) {
            autoBtn.addEventListener('click', () => {
                this.controls.autoRotate = !this.controls.autoRotate;
                this.controls.autoRotateSpeed = 2.0;
                autoBtn.textContent = this.controls.autoRotate ? 'Stop' : 'Rotace';
            });
        }
    }

    resetCamera() {
        this._camTween = { from: this.camera.position.clone(), to: this.defaultCamPos.clone(), t: 0 };
        this.controls.target.copy(this.defaultCamTarget);
    }

    // ─── Paper Rendering ─────────────────────────────────────────────

    _createFaceMesh() {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(9); // 3 vertices * 3 components
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.computeVertexNormals();

        const mat = new THREE.MeshPhongMaterial({
            color: this.frontColor,
            side: THREE.DoubleSide,
            flatShading: true,
            shininess: 20,
            specular: 0x222222,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    _ensureMeshes(count) {
        while (this.faceMeshes.length < count) {
            const mesh = this._createFaceMesh();
            this.paperGroup.add(mesh);
            this.faceMeshes.push(mesh);
        }
        for (let i = 0; i < this.faceMeshes.length; i++) {
            this.faceMeshes[i].visible = (i < count);
        }
    }

    _setFace(index, verts, color, opacity) {
        const mesh = this.faceMeshes[index];
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < 3; i++) {
            pos.setXYZ(i, verts[i][0], verts[i][1], verts[i][2]);
        }
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.material.color.set(color);
        if (opacity !== undefined && opacity < 1) {
            mesh.material.transparent = true;
            mesh.material.opacity = opacity;
        } else {
            mesh.material.transparent = false;
            mesh.material.opacity = 1;
        }
        mesh.visible = true;
    }

    _resolveFaceColor(face) {
        if (face.color) return new THREE.Color(face.color);
        if (face.type === 'back') return this.backColor;
        if (face.type === 'fold') return this.foldColor;
        return this.frontColor;
    }

    _buildFoldLine(foldLine) {
        if (this.foldLineObj) {
            this.paperGroup.remove(this.foldLineObj);
            this.foldLineObj.geometry.dispose();
            this.foldLineObj.material.dispose();
            this.foldLineObj = null;
        }
        for (const a of this.arrowObjs) {
            this.paperGroup.remove(a);
            a.geometry?.dispose();
            a.material?.dispose();
        }
        this.arrowObjs = [];

        if (!foldLine) return;

        const pts = foldLine.map(p => new THREE.Vector3(p[0], p[1] + 0.8, p[2]));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineDashedMaterial({
            color: this.accentColor,
            dashSize: 3,
            gapSize: 2,
        });
        this.foldLineObj = new THREE.Line(geo, mat);
        this.foldLineObj.computeLineDistances();
        this.paperGroup.add(this.foldLineObj);
    }

    _buildDecorations(decorations) {
        for (const d of this.decorations) {
            this.paperGroup.remove(d);
            d.geometry?.dispose();
            d.material?.dispose();
        }
        this.decorations = [];

        if (!decorations) return;

        for (const dec of decorations) {
            let mesh;
            if (dec.shape === 'sphere') {
                const geo = new THREE.SphereGeometry(dec.radius || 3, 16, 12);
                const mat = new THREE.MeshPhongMaterial({
                    color: dec.color || '#2d2926',
                    shininess: 40,
                });
                mesh = new THREE.Mesh(geo, mat);
            } else if (dec.shape === 'ellipse') {
                const geo = new THREE.SphereGeometry(1, 16, 12);
                const mat = new THREE.MeshPhongMaterial({
                    color: dec.color || '#2d2926',
                    shininess: 40,
                });
                mesh = new THREE.Mesh(geo, mat);
                mesh.scale.set(dec.rx || 3, dec.ry || 3, dec.rz || 1);
            } else if (dec.shape === 'circle') {
                const geo = new THREE.CircleGeometry(dec.radius || 3, 24);
                const mat = new THREE.MeshPhongMaterial({
                    color: dec.color || '#2d2926',
                    side: THREE.DoubleSide,
                });
                mesh = new THREE.Mesh(geo, mat);
                if (dec.rotateX) mesh.rotation.x = dec.rotateX;
            }

            if (mesh && dec.position) {
                mesh.position.set(dec.position[0], dec.position[1], dec.position[2]);
                mesh.castShadow = true;
                this.paperGroup.add(mesh);
                this.decorations.push(mesh);
            }
        }
    }

    // ─── Step Management ─────────────────────────────────────────────

    showStep(index, animate = true) {
        if (index < 0 || index >= this.steps.length) return;

        const step = this.steps[index];
        const faces = step.faces;

        if (animate && this.currentStep !== index && this.animProgress >= 1) {
            this.prevFaces = this._captureCurrentFaces();
            this.currentStep = index;
            this.nextFaces = faces.map(f => ({
                verts: f.verts,
                color: this._resolveFaceColor(f),
            }));
            this.animProgress = 0;
            this.animating = true;
        } else {
            this.currentStep = index;
            this._ensureMeshes(faces.length);
            for (let i = 0; i < faces.length; i++) {
                this._setFace(i, faces[i].verts, this._resolveFaceColor(faces[i]));
            }
            for (let i = faces.length; i < this.faceMeshes.length; i++) {
                this.faceMeshes[i].visible = false;
            }
            this.animating = false;
            this.animProgress = 1;
        }

        this._buildFoldLine(step.foldLine);
        this._buildDecorations(step.decorations);
        this._updateUI();
    }

    _captureCurrentFaces() {
        const result = [];
        for (const mesh of this.faceMeshes) {
            if (!mesh.visible) continue;
            const pos = mesh.geometry.attributes.position;
            const verts = [];
            for (let i = 0; i < 3; i++) {
                verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
            }
            result.push({
                verts,
                color: mesh.material.color.clone(),
            });
        }
        return result;
    }

    _updateAnimation(dt) {
        if (!this.animating) return;

        this.animProgress += dt * this.animSpeed;
        if (this.animProgress >= 1) {
            this.animProgress = 1;
            this.animating = false;
        }

        const t = this._easeInOutCubic(this.animProgress);
        const maxFaces = Math.max(this.prevFaces.length, this.nextFaces.length);
        this._ensureMeshes(maxFaces);

        for (let i = 0; i < maxFaces; i++) {
            const prev = this.prevFaces[i];
            const next = this.nextFaces[i];

            if (!prev && next) {
                this._setFace(i, next.verts, next.color, t);
            } else if (prev && !next) {
                this._setFace(i, prev.verts, prev.color, 1 - t);
            } else if (prev && next) {
                const verts = prev.verts.map((pv, vi) => {
                    const nv = next.verts[vi];
                    return [
                        pv[0] + (nv[0] - pv[0]) * t,
                        pv[1] + (nv[1] - pv[1]) * t,
                        pv[2] + (nv[2] - pv[2]) * t,
                    ];
                });
                const c = prev.color.clone().lerp(next.color, t);
                this._setFace(i, verts, c);
            }
        }

        if (!this.animating) {
            this.showStep(this.currentStep, false);
        }
    }

    _easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ─── Camera tween ────────────────────────────────────────────────

    _updateCameraTween(dt) {
        if (!this._camTween) return;
        this._camTween.t += dt * 2;
        if (this._camTween.t >= 1) {
            this.camera.position.copy(this._camTween.to);
            this._camTween = null;
        } else {
            const t = this._easeInOutCubic(this._camTween.t);
            this.camera.position.lerpVectors(this._camTween.from, this._camTween.to, t);
        }
    }

    // ─── UI ──────────────────────────────────────────────────────────

    initUI() {
        const stepsContainer = document.getElementById('stepsContainer');
        if (!stepsContainer) return;

        stepsContainer.addEventListener('click', (e) => {
            const stepEl = e.target.closest('.step');
            if (!stepEl) return;
            const idx = parseInt(stepEl.dataset.step, 10);

            if (e.target.closest('.step-check')) {
                e.stopPropagation();
                this._toggleComplete(idx);
                return;
            }

            this.showStep(idx, true);
        });

        const prevBtn = document.getElementById('btnPrev');
        const nextBtn = document.getElementById('btnNext');
        if (prevBtn) prevBtn.addEventListener('click', () => this.showStep(this.currentStep - 1, true));
        if (nextBtn) nextBtn.addEventListener('click', () => this.showStep(this.currentStep + 1, true));

        const resetBtn = document.getElementById('btnReset');
        if (resetBtn) resetBtn.addEventListener('click', () => this._resetAll());
    }

    _toggleComplete(idx) {
        if (this.completed.has(idx)) {
            this.completed.delete(idx);
        } else {
            this.completed.add(idx);
        }
        this._updateUI();
    }

    _resetAll() {
        this.completed.clear();
        this.showStep(0, false);
        this.resetCamera();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    _updateUI() {
        const total = this.steps.length;

        document.querySelectorAll('.step[data-step]').forEach(el => {
            const idx = parseInt(el.dataset.step, 10);
            el.classList.toggle('active', idx === this.currentStep);
            el.classList.toggle('completed', this.completed.has(idx));
        });

        const pct = (this.completed.size / total) * 100;
        const fill = document.getElementById('progressFill');
        if (fill) fill.style.width = pct + '%';

        const label = document.getElementById('stepLabel');
        if (label) label.textContent = `${this.currentStep + 1} / ${total}`;

        const prevBtn = document.getElementById('btnPrev');
        const nextBtn = document.getElementById('btnNext');
        if (prevBtn) prevBtn.disabled = (this.currentStep <= 0);
        if (nextBtn) nextBtn.disabled = (this.currentStep >= total - 1);

        const finalEl = document.getElementById('finalSection');
        if (finalEl) {
            if (this.completed.size === total) {
                finalEl.classList.add('visible');
                finalEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                finalEl.classList.remove('visible');
            }
        }
    }

    // ─── Render Loop ─────────────────────────────────────────────────

    startLoop() {
        const clock = new THREE.Clock();
        const tick = () => {
            requestAnimationFrame(tick);
            const dt = Math.min(clock.getDelta(), 0.05);
            this.controls.update();
            this._updateAnimation(dt);
            this._updateCameraTween(dt);
            this.renderer.render(this.scene, this.camera);
        };
        tick();
    }
}
