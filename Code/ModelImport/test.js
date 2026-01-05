import * as THREE from '../Common/three.js-r170/build/three.module.js';
 import { TrackballControls } from '../Common/three.js-r170/examples/jsm/controls/TrackballControls.js';
 import { PointerLockControls } from '../Common/three.js-r170/examples/jsm/controls/PointerLockControls.js';
 import Stats from '../Common/three.js-r170/examples/jsm/libs/stats.module.js';
 import { EXRLoader } from '../Common/three.js-r170/examples/jsm/loaders/EXRLoader.js';

import { GLTFLoader } from '../Common/three.js-r170/examples/jsm/loaders/GLTFLoader.js';

import RAPIER from "../Common/node_modules/@dimforge/rapier3d-compat/rapier.mjs";

let camera, fpsCamera, controls, fpsControls, scene, renderer, canvas, world, map_city  ;
let scene2Position = null; // 场景2物体的位置
let crosshairEl = null; // 十字准星元素
let mainMenuEl = null; // 主菜单元素
let isMenuVisible = true; // 菜单是否可见
let sun, sunHelper, sunCamHelper;
let stats;

let initMap = false;
// 手电筒
let flashlight = null;
let flashlightEnabled = false;

// step 时会更新
const dynamicGltfObjects = []; // 动态 glTF 对象列表，用于同步位置
const mixers = []; // 动画混合器列表，用于播放动画
const zombies = [];          // 多个僵尸/动态物体的句柄列表
const zombieMixers = [];     // 多个僵尸动画混合器列表
let DEBUG = false;

// 全局：手枪操作句柄
let pistol = null;
// 手枪开火抖动/后坐力状态
let pistolRecoil = 0; // 线性后坐力强度（0..）
let pistolShake = 0;  // 抖动强度（0..）
// 全局：步枪操作句柄与后坐力状态
let rifle = null;
let rifleRecoil = 0;
let rifleShake = 0;
// 全局：手雷操作句柄
let granade = null;
// 手雷对象池
const granadePool = [];
const GRANADE_POOL_SIZE = 10;
// 武器音效
let pistolSound = null;
let rifleSound = null;
let explosionSound = null;

const HIDDEN_WEAPON_POSITION = new THREE.Vector3(0, -10000, 0);


let colliderDebugs = [];
let lowFps = Infinity;
let lastRafTs = null;
let lowFpsEl;
let posEl;
let lowFpsResetId;
// FPS character controller state
let charController, playerBody, playerCollider;
let zombieCharController;
const capsule = { radius: 1.6, halfHeight: 7 }; // total height ~ 1.8m
const cameraYOffset = capsule.halfHeight; // place eye near top of capsule
let activeCamera, activeControls;
const clock = new THREE.Clock();
let mixer = null;

scene = new THREE.Scene();
const physics = await initPhysics(scene);
// expose rapier world for custom colliders
world = physics.world;

// 初始化性能监测面板与最低帧率覆盖层
function initPerfHUD() {
  // Stats
  stats = new Stats();
  stats.dom.style.left = 'auto';
  stats.dom.style.right = '0px';
  document.body.appendChild(stats.dom);

  // 低帧率覆盖层
  lowFpsEl = document.createElement('div');
  lowFpsEl.style.position = 'fixed';
  lowFpsEl.style.top = '0';
  lowFpsEl.style.right = '0';
  lowFpsEl.style.transform = 'translateY(48px)';
  lowFpsEl.style.padding = '4px 8px';
  lowFpsEl.style.fontFamily = 'monospace';
  lowFpsEl.style.fontSize = '12px';
  lowFpsEl.style.color = '#0f0';
  lowFpsEl.style.background = 'rgba(0,0,0,0.5)';
  lowFpsEl.style.zIndex = '10001';
  lowFpsEl.style.pointerEvents = 'none';
  lowFpsEl.textContent = 'Low FPS: --';
  document.body.appendChild(lowFpsEl);

  // 当前位置覆盖层（位于低帧率下方）
  posEl = document.createElement('div');
  posEl.style.position = 'fixed';
  posEl.style.top = '0';
  posEl.style.right = '0';
  posEl.style.transform = 'translateY(68px)';
  posEl.style.padding = '4px 8px';
  posEl.style.fontFamily = 'monospace';
  posEl.style.fontSize = '12px';
  posEl.style.color = '#0cf';
  posEl.style.background = 'rgba(0,0,0,0.5)';
  posEl.style.zIndex = '10001';
  posEl.style.pointerEvents = 'none';
  posEl.textContent = 'Pos: --, --, --';
  document.body.appendChild(posEl);

  // 每 5 秒重置最低帧率显示
  if (lowFpsResetId) clearInterval(lowFpsResetId);
  lowFpsResetId = setInterval(() => {
    lowFps = Infinity;
    if (lowFpsEl) lowFpsEl.textContent = 'Low FPS: --';
  }, 5000);
}

// 左上角 DEBUG 开关
function initDebugToggle() {
  const label = document.createElement('label');
  label.style.position = 'fixed';
  label.style.top = '0';
  label.style.left = '0';
  label.style.padding = '4px 8px';
  label.style.fontFamily = 'monospace';
  label.style.fontSize = '12px';
  label.style.background = 'rgba(0,0,0,0.5)';
  label.style.color = '#fff';
  label.style.zIndex = '10001';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!DEBUG;
  cb.style.marginRight = '6px';
  cb.addEventListener('change', () => {
    DEBUG = cb.checked;
    if (sunHelper) sunHelper.visible = DEBUG;
    if (sunCamHelper) sunCamHelper.visible = DEBUG;
    if (Array.isArray(colliderDebugs)) {
      for (const d of colliderDebugs) {
        if (d && typeof d.visible !== 'undefined') d.visible = DEBUG;
      }
    }
  });

  label.appendChild(cb);
  label.appendChild(document.createTextNode('DEBUG'));
  document.body.appendChild(label);
}
// 初始化场景光照（支持调试 helper 开关）
function initLighting(debug = false) {
  // 环境光
  const ambLight = new THREE.AmbientLight(0x404040, 1);
  scene.add(ambLight);

  // 太阳光（方向光）
  sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(300, 1000, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20000*3;
  sun.shadow.camera.left = -5000*3;
  sun.shadow.camera.right = 5000*3;
  sun.shadow.camera.top = 5000*3;
  sun.shadow.camera.bottom = -5000*3;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // 太阳目标点（指向）
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(-5, 0, 0);
  scene.add(sunTarget);
  sun.target = sunTarget;

  // 调试辅助器
  sunHelper = new THREE.DirectionalLightHelper(sun, 5);
  scene.add(sunHelper);
  sunHelper.visible = !!debug;

  sunCamHelper = new THREE.CameraHelper(sun.shadow.camera);
  scene.add(sunCamHelper);
  sunCamHelper.visible = !!debug;

  // 点光源（可选，保留原有效果）
  const pointLight = new THREE.PointLight(0xFFFFFF, 75);
  pointLight.castShadow = true;
  pointLight.position.set(5, 10, 8);
  scene.add(pointLight);

  const pointHelper = new THREE.PointLightHelper(pointLight);
  scene.add(pointHelper);
  pointHelper.visible = !!debug;
}

// 初始化天空盒（占位符路径，替换为你的图片）
function initSkybox() {
  const exr = new EXRLoader().load(
    '../Resources/cloud/citrus_orchard_road_puresky_2k.exr',
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      // EXR is linear; keep LinearSRGBColorSpace for correct lighting/background
      texture.colorSpace = THREE.LinearSRGBColorSpace;
      scene.background = texture;
    }
  );
}

function updateMixers(mixers, dt) {
    if (mixers && mixers.length > 0) {
      for (const m of mixers) m.update(dt);
    }
  }
  
// ---- Collider debug helpers ----

function addColliderDebugBoxForBody(body, halfExtents, localOffset = new THREE.Vector3(), color = 0x00ffff) {
  if (!DEBUG) return;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 9999;
  scene.add(mesh);
  colliderDebugs.push({ mesh, body, localOffset: localOffset.clone(), type: 'box' });
}
function addColliderDebugCapsuleForBody(body, halfHeight, radius, color = 0xff00ff) {
  if (!DEBUG || typeof THREE.CapsuleGeometry !== 'function') return;
  const height = Math.max(halfHeight * 2, 0.001);
  const geo = new THREE.CapsuleGeometry(radius, Math.max(height - 2 * radius, 0.001), 8, 16);
  const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 9999;
  scene.add(mesh);
  colliderDebugs.push({ mesh, body, localOffset: new THREE.Vector3(), type: 'capsule' });
}
function updateColliderDebugs() {
  if (!DEBUG) return;
  for (const d of colliderDebugs) {
    const t = d.body.translation();
    const r = d.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const offsetWorld = d.localOffset.clone().applyQuaternion(q);
    d.mesh.position.set(t.x + offsetWorld.x, t.y + offsetWorld.y, t.z + offsetWorld.z);
    d.mesh.quaternion.copy(q);
  }
}

// glTF 静态场景工厂：应用变换、可选阴影、可选静态三角网碰撞体
function createStaticGLTF({
  object3d,
  position = [0, 20, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  enableShadows = true,
  addCollider = true,
  rapier = RAPIER,
  rapierWorld = world
}) {
  object3d.position.set(position[0], position[1], position[2]);
  object3d.rotation.set(rotation[0], rotation[1], rotation[2]);
  object3d.scale.set(scale[0], scale[1], scale[2]);

  if (enableShadows) {
    object3d.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  scene.add(object3d);

  let rb = null;
  if (addCollider && rapierWorld) {
    rb = addStaticTrimeshColliderFromMesh(rapier, rapierWorld, object3d);
  }

  return { object: object3d, rigidBody: rb };
}

// glTF 动态对象工厂：根据包围盒生成球/盒近似碰撞体，创建动态刚体并注册同步
// 渲染位置已经同步于刚体运动 step时会遍历dynamicGltfObjects列表，取出其中每个元素的sync同步位置
function createDynamicGLTF({
  object3d,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  // Additional multiplier for physics collider size (does not affect visuals)
  colliderScale = [1, 1, 1],
  enableShadows = true,
  shape = 'sphere', // 'sphere' | 'box' | 'compound' | 'No'
  // Preferred: explicitly set total mass for this rigid body; overrides density if provided
  targetMass = undefined,
  // Fallback density when targetMass is not provided
  density = 0.05,
  // Lower default friction to make objects easier to push
  friction = 0.3,
  restitution = 0.0,
  damping = { lin: 0.05, ang: 0.05 },
  canSleep = true,
  enableCcd = true,
  // 保持直立：禁止绕 X/Z 旋转，只允许绕 Y 旋转
  lockXZRotation = false,
  rapier = RAPIER,
  rapierWorld = world,
  renderOffset
}) {

    
  if (!object3d) {
    console.error('[createDynamicGLTF] object3d is not valid');
    return { object: null, rigidBody: null, colliders: [] };
  }

  if(renderOffset === undefined) {
    renderOffset = { x: 0, y: 0, z: 0 };
  }
  object3d.position.set(position[0], position[1], position[2]);
  object3d.rotation.set(rotation[0], rotation[1], rotation[2]);
  object3d.scale.set(scale[0], scale[1], scale[2]);

  if (enableShadows) {
    object3d.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  scene.add(object3d);

  // 计算包围盒尺寸（世界空间）
  const bbox = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // shape === 'No' 表示不创建任何刚体/碰撞体，仅作为纯渲染对象
  if (shape === 'No') {
    const entry = {
      object: object3d,
      rigidBody: null,
      colliders: [],
      sync: null
    };
    dynamicGltfObjects.push(entry);
    return entry;
  }

  // 创建动态刚体
  const desc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position[0], position[1], position[2])
    .setCanSleep(canSleep)
    .setLinearDamping(damping.lin)
    .setAngularDamping(damping.ang);
  const body = rapierWorld.createRigidBody(desc);

  // 碰撞体：默认球体更稳定；可选盒体/复合盒
  const colliders = [];
  if (shape === 'box') {
    const sx = Math.max(colliderScale[0] ?? 1, 0.0001);
    const sy = Math.max(colliderScale[1] ?? 1, 0.0001);
    const sz = Math.max(colliderScale[2] ?? 1, 0.0001);
    const hx = Math.max(size.x * 0.5 * sx, 0.01);
    const hy = Math.max(size.y * 0.5 * sy, 0.01);
    const hz = Math.max(size.z * 0.5 * sz, 0.01);
    {
      const desc = rapier.ColliderDesc
        .cuboid(hx, hy, hz)
        .setFriction(friction)
        .setRestitution(restitution);
      // Only add density-based mass when no explicit targetMass is given
      if (typeof targetMass === 'undefined') desc.setDensity(density);
      const collider = rapierWorld.createCollider(desc, body);
      colliders.push(collider);
    }
    // debug collider
    addColliderDebugBoxForBody(
      body,
      new THREE.Vector3(hx, hy, hz),
      new THREE.Vector3(0, 0, 0),
      0x00ffff
    );
    
  } else if (shape === 'compound') {
    // When targetMass is provided, skip per-collider density so total mass can be set explicitly.
    const created = addCompoundBoxCollidersFromMesh(
      rapier,
      rapierWorld,
      body,
      object3d,
      { density: (typeof targetMass === 'undefined') ? density : undefined, friction, restitution }
    );
    for (const c of created) colliders.push(c);
    // debug compound box colliders
    {
      object3d.updateWorldMatrix(true, true);
      const bodyMatrixWorld = object3d.matrixWorld.clone();
      const bodyMatrixInv = bodyMatrixWorld.clone().invert();

      const tmpBox = new THREE.Box3();
      const tmpCenterWorld = new THREE.Vector3();
      const tmpSizeWorld = new THREE.Vector3();

      object3d.traverse((child) => {
        if (!child.isMesh) return;
        // world-space AABB of this mesh
        tmpBox.setFromObject(child);
        tmpBox.getCenter(tmpCenterWorld);
        tmpBox.getSize(tmpSizeWorld);
        // skip tiny boxes
        if (tmpSizeWorld.x < 0.01 && tmpSizeWorld.y < 0.01 && tmpSizeWorld.z < 0.01) return;
        // transform to body local
        const centerLocal = tmpCenterWorld.clone().applyMatrix4(bodyMatrixInv);
        const sx = Math.max(colliderScale[0] ?? 1, 0.0001);
        const sy = Math.max(colliderScale[1] ?? 1, 0.0001);
        const sz = Math.max(colliderScale[2] ?? 1, 0.0001);
        const hx = Math.max(tmpSizeWorld.x * 0.5 * sx, 0.005);
        const hy = Math.max(tmpSizeWorld.y * 0.5 * sy, 0.005);
        const hz = Math.max(tmpSizeWorld.z * 0.5 * sz, 0.005);
        addColliderDebugBoxForBody(
          body,
          new THREE.Vector3(hx, hy, hz),
          new THREE.Vector3(centerLocal.x, centerLocal.y, centerLocal.z),
          0x00ffff
        );
      });
    }
  } else {
    const scl = Math.max(colliderScale[0] ?? 1, colliderScale[1] ?? 1, colliderScale[2] ?? 1);
    const radius = (Math.max(size.x, size.y, size.z) * 0.5 || 0.5) * Math.max(scl, 0.0001);
    {
      const desc = rapier.ColliderDesc
        .ball(radius)
        .setFriction(friction)
        .setRestitution(restitution);
      // Only add density-based mass when no explicit targetMass is given
      if (typeof targetMass === 'undefined') desc.setDensity(density);
      const collider = rapierWorld.createCollider(desc, body);
      colliders.push(collider);
    }

    addColliderDebugCapsuleForBody(
        body,
        radius,
        radius,
        new THREE.Vector3(0, 0, 0),
        0x00ffff
      );
  }

  // If explicit target mass is requested, set it on the rigid body (overrides collider-based mass)
  if (typeof targetMass === 'number' && isFinite(targetMass) && targetMass > 0 && typeof body.setAdditionalMass === 'function') {
    body.setAdditionalMass(targetMass, true);
  }


  if (enableCcd) body.enableCcd(true);
  // 锁定 X/Z 旋转以防跌倒，并增加角阻尼帮助稳定
  if (lockXZRotation) {
    // body.setEnabledRotations(false, true, false, true);
    // const angDamp = Math.max(damping.ang ?? 0.05, 2.0);

    // const angDamp = 1.0;
    // body.setAngularDamping(angDamp);
  }

  // 注册同步（每帧从刚体同步到可视对象）
  
  function syncFunc() {
    const t = body.translation();
    const r = body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    // calculate offset in world space, instead of local space
    const offsetWorld = new THREE.Vector3(renderOffset.x, renderOffset.y, renderOffset.z).applyQuaternion(q);
    object3d.position.set(t.x + offsetWorld.x, t.y + offsetWorld.y, t.z + offsetWorld.z);
    object3d.quaternion.copy(q);
  }
  const entry = {
    object: object3d,
    rigidBody: (typeof entryOverrideBody !== 'undefined' && entryOverrideBody) ? entryOverrideBody : body,
    colliders,
    sync: syncFunc
  };
  dynamicGltfObjects.push(entry);

  return entry;
}

// FPS movement state
const movement = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  zombiesForward: false
};
// Player held slot/state (1..4)
let playerHeld = 1;
const moveSpeed = 100; // units per second
// Smoothed movement (EMA)
const smoothedMove = { forward: 0, right: 0 };
const movementSmoothing = 10;
// Gravity for FPS kinematic character
let verticalVelocity = 0;
const gravityAccel = -9.81*14;     // 地图尺寸有点大 放大3倍
const terminalFallSpeed = -300;  // clamp fall speed
// Jump state
let requestJump = false;
let isGrounded = false;                 // updated after controller move each frame
const jumpHeight = 10;                  // desired apex height in scene units
const getJumpVelocity = () => Math.sqrt(2 * (-gravityAccel) * jumpHeight);

/**
 * 初始化 Rapier 世界 + 常见刚体（地面/盒子）并返回一个 step(dt) 用于每帧推进
 * @param {THREE.Scene} scene
 */
export async function initPhysics(scene) {
    // 1) 初始化 WASM（必须 await）
    await RAPIER.init();
  
    // 2) 创建物理世界（重力向下）
    const world = new RAPIER.World({ x: 0, y: -9.81*14, z: 0 });
  
    // ---- 通用材质参数（你可以按需调整）----
    const groundFriction = 1.0;
    const groundRestitution = 0.0;
    const boxFriction = 0.7;
    const boxRestitution = 0.5;

    // 对象注册列表与辅助工厂
    const physicsObjects = [];

    // 接受一个entry，把其中的mesh添加到世界
    function addPhysicsObject(entry) {
      physicsObjects.push(entry);
      if (entry.mesh) scene.add(entry.mesh);
      return entry;
    }
    function makeBoxMesh(sizeX, sizeY, sizeZ, material) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sizeX, sizeY, sizeZ),
        material || new THREE.MeshStandardMaterial()
      );
      return mesh;
    }
    function createFixedCuboid({ halfExtents, position, friction, restitution, meshSize, meshPosition, material }) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(position[0], position[1], position[2])
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
          .setFriction(friction ?? 0.8)
          .setRestitution(restitution ?? 0.0),
        body
      );
      // debug collider
      addColliderDebugBoxForBody(
        { translation: () => ({ x: position[0], y: position[1], z: position[2] }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
        new THREE.Vector3(halfExtents[0], halfExtents[1], halfExtents[2]),
        new THREE.Vector3(0, 0, 0),
        0x00ffff
      );
      const mesh = makeBoxMesh(meshSize[0], meshSize[1], meshSize[2], material);
      mesh.position.set(meshPosition[0], meshPosition[1], meshPosition[2]);
      mesh.receiveShadow = true;

      return addPhysicsObject({
        body: body,
        colliders: [collider],
        mesh: mesh,
        sync: null // 静态对象无需每帧同步
      });
    }

    function createDynamicBox({ halfExtents, position, damping = { lin: 0.05, ang: 0.05 }, density = 1.0, friction = 0.7, 
        restitution = 0.0, canSleep = true, enableCcd = true, material }) {
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position[0], position[1], position[2])
        .setCanSleep(canSleep)
        .setLinearDamping(damping.lin)
        .setAngularDamping(damping.ang);

      const body = world.createRigidBody(desc);
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2])
          .setDensity(density)
          .setFriction(friction)
          .setRestitution(restitution),
        body
      );
      body.enableCcd(true);
      // debug collider
      addColliderDebugBoxForBody(
        body,
        new THREE.Vector3(halfExtents[0], halfExtents[1], halfExtents[2]),
        new THREE.Vector3(0, 0, 0),
        0x00ffff
      );
      const mesh = makeBoxMesh(halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2, material || new THREE.MeshStandardMaterial({ color: 0xff3333 }));
      mesh.castShadow = true;
      const entry = addPhysicsObject({
        body:body,
        colliders: [collider],
        mesh:mesh,
        sync: () => {
          const t = body.translation();
          const r = body.rotation();
          mesh.position.set(t.x, t.y, t.z);
          mesh.quaternion.set(r.x, r.y, r.z, r.w);
        }
      });
      return entry;
    }

    // 使用工厂与注册表创建物体
    createFixedCuboid({
      halfExtents: [20, 0.5, 20],
      position: [0, -0.5, 0],
      friction: groundFriction,
      restitution: groundRestitution,
      meshSize: [40, 1, 40],
      meshPosition: [0, -0.5, 0]
    });

    createDynamicBox({
      halfExtents: [3, 3, 5],
      position: [0, 4, 0],
      density: 1.0,
      friction: boxFriction,
      restitution: boxRestitution,
      damping: { lin: 0.05, ang: 0.05 },
      canSleep: true,
      enableCcd: true
    });
  
    // 5) 固定步长推进：更稳定（推荐）
    const fixedDt = 1 / 60;
    let accumulator = 0;
  
    /**
     * 每帧调用一次：传入真实 dt（秒）
     * @param {number} dtSec
     */
    function step(dtSec) {
      // 防止 tab 切换回来 dt 巨大导致“爆炸”
      const dt = Math.min(dtSec, 0.1);
      accumulator += dt;
  
      // 可选：限制每帧最多做多少次 substep，避免卡顿
      const maxSubSteps = 5;
      let n = 0;
  
      while (accumulator >= fixedDt && n < maxSubSteps) {
        world.step();
        accumulator -= fixedDt;
        n += 1;
      }
  
      // 同步注册对象：刚体 -> Mesh
      for (const obj of physicsObjects) {
        if (obj.sync) obj.sync();
      }
    }
  
    return {
      world,
      objects: physicsObjects,
      step
    };
  }
  
  /* 
  
  const clock = new THREE.Clock();
  const physics = await initPhysics(scene);
  
  function render() {
    const dt = clock.getDelta();
    physics.step(dt);
  
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();
  
  -------------------------------- */
function main() {
  canvas = document.getElementById("gl-canvas");
  renderer = new THREE.WebGLRenderer({ canvas });
  renderer.shadowMap.enabled = true;

  const fov = 65;
  const aspect = 2;  // the canvas default
  const near = 0.1;
  const far = 5000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0, 10, 20);


  createControls(camera);
  controls.update();

  // Create FPS camera + controls
  fpsCamera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  fpsCamera.position.set(-1700, 12, 800);
  fpsCamera.rotation.order = 'YXZ';
  fpsControls = new PointerLockControls(fpsCamera, renderer.domElement);
  fpsControls.pointerSpeed = 0.8;

  // create flashlight
  flashlight = new THREE.SpotLight(0xffffff, 30, 50, Math.PI / 6, 0.3, 1);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.width = 1024;
  flashlight.shadow.mapSize.height = 1024;
  flashlight.shadow.camera.near = 0.1;
  flashlight.shadow.camera.far = 150;
  flashlight.visible = false; // default off
  
  // 创建手电筒目标点
  const flashlightTarget = new THREE.Object3D();
  scene.add(flashlightTarget);
  flashlight.target = flashlightTarget;
  
  scene.add(flashlight);

  // Create kinematic capsule for FPS character and controller
  {
    const start = fpsCamera.position;
    playerBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y - cameraYOffset, start.z)
    );
    playerCollider = world.createCollider(
      RAPIER.ColliderDesc.capsule(capsule.halfHeight, capsule.radius)
        .setFriction(0.0)
        .setRestitution(0.0),
      playerBody
    );
    // Player belongs to bit 0; filter collides with everything except zombies (bit 1)
    // groups = (membership << 16) | filter
    playerCollider.setCollisionGroups((0x0001 << 16) | (0xFFFF ^ 0x0002));
    // debug player capsule
    addColliderDebugCapsuleForBody(playerBody, capsule.halfHeight, capsule.radius, 0xff00ff);
    charController = world.createCharacterController(1); // small character controller offset
    charController.setUp({ x: 0, y: 1, z: 0 });
    charController.setSlideEnabled(true);
    charController.enableAutostep(0.4, 0.3, false);
    charController.setMaxSlopeClimbAngle(Math.PI * 0.5);
    charController.setMinSlopeSlideAngle(Math.PI * 0.9);
    charController.enableSnapToGround(0.3);
    charController.setApplyImpulsesToDynamicBodies(true); // 允许对动态物体施加冲量并设置角色质量
    charController.setCharacterMass(800); // 近似人体质量，可按需要调整
  }



  // 统一初始化 HUD
  initPerfHUD();
  initDebugToggle();

  // get the crosshair element
  crosshairEl = document.getElementById('crosshair');

  // Set active camera/controls default to FPS
  activeCamera = fpsCamera;
  activeControls = fpsControls;
  // 显示十字准星
  if (crosshairEl) crosshairEl.style.display = 'block';

  // Toggle cameras with 'P'
  function toggleCamera() {
    if (activeCamera === camera) {
      // switch to FPS; reset to initial position
      fpsCamera.position.set(-1700, 12, 800);
      fpsCamera.quaternion.set(0, 0, 0, 1); // reset rotation
      fpsCamera.up.set(0, 1, 0);
      // sync kinematic body to camera
      if (playerBody) {
        playerBody.setNextKinematicTranslation({
          x: fpsCamera.position.x,
          y: fpsCamera.position.y - cameraYOffset,
          z: fpsCamera.position.z
        });
      }
      activeCamera = fpsCamera;
      activeControls = fpsControls;
      // 显示十字准星
      if (crosshairEl) crosshairEl.style.display = 'block';
    } else {
      // switch to orbit
      if (fpsControls.isLocked) fpsControls.unlock();
      camera.position.copy(fpsCamera.position);
      camera.quaternion.copy(fpsCamera.quaternion);
      activeCamera = camera;
      activeControls = controls;
      // 隐藏十字准星
      if (crosshairEl) crosshairEl.style.display = 'none';
    }
  }

  // Pointer lock on click when in FPS mode
  canvas.addEventListener('click', () => {
    if (activeControls === fpsControls && !fpsControls.isLocked) {
      fpsControls.lock();
    }
  });

  // WASD movement and toggle listener
  function onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': movement.forward = true; break;
      case 'KeyS': movement.backward = true; break;
      case 'KeyA': movement.left = true; break;
      case 'KeyD': movement.right = true; break;
      case 'KeyT': movement.zombiesForward = true; break;
      case 'Digit1': 
        playerHeld = 1; 
        // 隐藏其他武器
        if (rifle && rifle.object) rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (granade && granade.object) granade.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Numpad1': 
        playerHeld = 1; 
        if (rifle && rifle.object) rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (granade && granade.object) granade.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Digit2': 
        playerHeld = 2; 
        // 隐藏其他武器
        if (pistol && pistol.object) pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (granade && granade.object) granade.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Numpad2': 
        playerHeld = 2; 
        if (pistol && pistol.object) pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (granade && granade.object) granade.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Digit3': 
        playerHeld = 3; 
        // 隐藏其他武器
        if (pistol && pistol.object) pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (rifle && rifle.object) rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Numpad3': 
        playerHeld = 3; 
        if (pistol && pistol.object) pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (rifle && rifle.object) rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Digit4': 
        playerHeld = 4; 
        // 隐藏所有武器
        if (pistol && pistol.object) pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (rifle && rifle.object) rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (granade && granade.object) granade.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'Numpad4': 
        playerHeld = 4; 
        if (pistol && pistol.object) pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (rifle && rifle.object) rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
        if (granade && granade.object) granade.object.position.copy(HIDDEN_WEAPON_POSITION);
        break;
      case 'KeyY': {
        // 以玩家位置或相机位置为中心批量生成僵尸
        let c = null;
        
        const p = fpsCamera.position;
        c = [p.x, p.y, p.z];
        if (c) spawnZombiesAround(c, 5, 30);
        break;
      }
      case 'Space':
        if (activeControls === fpsControls) requestJump = true;
        break;
      case 'KeyP': toggleCamera(); break;
      case 'KeyF':
        // 切换手电筒开关
        flashlightEnabled = !flashlightEnabled;
        if (flashlight) {
          flashlight.visible = flashlightEnabled;
        }
        console.log('Flashlight', flashlightEnabled ? 'ON' : 'OFF');
        break;
      case 'KeyL': 
        // 将FPS相机移动到场景2物体的创建坐标
        if (fpsCamera && playerBody && scene2Position) {
          const targetPosition = scene2Position.clone().add(new THREE.Vector3(10, 15, 10)); // 场景2物体位置 + 相机高度偏移
          const bodyPosition = {
            x: targetPosition.x,
            y: targetPosition.y,
            z: targetPosition.z
          };
          
          // 立即设置物理体位置（对于 kinematic body，使用 setTranslation）
          playerBody.setTranslation(bodyPosition, true);
          // 同时设置下一帧的位置，确保同步
          playerBody.setNextKinematicTranslation(bodyPosition);
          
          // 设置相机位置
          fpsCamera.position.copy(targetPosition);
          fpsCamera.quaternion.set(0, 0, 0, 1); // 重置旋转
          fpsCamera.up.set(0, 1, 0);
          
          console.log('FPS camera moved to scene 2 position:', targetPosition, 'body position:', bodyPosition);
        } else if (!scene2Position) {
          console.warn('Scene 2 position not initialized yet');
        }
        break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': movement.forward = false; break;
      case 'KeyS': movement.backward = false; break;
      case 'KeyA': movement.left = false; break;
      case 'KeyD': movement.right = false; break;
      case 'KeyT': movement.zombiesForward = false; break;
    }
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Weapon handlers
  function weapon1({ point, owner }) {
    // 击中僵尸则造成伤害
    if (owner && typeof owner.health === 'number') {
      owner.health = Math.max(0, owner.health - 34);
      if (owner.health <= 0) {
        owner.state = 'dead';
      }
    }
    // 触发手枪后坐力与抖动
    pistolRecoil = Math.min(pistolRecoil + 1.0, 2.0);
    pistolShake = Math.min(pistolShake + 1.0, 2.0);
    // 播放手枪枪声
    if (!pistolSound) {
      pistolSound = new Audio('../Sounds/Pistol_Sound.mp3');
    }
    pistolSound.currentTime = 0; // 重置到开头
    pistolSound.play().catch(err => console.error('Failed to play pistol sound:', err));
    console.log('weapon1 fired at', point, 'owner:', owner);
  }
  function weapon2({ point, owner }) {
    if (owner && typeof owner.health === 'number') {
        owner.health = Math.max(0, owner.health - 100);
        if (owner.health <= 0) {
          owner.state = 'dead';
        }
      }
    // 触发步枪后坐力与抖动
    rifleRecoil = Math.min(rifleRecoil + 5.0, 6.0);
    rifleShake = Math.min(rifleShake + 5.0, 6.0);
    // 播放步枪枪声
    if (!rifleSound) {
      rifleSound = new Audio('../Sounds/Rifle_Sound.mp3');
    }
    rifleSound.currentTime = 0; // 重置到开头
    rifleSound.play().catch(err => console.error('Failed to play rifle sound:', err));
    console.log('weapon2 fired at', point, 'owner:', owner);
  }
  function weapon3({ point, owner }) {
    // 在 FPS 视角下从相机位置按相机朝向投掷手雷
    if (activeCamera === fpsCamera) {
      const throwPosition = fpsCamera.position.clone();
      const throwDirection = new THREE.Vector3();
      fpsCamera.getWorldDirection(throwDirection);
      
      // 投掷手雷，并在创建后设置6秒销毁定时器
      throwGranade(throwPosition, throwDirection, 200, function(granadeInstance) {
        // 6秒后销毁手雷并创建红色球体
        granadeInstance.timeoutId = setTimeout(function() {
          if (!granadeInstance || !granadeInstance.object) return;
          
          // 获取手雷当前位置
          let explosionPosition;
          if (granadeInstance.rigidBody) {
            const pos = granadeInstance.rigidBody.translation();
            explosionPosition = new THREE.Vector3(pos.x, pos.y, pos.z);
          } else if (granadeInstance.object) {
            explosionPosition = granadeInstance.object.position.clone();
          } else {
            return;
          }
          
          // 创建红色球体
          const sphereGeometry = new THREE.SphereGeometry(1, 32, 32);
          const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
          const redSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
          redSphere.position.copy(explosionPosition);
          redSphere.castShadow = true;
          redSphere.receiveShadow = true;
          scene.add(redSphere);
          
          // deal damage to zombies within explosion radius
          const explosionRadius = 80;
          let damagedZombies = 0;
          for (const z of zombies) {
            if (!z || !z.rigidBody ) continue;
            // 跳过已死亡的僵尸
            if (z.health <= 0) continue;
            
            // 获取僵尸位置
            let zombiePosition;
            if (z.rigidBody) {
              const pos = z.rigidBody.translation();
              zombiePosition = new THREE.Vector3(pos.x, pos.y, pos.z);
            } else if (z.object) {
              zombiePosition = z.object.position.clone();
            } else {
              continue;
            }
            
            // 计算距离
            const distance = explosionPosition.distanceTo(zombiePosition);
            
            // 如果在爆炸范围内，造成伤害
            if (distance <= explosionRadius) {
              z.health = Math.max(0, z.health - 100);
              damagedZombies++;
              
              // 如果血量归零，设置状态为死亡
              if (z.health <= 0) {
                z.state = 'dead';
              }
            }
          }
          if (damagedZombies > 0) {
            console.log('Explosion damaged', damagedZombies, 'zombies within radius', explosionRadius);
          }
          
          
          // 播放爆炸声
          if (!explosionSound) {
            explosionSound = new Audio('../Sounds/explosion.mp3');
          }
          explosionSound.currentTime = 0; // 重置到开头
          explosionSound.play().catch(err => console.error('Failed to play explosion sound:', err));
          
          // 停止闪烁效果并恢复材质
          if (granadeInstance.flashInterval) {
            clearInterval(granadeInstance.flashInterval);
            granadeInstance.flashInterval = null;
          }
          if (granadeInstance.originalMaterials) {
            granadeInstance.originalMaterials.forEach(item => {
              item.material.emissive.copy(item.originalEmissive);
              item.material.emissiveIntensity = item.originalEmissiveIntensity;
            });
            granadeInstance.originalMaterials = null;
          }
          
          // 移除手雷上的红色光源
          if (granadeInstance.redLight) {
            scene.remove(granadeInstance.redLight);
            if (granadeInstance.redLight.dispose) {
              granadeInstance.redLight.dispose();
            }
            granadeInstance.redLight = null;
          }
          
          // 将手雷移回不可见区域（回收）
          returnGranadeToPool(granadeInstance);
          
          console.log('Granade exploded at position:', explosionPosition, 'and left a red sphere');
        }, 6000); // 6秒 = 6000毫秒
      });
      
      console.log('weapon3: Granade thrown from camera position', throwPosition, 'direction:', throwDirection);
    } else {
      console.log('weapon3 fired at', point, 'owner:', owner);
    }
  }
  function weapon4({ point, owner }) {
    console.log('weapon4 fired at', point, 'owner:', owner);
  }

  // FPS-only primary button (left mouse) callback hook
  function onFpsPrimaryFire(e) {
    // Raycast from FPS camera forward; render a small sphere at the hit point (or a far point if no hit)
    const raycaster = new THREE.Raycaster();
    const origin = new THREE.Vector3().copy(fpsCamera.position);
    const dir = new THREE.Vector3();
    fpsCamera.getWorldDirection(dir);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(scene.children, true);
    let point = null;
    if (hits && hits.length > 0) {
      const hit = hits[0];
      point = hit.point.clone();
      const owner = hit.object && hit.object.userData ? hit.object.userData.owner : null;
      console.log('Hit target:', owner || hit.object);
      const target = owner || hit.object;
      switch (playerHeld) {
        case 1: weapon1({ point, owner: target }); break;
        case 2: weapon2({ point, owner: target }); break;
        case 3: weapon3({ point, owner: target }); break;
        case 4: weapon4({ point, owner: target }); break;
      }
    } else {
      // no intersection: place marker at a far point along the ray
      point = origin.clone().add(dir.clone().multiplyScalar(1000));
      console.log('Hit target: none');
      switch (playerHeld) {
        case 1: weapon1({ point, owner: null }); break;
        case 2: weapon2({ point, owner: null }); break;
        case 3: weapon3({ point, owner: null }); break;
        case 4: weapon4({ point, owner: null }); break;
      }
    }
    // Place a green sphere at the decided point (auto-remove after a short delay)
    if(DEBUG){
        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0x00ff00 })
          );
          marker.position.copy(point);
          scene.add(marker);
          setTimeout(() => {
            scene.remove(marker);
            if (marker.geometry) marker.geometry.dispose();
            if (marker.material) marker.material.dispose();
          }, 1000);
    }
  }
  function onMouseDown(e) {
    if (activeControls === fpsControls && fpsControls.isLocked && e.button === 0) {
      onFpsPrimaryFire(e);
    }
  }
  window.addEventListener('mousedown', onMouseDown);

  // createZombieAt 
  async function createZombieAt(position) {
    return new Promise((resolve) => {
      const dynLoader = new GLTFLoader();
      dynLoader.load('../GlTF_Models/glTF/Zombie_Basic.gltf', function (gltf) {
        const z = createDynamicGLTF({
          object3d: gltf.scene,
          position: position,
          rotation: [0, 0, 0],
          scale: [10, 10, 10],
          enableShadows: true,
          shape: 'box',
          density: 0.5,
          friction: 0.8,
          restitution: 0.1,
          damping: { lin: 0.1, ang: 0.1 },
          canSleep: true,
          enableCcd: true,
          renderOffset: { x: 0, y: -8, z: 0 },
          colliderScale: [0.5, 1.1, 0.8],
          lockXZRotation: true
        });
        zombies.push(z);
        // 给僵尸所有sub mesh打上 owner 标记，便于命中后回溯到僵尸对象
        if (z.object) {
          z.object.traverse(o => {
            if (!o.userData) o.userData = {};
            o.userData.owner = z;
          });
        }
        if (z && z.rigidBody) {
          z.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }
        z.vy = 0;
        // 僵尸状态：'idle' | 'moving' | 'dead'
        z.state = 'idle';
        // 生命值（为 0 时置为 'dead' 并停止移动）
        z.health = 100;
        // 禁用原模型复合盒与地面的实体碰撞，避免与控制器胶囊互相干扰（保留渲染/同步）
        // 真的应该这么做吗？。。。。先mark一下 不太确定

        for (const c of z.colliders) {
        c.setSensor(true);
        }


    // 角色控制用胶囊
        const bbox = new THREE.Box3().setFromObject(z.object);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const minRadius = 0.2;
        const radius = Math.max(minRadius, Math.min(size.x, size.z) * 0.35);
        const halfHeight = Math.max(0.1, (size.y * 0.5) - radius) + 3;
        const ctrl = world.createCollider(
          RAPIER.ColliderDesc.capsule(halfHeight, radius)
            .setFriction(0.0)
            .setRestitution(0.0),
          z.rigidBody
        );
        // Zombie belongs to bit 1; filter collides with everything except player (bit 0)
        ctrl.setCollisionGroups((0x0002 << 16) | (0xFFFF ^ 0x0001));
        z.controllerCollider = ctrl;
        addColliderDebugCapsuleForBody(z.rigidBody, halfHeight, radius, 0x00ff00);

        // character controller for every single zombie
        z.kcc = world.createCharacterController(0.5);
        z.kcc.setUp({ x: 0, y: 1, z: 0 });
        z.kcc.setSlideEnabled(true);
        z.kcc.enableAutostep(0.4, 0.3, false);
        z.kcc.setMaxSlopeClimbAngle(Math.PI * 0.5);
        z.kcc.setMinSlopeSlideAngle(Math.PI * 0.9);
        z.kcc.enableSnapToGround(0.3);
        z.kcc.setApplyImpulsesToDynamicBodies(true);
        z.kcc.setCharacterMass(200);

        // 动画
        const zm = new THREE.AnimationMixer(gltf.scene);
        zombieMixers.push(zm);
        mixers.push(zm);
        // 记录到僵尸对象上，便于按状态切换动画
        z.mixer = zm;
        z.animations = gltf.animations;
        z.currentAction = null;
        z.currentAnimIndex = null;
        // 初始状态为 idle，则播放索引 3 的动画（若存在）

        const act = zm.clipAction(gltf.animations[3]);
        act.reset().setLoop(THREE.LoopRepeat).play();
        z.currentAction = act;
        z.currentAnimIndex = 3;


        resolve(z);
      }, undefined, function (error) {
        console.error(error);
        resolve(null);
      });
    });
  }

  // spawn zombies around a center point
  async function spawnZombiesAround(center, count = 5, radius = 80) {
    const cx = Array.isArray(center) ? center[0] : center.x;
    const cy = Array.isArray(center) ? center[1] : center.y;
    const cz = Array.isArray(center) ? center[2] : center.z;
    const tasks = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * radius;
      const x = cx + Math.cos(ang) * dist;
      const z = cz + Math.sin(ang) * dist;
      const y = cy;
      tasks.push(createZombieAt([x, y, z]));
    }
    return Promise.all(tasks);
  }

  // 创建场景1的所有对象
  function createScene1() {
    scene.background = new THREE.Color('black');

    const loader = new GLTFLoader();
    // load city building set 1
    loader.load('../GlTF_Models/ccity_building_set_1/scene.gltf', function (gltf) {

        const { rigidBody } = createStaticGLTF({
        object3d: gltf.scene,
        position: [-6, -5, -3],
        scale: [0.09, 0.09, 0.09],
        rotation: [0, Math.PI * (1 / 4), 0],
        enableShadows: true,
        addCollider: true
      });

      if (gltf.animations && gltf.animations.length > 0) {
        const m = new THREE.AnimationMixer(gltf.scene);
        mixers.push(m);
        const action = m.clipAction(gltf.animations[0]);
        action.play(); //激活动作 然后在渲染部分调用mixer.update(dt)更新动作
      }
      
      map_city = rigidBody;

    }, undefined, function (error) {

      console.error(error);

    });
    // ..\GlTF_Models\glTF\Vehicle_Pickup_Armored.gltf
    const dynLoader = new GLTFLoader();
    dynLoader.load('../GlTF_Models/glTF/Vehicle_Pickup_Armored.gltf', function (gltf) {
      createDynamicGLTF({
        object3d: gltf.scene,
        position: [-441, 20, -22],
        rotation: [0, 0, 0],
        scale: [10, 10, 10],
        enableShadows: true,
        shape: 'compound',            // 或 'sphere'
        // Use explicit mass and lower friction to make it pushable
        targetMass: 200,
        friction: 0.3,
        restitution: 0.1,
        damping: { lin: 0.1, ang: 0.1 },
        canSleep: true,
        enableCcd: true,
        renderOffset: { x: 0, y: -9.5, z: 0 }
      });

    }, undefined, function (error) {

      console.error(error);

    });

    dynLoader.load('../GlTF_Models/glTF/Pistol.gltf', function (gltf) {
      pistol = createDynamicGLTF({
        object3d: gltf.scene,
        position: [-441, 50, -22],
        rotation: [0, 0, 0],
        scale: [18, 18, 18],
        enableShadows: true,
        shape: 'No',            // 或 'sphere'
        // Use explicit mass and lower friction to make it pushable
        targetMass: 200,
        friction: 0.3,
        restitution: 0.1,
        damping: { lin: 0.1, ang: 0.1 },
        canSleep: true,
        enableCcd: true,
        renderOffset: { x: 0, y: -9.5, z: 0 }
      });
      // 如果当前不是武器1，则隐藏手枪
      if (playerHeld !== 1 && pistol && pistol.object) {
        pistol.object.position.copy(HIDDEN_WEAPON_POSITION);
      }

    }, undefined, function (error) {

      console.error(error);

    });

    dynLoader.load('../GlTF_Models/glTF/Rifle.gltf', function (gltf) {
      rifle = createDynamicGLTF({
        object3d: gltf.scene,
        position: [-441, 50, -22],
        rotation: [0, 0, 0],
        scale: [18, 18, 18],
        enableShadows: true,
        shape: 'No',
        // Use explicit mass and lower friction to make it pushable
        targetMass: 200,
        friction: 0.3,
        restitution: 0.1,
        damping: { lin: 0.1, ang: 0.1 },
        canSleep: true,
        enableCcd: true,
        renderOffset: { x: 0, y: -9.5, z: 0 }
      });
      // 如果当前不是武器2，则隐藏步枪
      if (playerHeld !== 2 && rifle && rifle.object) {
        rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
      }

    }, undefined, function (error) {

      console.error(error);

    });

    // initialize granade pool
    function initGranadePool() {
      const dynLoader = new GLTFLoader();
      dynLoader.load('../GlTF_Models/toon_granade/scene.gltf', function (gltf) {

        for (let i = 0; i < GRANADE_POOL_SIZE; i++) {
          const granadeInstance = createDynamicGLTF({
            object3d: gltf.scene.clone(), // 克隆场景以避免共享
            position: [HIDDEN_WEAPON_POSITION.x, HIDDEN_WEAPON_POSITION.y, HIDDEN_WEAPON_POSITION.z],
            rotation: [0, 0, 0],
            scale: [1.8, 1.8, 1.8],
            enableShadows: true,
            shape: 'sphere',
            targetMass: 200,
            friction: 0.3,
            restitution: 0.4,
            damping: { lin: 0.1, ang: 0.1 },
            canSleep: true,
            enableCcd: true,
            renderOffset: { x: 0, y: -1, z: 0 }
          });
          
          // 标记为可用
          granadeInstance.isAvailable = true;
          granadeInstance.timeoutId = null;
          granadePool.push(granadeInstance);
        }
        console.log('Granade pool initialized with', GRANADE_POOL_SIZE, 'granades');
      }, undefined, function (error) {
        console.error('Failed to load granade model for pool:', error);
      });
    }
    

    initGranadePool();

    dynLoader.load('../GlTF_Models/toon_granade/scene.gltf', function (gltf) {
      granade = createDynamicGLTF({
        object3d: gltf.scene,
        position: [-500, 540, -22],
        rotation: [0, 0, 0],
        scale: [1.8, 1.8, 1.8],
        enableShadows: true,
        shape: 'sphere',
        // Use explicit mass and lower friction to make it pushable
        targetMass: 200,
        friction: 0.3,
        restitution: 0.4,
        damping: { lin: 0.1, ang: 0.1 },
        canSleep: true,
        enableCcd: true,
        renderOffset: { x: 0, y: -1, z: 0 }
      });
      // hide granade if not weapon 3
      // if (playerHeld !== 3 && granade && granade.object) {
      //   granade.object.position.copy(HIDDEN_WEAPON_POSITION);
      // }

    }, undefined, function (error) {

      console.error(error);

    });



    createZombieAt([-207, 20, -41]);
    createZombieAt([-217, 20, -21]);
    createZombieAt([-208, 30, -41]);
    createZombieAt([-237, 20, -41]);

    // car lights
    const pointLightAtPosition = new THREE.PointLight(0xffffaa, 400, 100);
    pointLightAtPosition.position.set(1323, 30, 270);
    pointLightAtPosition.castShadow = true;
    scene.add(pointLightAtPosition);

    pointLightAtPosition.position.set(1334, 30, 251);
    pointLightAtPosition.castShadow = true;
    scene.add(pointLightAtPosition);


    // init lighting and skybox
    initLighting(DEBUG);
    initSkybox();
  }

  function createScene2(){
    scene.background = new THREE.Color('black');

    const loader = new GLTFLoader();
    // load static GLTF model for scene 2
    loader.load('../GlTF_Models/shooting_range/scene.gltf', function (gltf) {
        const scene2Pos = [-6362, 732, -13395]; // 场景2物体的创建位置
        scene2Position = new THREE.Vector3(scene2Pos[0], scene2Pos[1], scene2Pos[2]);

        const { rigidBody } = createStaticGLTF({
        object3d: gltf.scene,
        position: scene2Pos,
        scale: [4, 4, 4],
        rotation: [0, 0, 0],
        enableShadows: true,
        addCollider: true
      });

      if (gltf.animations && gltf.animations.length > 0) {
        const m = new THREE.AnimationMixer(gltf.scene);
        mixers.push(m);
        const action = m.clipAction(gltf.animations[0]);
        action.play(); //激活动作 然后在渲染部分调用mixer.update(dt)更新动作
      }
      
      // 可以保存刚体引用，如果需要后续操作
      // map_scene2 = rigidBody;

    }, undefined, function (error) {

      console.error(error);

    });
  }

  // get a available granade from pool
  function getGranadeFromPool() {
    for (let i = 0; i < granadePool.length; i++) {
      if (granadePool[i].isAvailable) {
        return granadePool[i];
      }
    }
    return null; // pool is used up
  }
  
  // return granade to pool
  function returnGranadeToPool(granadeInstance) {
    if (!granadeInstance) return;
    
    // clear previous timer
    if (granadeInstance.timeoutId) {
      clearTimeout(granadeInstance.timeoutId);
      granadeInstance.timeoutId = null;
    }
    
    // stop lighting
    if (granadeInstance.flashInterval) {
      clearInterval(granadeInstance.flashInterval);
      granadeInstance.flashInterval = null;
    }
    if (granadeInstance.originalMaterials) {
      granadeInstance.originalMaterials.forEach(item => {
        item.material.emissive.copy(item.originalEmissive);
        item.material.emissiveIntensity = item.originalEmissiveIntensity;
      });
      granadeInstance.originalMaterials = null;
    }
    
    // 移除手雷上的红色光源
    if (granadeInstance.redLight) {
      scene.remove(granadeInstance.redLight);
      if (granadeInstance.redLight.dispose) {
        granadeInstance.redLight.dispose();
      }
      granadeInstance.redLight = null;
    }
    
    if (granadeInstance.rigidBody) {
      granadeInstance.rigidBody.setTranslation(HIDDEN_WEAPON_POSITION, true);
      granadeInstance.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      granadeInstance.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    if (granadeInstance.object) {
      granadeInstance.object.position.copy(HIDDEN_WEAPON_POSITION);
    }
    
    // mark as available
    granadeInstance.isAvailable = true;
  }
  
  // throw granade from pool
  function throwGranade(position, direction, speed = 15, onCreated = null) {
    // 确保 direction 是 THREE.Vector3
    const dir = direction instanceof THREE.Vector3 
      ? direction.clone().normalize() 
      : new THREE.Vector3(...direction).normalize();
    
    // 确保 position 是数组格式
    const pos = position instanceof THREE.Vector3 
      ? [position.x, position.y, position.z]
      : position;
    
    // 从对象池获取一个可用的手雷
    const granadeInstance = getGranadeFromPool();
    if (!granadeInstance) {
      console.warn('No available granade in pool');
      return;
    }
    
    granadeInstance.isAvailable = false;
    
    if (granadeInstance.rigidBody) {
      granadeInstance.rigidBody.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    }
    if (granadeInstance.object) {
      granadeInstance.object.position.set(pos[0], pos[1], pos[2]);
    }
    
    if (granadeInstance.rigidBody) {
      const velocity = dir.clone().multiplyScalar(speed);
      granadeInstance.rigidBody.setLinvel(
        { x: velocity.x, y: velocity.y, z: velocity.z },
        true
      );
    }
    
    console.log('Granade thrown at', pos, 'direction:', dir, 'speed:', speed);
    
    // add red light to granade
    if (granadeInstance && granadeInstance.object) {
      const redLight = new THREE.PointLight(0xff0000, 100, 20);
      redLight.castShadow = false;
      scene.add(redLight);
      granadeInstance.redLight = redLight; // store light reference
      
      // set initial light position
      if (granadeInstance.rigidBody) {
        const bodyPos = granadeInstance.rigidBody.translation();
        redLight.position.set(bodyPos.x, bodyPos.y, bodyPos.z);
      } else if (granadeInstance.object) {
        redLight.position.copy(granadeInstance.object.position);
      }
    }
    
    // add flash red light effect to granade


    const originalMaterials = [];
    granadeInstance.object.traverse(function(child) {
    if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
        // store original emissive property
        originalMaterials.push({
        material: mat,
        originalEmissive: mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000),
        originalEmissiveIntensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 0
        });
        // set red emissive
        mat.emissive = new THREE.Color(0xff0000);
        mat.emissiveIntensity = 0;
        });
    }
    });
    
    // flash effect
    let isBright = false;
    const flashInterval = setInterval(function() {
    isBright = !isBright;
    const intensity = isBright ? 1.5 : 0.3;
    originalMaterials.forEach(item => {
        item.material.emissiveIntensity = intensity;
    });
    }, 100); // flash every 100ms
    
    // store flash timer to granade instance, so it can be cleared when exploding
    granadeInstance.flashInterval = flashInterval;
    granadeInstance.originalMaterials = originalMaterials;
    
    
    // call callback function, pass granade instance
    if (onCreated) {
      onCreated(granadeInstance);
    }
  }

  // create scene 1
  createScene1();
  createScene2();
  

  
  requestAnimationFrame(render);

  window.addEventListener('resize', onWindowResize);

}

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}

function updateCameraAspectOnResize(renderer, camera, fpsCamera) {
  const canvas = renderer.domElement;
  const newAspect = canvas.clientWidth / canvas.clientHeight;
  camera.aspect = newAspect;
  camera.updateProjectionMatrix();
  if (fpsCamera) {
    fpsCamera.aspect = newAspect;
    fpsCamera.updateProjectionMatrix();
  }
}

// update FPS character controller and camera sync per frame
function stepFpsController(dt) {
  // FPS movement step
  if (activeControls === fpsControls && fpsControls.isLocked) {
    // Use a tighter clamp for movement to avoid big jumps on frame drops
    const moveDt = Math.min(dt, 0.033);
    const distance = moveSpeed * moveDt;
    // Ensure movement axes use latest camera orientation (after mouse yaw/pitch)
    fpsCamera.updateMatrixWorld(true);
    // Build input vector (forward/back, right/left) in world XZ plane
    const inputForward = (movement.forward ? 1 : 0) + (movement.backward ? -1 : 0);
    const inputRight = (movement.right ? 1 : 0) + (movement.left ? -1 : 0);
    const mag = Math.hypot(inputForward, inputRight);
    const targetF = mag > 0 ? inputForward / mag : 0;
    const targetR = mag > 0 ? inputRight / mag : 0;
    const alpha = 1 - Math.exp(-movementSmoothing * moveDt);
    smoothedMove.forward += (targetF - smoothedMove.forward) * alpha;
    smoothedMove.right += (targetR - smoothedMove.right) * alpha;
    // derive world-space move dir from camera yaw
    const camDir = new THREE.Vector3();
    fpsCamera.getWorldDirection(camDir);
    camDir.y = 0; camDir.normalize();
    // right direction
    const rightDir = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
    const desired = new THREE.Vector3()
      .addScaledVector(camDir, smoothedMove.forward * distance)
      .addScaledVector(rightDir, smoothedMove.right * distance);
    // jump request (use last frame grounded state)
    if (requestJump && isGrounded) {
      verticalVelocity = getJumpVelocity();
      requestJump = false;
    }
    // integrate gravity for vertical motion
    verticalVelocity += gravityAccel * moveDt;
    if (verticalVelocity < terminalFallSpeed) verticalVelocity = terminalFallSpeed;
    desired.y = verticalVelocity * moveDt;
    // character controller collision-aware movement

    // 这里才是真正的移动
    if (charController && playerBody && playerCollider) {
      charController.computeColliderMovement(playerCollider, { x: desired.x, y: desired.y, z: desired.z });
      const delta = charController.computedMovement();
      const cur = playerBody.translation();
      playerBody.setNextKinematicTranslation({ x: cur.x + delta.x, y: cur.y + delta.y, z: cur.z + delta.z });
      // reset vertical velocity when grounded to avoid sinking
      isGrounded = charController.computedGrounded();
      if (isGrounded && verticalVelocity < 0) {
        verticalVelocity = 0;
      }
    }
  }

  // Sync fps camera position to the kinematic body (follow capsule)
  if (activeCamera === fpsCamera && playerBody) {
    const p = playerBody.translation();
    fpsCamera.position.set(p.x, p.y + cameraYOffset, p.z);
  }
}

// Sync FPS camera with everything that needs to be synced
function updateFpsCamera() {
  if (activeCamera === fpsCamera && playerBody) {
    const p = playerBody.translation();
    fpsCamera.position.set(p.x, p.y + cameraYOffset, p.z);
  }
  
  // update flashlight position and direction (follow FPS camera)
  if (flashlight && activeCamera === fpsCamera) {
    flashlight.position.copy(fpsCamera.position);
    const forward = new THREE.Vector3();
    fpsCamera.getWorldDirection(forward);
    // use cloned vector to avoid modifying original vector
    const targetPos = fpsCamera.position.clone().add(forward.clone().multiplyScalar(10));
    flashlight.target.position.copy(targetPos);
    flashlight.target.updateMatrixWorld();
  }
  // Camera shake based on active-weapon recoil (position jitter and slight pitch/yaw)
  let currentRecoil = 0;
  if (playerHeld === 1) currentRecoil = pistolRecoil;
  else if (playerHeld === 2) currentRecoil = rifleRecoil;

  if (activeCamera === fpsCamera && currentRecoil > 0) {
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const mag = currentRecoil * 0.015;
    const jitterR = (Math.random() * 2 - 1) * mag;
    const jitterU = (Math.random() * 2 - 1) * mag;
    fpsCamera.position.addScaledVector(camRight, jitterR).addScaledVector(camUp, jitterU);
    // subtle pitch-up based on recoil
    const pitchAngle = Math.min(0.1, currentRecoil * 0.001);
    if (pitchAngle > 0) {
      const qPitchCam = new THREE.Quaternion().setFromAxisAngle(camRight, pitchAngle);
      // apply as a world-space rotation so it feels like a screen shake
      fpsCamera.quaternion.premultiply(qPitchCam);
    }
    // subtle random left-right sway (yaw) based on recoil
    const yawAngle = (Math.random() * 2 - 1) * Math.min(0.05, currentRecoil * 0.002);
    if (yawAngle !== 0) {
      const qYawCam = new THREE.Quaternion().setFromAxisAngle(camUp, yawAngle);
      fpsCamera.quaternion.premultiply(qYawCam);
    }
  }
  // Update pistol position and orientation based on camera
  if (activeCamera === fpsCamera && playerHeld === 1) {
    const forward = new THREE.Vector3();
    fpsCamera.getWorldDirection(forward);

    const desired = new THREE.Vector3().copy(fpsCamera.position).add(forward.multiplyScalar(6));
    // Offset in camera space so it sticks to the bottom-right of the screen
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const offsetRight = 4.5; // adjust to taste
    const offsetDown = 5.0;  // adjust to taste
    desired.addScaledVector(camRight, offsetRight).addScaledVector(camUp, -offsetDown);
    // Recoil: move slightly backwards along view direction
    if (pistolRecoil > 0) {
      const recoilBack = Math.min(0.6, 0.3 * pistolRecoil);
      desired.addScaledVector(forward, -recoilBack*1.3);
    }
    // Shake: small random jitter in right/up directions
    if (pistolShake > 0) {
      const jitterR = (Math.random() * 2 - 1) * 0.08 * pistolShake;
      const jitterU = (Math.random() * 2 - 1) * 0.08 * pistolShake;
      desired.addScaledVector(camRight, jitterR).addScaledVector(camUp, jitterU);
    }
    pistol.object.position.copy(desired);
    // Orientation: camera facing + 180° yaw, plus small pitch/yaw/roll from recoil/shake
    const yaw180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const qBase = new THREE.Quaternion().copy(fpsCamera.quaternion).multiply(yaw180);
    // Pitch kick (upwards) around camera right axis
    const pitchKick = Math.min(0.25, 0.08 * pistolRecoil);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(camRight, -pitchKick);
    // Yaw/roll shake
    const yawJ = (Math.random() * 2 - 1) * 0.04 * pistolShake;
    const rollJ = (Math.random() * 2 - 1) * 0.06 * pistolShake;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(camUp, yawJ);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(forward, rollJ);
    pistol.object.quaternion.copy(qBase).multiply(qPitch).multiply(qYaw).multiply(qRoll);
  }
  // Update rifle position and orientation based on camera
  if (activeCamera === fpsCamera && playerHeld === 2) {
    const forward = new THREE.Vector3();
    fpsCamera.getWorldDirection(forward);

    const desired = new THREE.Vector3().copy(fpsCamera.position).add(forward.multiplyScalar(6));
    // Screen bottom-right offset
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const offsetRight = 4.5;
    const offsetDown = 5.0;
    desired.addScaledVector(camRight, offsetRight).addScaledVector(camUp, -offsetDown);
    // Recoil pushback
    if (rifleRecoil > 0) {
      const recoilBack = Math.min(0.6, 0.3 * rifleRecoil);
      desired.addScaledVector(forward, -recoilBack * 1.3);
    }
    // Shake jitter
    if (rifleShake > 0) {
      const jitterR = (Math.random() * 2 - 1) * 0.08 * rifleShake;
      const jitterU = (Math.random() * 2 - 1) * 0.08 * rifleShake;
      desired.addScaledVector(camRight, jitterR).addScaledVector(camUp, jitterU);
    }
    rifle.object.position.copy(desired);
    // Orientation with pitch/yaw/roll perturbation
    const yaw180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const qBase = new THREE.Quaternion().copy(fpsCamera.quaternion).multiply(yaw180);
    const pitchKick = Math.min(0.25, 0.08 * rifleRecoil);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(camRight, -pitchKick);
    const yawJ = (Math.random() * 2 - 1) * 0.04 * rifleShake;
    const rollJ = (Math.random() * 2 - 1) * 0.06 * rifleShake;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(camUp, yawJ);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(forward, qBase.equals(qBase) ? rollJ : rollJ);
    rifle.object.quaternion.copy(qBase).multiply(qPitch).multiply(qYaw).multiply(qRoll);
  }
  // Update granade position and orientation based on camera
  if (activeCamera === fpsCamera && playerHeld === 3) {
    const forward = new THREE.Vector3();
    fpsCamera.getWorldDirection(forward);

    const desired = new THREE.Vector3().copy(fpsCamera.position).add(forward.multiplyScalar(6));
    // Screen bottom-right offset
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(fpsCamera.quaternion).normalize();
    const offsetRight = 2.5;
    const offsetDown = 3.0;
    desired.addScaledVector(camRight, offsetRight).addScaledVector(camUp, -offsetDown);
    
    granade.object.position.copy(desired);
    // Orientation: camera facing + 180° yaw
    const yaw180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const qBase = new THREE.Quaternion().copy(fpsCamera.quaternion).multiply(yaw180);
    granade.object.quaternion.copy(qBase);
  }
}

function render(ts) {
  // 如果菜单可见，暂停渲染
  if (isMenuVisible) {
    requestAnimationFrame(render);
    return;
  }
  
  // start stats, for performance monitoring
  if (stats) stats.begin();

  function updateZombies(dt) {
    if (!(zombies && zombies.length > 0)) return;
    // mark all alive zombies as idle if not pressing T
    if (!(movement && movement.zombiesForward)) {
      for (const z of zombies) {
        if (!z) continue;
        if (typeof z.health === 'number' && z.health <= 0) {
          // 切换为 dead 并播放一次索引 1 的死亡动画（仅播放一次）
          if (z.state !== 'dead') {
            z.state = 'dead';
          }
          if (Array.isArray(z.animations) && z.animations[1] && z.currentAnimIndex !== 1) {
            if (z.currentAction && typeof z.currentAction.stop === 'function') {
              z.currentAction.stop();
            }
            const act = z.mixer.clipAction(z.animations[1]);
            act.reset().setLoop(THREE.LoopOnce, 0);
            act.clampWhenFinished = true;
            act.play();
            z.currentAction = act;
            z.currentAnimIndex = 1;
          }
          continue;
        }
        if (z.state !== 'dead') {
          z.state = 'idle';
          // 播放 idle 动画（索引 3），避免重复切换

        if (z.currentAnimIndex !== 3) {
            if (z.currentAction && typeof z.currentAction.stop === 'function') {
            z.currentAction.stop();
            }
            const act = z.mixer.clipAction(z.animations[3]);
            act.reset().setLoop(THREE.LoopRepeat).play();
            z.currentAction = act;
            z.currentAnimIndex = 3;
        }

        }
      }
      return;
    }
    const moveSpeed = 10; // 可按需要调整速度（单位：m/s）
    for (const z of zombies) {
      if (!z || !z.rigidBody || !z.kcc) continue;
      // 死亡则不再移动
      if (typeof z.health === 'number' && z.health <= 0) {
        z.state = 'dead';
        continue;
      }
      z.state = 'moving';
      // 播放“移动”动画：索引 13（若已是 13 则不重复切换）
      if (z.currentAnimIndex !== 13) {
        if (z.currentAction && typeof z.currentAction.stop === 'function') {
          z.currentAction.stop();
        }
        const act = z.mixer.clipAction(z.animations[13]);
        act.reset().setLoop(THREE.LoopRepeat).play();
        z.currentAction = act;
        z.currentAnimIndex = 13;
      }

      // 定期随机设定目标朝向（绕 Y 轴），并以一定角速度转向
      z.turnTime = (typeof z.turnTime === 'number') ? z.turnTime : 0;
      z.turnTime -= dt;
      if (typeof z.targetYaw !== 'number') {
        const initQ = new THREE.Quaternion(z.rigidBody.rotation().x, z.rigidBody.rotation().y, z.rigidBody.rotation().z, z.rigidBody.rotation().w);
        const initE = new THREE.Euler().setFromQuaternion(initQ, 'YXZ');
        z.targetYaw = initE.y;
        z.turnTime = 0;
      }
      if (z.turnTime <= 0) {
        z.targetYaw = Math.random() * Math.PI * 2;
        z.turnTime = 0.8 + Math.random() * 1.2;
      }
      const curQ = new THREE.Quaternion(z.rigidBody.rotation().x, z.rigidBody.rotation().y, z.rigidBody.rotation().z, z.rigidBody.rotation().w);
      const curE = new THREE.Euler().setFromQuaternion(curQ, 'YXZ');
      const curYaw = curE.y;
      let deltaYaw = z.targetYaw - curYaw;
      deltaYaw = ((deltaYaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      const turnSpeed = Math.PI;
      const maxStep = turnSpeed * dt;
      const step = THREE.MathUtils.clamp(deltaYaw, -maxStep, maxStep);
      const newYaw = curYaw + step;
      const faceQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), newYaw);
      if (typeof z.rigidBody.setNextKinematicRotation === 'function') {
        z.rigidBody.setNextKinematicRotation({ x: faceQuat.x, y: faceQuat.y, z: faceQuat.z, w: faceQuat.w });
      }

      // 按当前面朝方向前进
      const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(faceQuat).normalize();

      // 重力
      // z.vy = (typeof z.vy === 'number') ? z.vy : 0;
      z.vy += gravityAccel * dt;
      if (z.vy < terminalFallSpeed) z.vy = terminalFallSpeed;

      // 期望位移
      const desired = {
        x: forwardDir.x * moveSpeed * dt,
        y: z.vy * dt,
        z: forwardDir.z * moveSpeed * dt
      };

      // 碰撞感知位移
      const controllerCollider = z.controllerCollider ?? (z.colliders && z.colliders[0]);
      if (!controllerCollider) continue;
      z.kcc.computeColliderMovement(controllerCollider, desired);
      const delta = z.kcc.computedMovement();

      // 推进
      const cur = z.rigidBody.translation();
      z.rigidBody.setNextKinematicTranslation({ x: cur.x + delta.x, y: cur.y + delta.y, z: cur.z + delta.z });

      // 落地清零竖直速度
      if (z.kcc.computedGrounded() && z.vy < 0) {
        z.vy = 0;
      }
    }
  }

  // resize renderer to display size
  resizeRendererToDisplaySize(renderer);

  updateCameraAspectOnResize(renderer, camera, fpsCamera);


  if (activeControls === controls) {
    controls.update();
  }

  // Unified delta time for this frame (clamped to avoid spikes)
  const dt = Math.min(clock.getDelta(), 0.1);

  // step fps controller
  stepFpsController(dt);

  // 衰减手枪后坐力/抖动（基于 dt）
  {
    const recoilDecay = Math.exp(-6.0 * dt);  // 越大越快恢复
    const shakeDecay = Math.exp(-12.0 * dt);
    pistolRecoil *= recoilDecay;
    pistolShake *= shakeDecay;
    rifleRecoil *= recoilDecay;
    rifleShake *= shakeDecay;
  }

  // Update FPS camera and held weapon visuals
  updateFpsCamera();

  // Update helpers (needed if light/target/camera changes)
  if (sunHelper) sunHelper.update();
  if (sunCamHelper) {
    sun.shadow.camera.updateProjectionMatrix();
    sunCamHelper.update();
  }


  renderer.render(scene, activeCamera);
  // 更新动画模块
  updateMixers(mixers, dt);

  // 僵尸移动逻辑
  updateZombies(dt);

  // 每帧推进物理世界
  physics.step(dt);
  // 更新碰撞盒可视化
  updateColliderDebugs();
  // 同步动态 glTF 对象 Mesh <- RigidBody
  for (const o of dynamicGltfObjects) {
    if (o.sync) o.sync();
    // 更新手雷上的红色光源位置
    if (o.redLight && o.rigidBody) {
      const pos = o.rigidBody.translation();
      o.redLight.position.set(pos.x, pos.y, pos.z);
    } else if (o.redLight && o.object) {
      o.redLight.position.copy(o.object.position);
    }
  }

  // 更新右上角坐标显示（使用当前激活相机的位置）
  if (posEl && activeCamera) {
    const p = activeCamera.position;
    posEl.textContent = `Pos: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
  }

  

  // Track low FPS using RAF timestamp (unclamped dt)
  if (typeof ts === 'number') {
    if (lastRafTs !== null) {
      const rawDt = (ts - lastRafTs) / 1000;
      if (rawDt > 0 && rawDt < 1) {
        const fps = 1 / rawDt;
        if (fps < lowFps) {
          lowFps = fps;
          if (lowFpsEl) lowFpsEl.textContent = `Low FPS: ${lowFps.toFixed(1)}`;
        }
      }
    }
    lastRafTs = ts;
  }

  requestAnimationFrame(render);

  if (stats) stats.end();
}

function onWindowResize() {

  const aspect = window.innerWidth / window.innerHeight;

  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  if (fpsCamera) {
    fpsCamera.aspect = aspect;
    fpsCamera.updateProjectionMatrix();
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, activeCamera);

}

function createControls(camera) {

  controls = new TrackballControls(camera, renderer.domElement);

  controls.rotateSpeed = 1.0;
  controls.zoomSpeed = 5;
  controls.panSpeed = 0.8;

  //     This array holds keycodes for controlling interactions.

  // When the first defined key is pressed, all mouse interactions (left, middle, right) performs orbiting.
  // When the second defined key is pressed, all mouse interactions (left, middle, right) performs zooming.
  // When the third defined key is pressed, all mouse interactions (left, middle, right) performs panning.
  // Default is KeyA, KeyS, KeyD which represents A, S, D.
  controls.keys = ['KeyA', 'KeyS', 'KeyD'];



}

// 将 three.js Object3D（可为 Mesh 或 Group）转换为若干 Rapier Trimesh colliders（固定刚体）
// 并将rb注册入world，返回一个可以用于销毁等操作的rb句柄
export function addStaticTrimeshColliderFromMesh(RAPIER, world, object3d) {
    if (!object3d) {
      console.error('[addStaticTrimeshColliderFromMesh] object3d is not valid');
      return;
    }
    object3d.updateWorldMatrix(true, true);

    // create a fixed body to hold multiple colliders for the entire scene
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    object3d.traverse((child) => {
      // only process Mesh
      if (!child.isMesh) return;
      const mesh = child;
      let geom = mesh.geometry;
      if (!geom || !geom.attributes || !geom.attributes.position) return;

      if (!geom.index) {
        const count = geom.attributes.position.count;
        const index = new Uint32Array(count);
        for (let i = 0; i < count; i++) index[i] = i;
        geom = geom.clone();
        geom.setIndex(new THREE.BufferAttribute(index, 1));
      }

      const pos = geom.attributes.position;
      const idx = geom.index;

      // vertices transformed to world coordinates
      const vertices = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(mesh.matrixWorld);
        const base = i * 3;
        vertices[base] = v.x;
        vertices[base + 1] = v.y;
        vertices[base + 2] = v.z;
      }
      // convert indices to suitable TypedArray
      const indices = (idx.array instanceof Uint32Array || idx.array instanceof Uint16Array)
        ? idx.array
        : new Uint32Array(idx.array);

      // create a trimesh collider for the mesh and attach it to the same fixed body
      world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), rb);
    });

    return rb;
}

// 为给定刚体生成复合盒碰撞体：遍历 object3d 的每个 Mesh，使用其世界 AABB 近似为一个盒体
// 盒体位置为“刚体本地坐标”，避免整体误差导致悬空；返回创建的所有 colliders
export function addCompoundBoxCollidersFromMesh(
  RAPIER,
  world,
  rigidBody,
  object3d,
  {
    density = undefined,
    friction = 0.7,
    restitution = 0.0
  } = {}
) {
  const colliders = [];
  if (!object3d || !rigidBody) {
    console.error('[addCompoundBoxCollidersFromMesh] object3d or rigidBody is not valid');
    return colliders;
  }

  // 刚体的世界矩阵（假设已与 object3d 对齐创建）
  object3d.updateWorldMatrix(true, true);
  const bodyMatrixWorld = object3d.matrixWorld.clone();
  const bodyMatrixInv = bodyMatrixWorld.clone().invert();

  const tmpBox = new THREE.Box3();
  const tmpCenterWorld = new THREE.Vector3();
  const tmpSizeWorld = new THREE.Vector3();

  object3d.traverse((child) => {
    if (!child.isMesh) return;

    // 该 Mesh 的世界 AABB
    tmpBox.setFromObject(child);
    tmpBox.getCenter(tmpCenterWorld);
    tmpBox.getSize(tmpSizeWorld);

    // 忽略非常小的盒子，避免生成过多细碎 collider
    if (tmpSizeWorld.x < 0.01 && tmpSizeWorld.y < 0.01 && tmpSizeWorld.z < 0.01) return;

    // 转到刚体本地
    const centerLocal = tmpCenterWorld.clone().applyMatrix4(bodyMatrixInv);
    const hx = Math.max(tmpSizeWorld.x * 0.5, 0.005);
    const hy = Math.max(tmpSizeWorld.y * 0.5, 0.005);
    const hz = Math.max(tmpSizeWorld.z * 0.5, 0.005);

    const collider = world.createCollider(
      (() => {
        const d = RAPIER.ColliderDesc
          .cuboid(hx, hy, hz)
          .setTranslation(centerLocal.x, centerLocal.y, centerLocal.z)
          .setFriction(friction)
          .setRestitution(restitution);
        // Only apply density if provided; otherwise, leave mass contribution to be set explicitly on body
        if (typeof density !== 'undefined') d.setDensity(density);
        return d;
      })(),
      rigidBody
    );
    colliders.push(collider);
  });

  return colliders;
}

// 初始化主菜单
function initMainMenu() {
  mainMenuEl = document.getElementById('main-menu');
  
  // 选项1点击事件 - 开始游戏
  document.getElementById('menu-option-1').addEventListener('click', function() {
    console.log('Menu option 1 clicked - Start Game');
    hideMainMenu();
    if(!initMap) {
        initMap = true;
        main();
    }else{
        isMenuVisible = false;

    }
    // 如果游戏还未初始化，则启动游戏
    // if (!scene) {
    //   main();
    // }

  });
  
  // 选项2点击事件
  document.getElementById('DEBUG').addEventListener('click', function() {
    console.log('DEBUG clicked (placeholder)');
    DEBUG = true;
    main();
  });
  
  // 选项3点击事件
  document.getElementById('shooting-range').addEventListener('click', function() {
    console.log('Menu option 3 clicked (placeholder)');
    // 占位符：可以在这里添加选项3的功能
  });
  
  // 鼠标悬停效果
  const menuButtons = document.querySelectorAll('#main-menu button');
  menuButtons.forEach(button => {
    button.addEventListener('mouseenter', function() {
      this.style.backgroundColor = '#45a049';
    });
    button.addEventListener('mouseleave', function() {
      this.style.backgroundColor = '#4CAF50';
    });
  });
}

// 显示主菜单
function showMainMenu() {
  if (mainMenuEl) {
    mainMenuEl.style.display = 'flex';
    isMenuVisible = true;
  }
}

// 隐藏主菜单
function hideMainMenu() {
  if (mainMenuEl) {
    mainMenuEl.style.display = 'none';
    isMenuVisible = false;
  }
}

// 初始化主菜单
initMainMenu();

// 启动render循环（即使菜单可见也要运行，以便菜单隐藏后能继续）
function startRenderLoop() {
  function renderLoop(ts) {
    // 如果菜单可见，只继续循环但不渲染游戏
    if (isMenuVisible) {
      requestAnimationFrame(renderLoop);
      return;
    }
    // 如果游戏已初始化，调用render函数
    if (scene && renderer) {
      render(ts);
    } else {
      requestAnimationFrame(renderLoop);
    }
  }
  requestAnimationFrame(renderLoop);
}

// 启动render循环
startRenderLoop();

// 不自动启动游戏，等待菜单选项触发
// main(); // 注释掉自动启动