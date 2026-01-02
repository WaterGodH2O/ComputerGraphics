import * as THREE from '../Common/three.js-r170/build/three.module.js';
 import { TrackballControls } from '../Common/three.js-r170/examples/jsm/controls/TrackballControls.js';
 import { PointerLockControls } from '../Common/three.js-r170/examples/jsm/controls/PointerLockControls.js';
 import Stats from '../Common/three.js-r170/examples/jsm/libs/stats.module.js';
 import { EXRLoader } from '../Common/three.js-r170/examples/jsm/loaders/EXRLoader.js';

import { GLTFLoader } from '../Common/three.js-r170/examples/jsm/loaders/GLTFLoader.js';

import RAPIER from "../Common/node_modules/@dimforge/rapier3d-compat/rapier.mjs";

let camera, fpsCamera, controls, fpsControls, scene, renderer, canvas, world, map_city  ;
let sun, sunHelper, sunCamHelper;
let stats;
const dynamicGltfObjects = [];
const DEBUG = true;
let colliderDebugs = [];
let lowFps = Infinity;
let lastRafTs = null;
let lowFpsEl;
let posEl;
let lowFpsResetId;
// FPS character controller state
let charController, playerBody, playerCollider;
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

// 初始化场景光照（支持调试 helper 开关）
function initLighting(debug = false) {
  // 环境光
  const ambLight = new THREE.AmbientLight(0x404040, 1);
  scene.add(ambLight);

  // 太阳光（方向光）
  sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(300, 500, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20000;
  sun.shadow.camera.left = -5000;
  sun.shadow.camera.right = 5000;
  sun.shadow.camera.top = 5000;
  sun.shadow.camera.bottom = -5000;
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
function createDynamicGLTF({
  object3d,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  enableShadows = true,
  shape = 'sphere', // 'sphere' | 'box'
  density = 1.0,
  friction = 0.7,
  restitution = 0.0,
  damping = { lin: 0.05, ang: 0.05 },
  canSleep = true,
  enableCcd = true,
  rapier = RAPIER,
  rapierWorld = world
}) {
  if (!object3d) return { object: null, rigidBody: null, colliders: [] };

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
    const collider = rapierWorld.createCollider(
      rapier.ColliderDesc
        .cuboid(Math.max(size.x * 0.5, 0.01), Math.max(size.y * 0.5, 0.01), Math.max(size.z * 0.5, 0.01))
        .setDensity(density)
        .setFriction(friction)
        .setRestitution(restitution),
      body
    );
    colliders.push(collider);
  } else if (shape === 'compound') {
    const created = addCompoundBoxCollidersFromMesh(rapier, rapierWorld, body, object3d, { density, friction, restitution });
    for (const c of created) colliders.push(c);
  } else if(shape === 'auto'){
    // 动态三角网（数值昂贵，谨慎使用）
    const rb = addDynamicTrimeshColliderFromMesh(rapier, rapierWorld, object3d, { density, friction, restitution });
    // 覆盖为由该函数创建的刚体
    entryOverrideBody = rb;
  } else {
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 0.5;
    const collider = rapierWorld.createCollider(
      rapier.ColliderDesc
        .ball(radius)
        .setDensity(density)
        .setFriction(friction)
        .setRestitution(restitution),
      body
    );
    colliders.push(collider);
  }

  if (enableCcd && typeof body.enableCcd === 'function') body.enableCcd(true);

  // 注册同步（每帧从刚体同步到可视对象）
  const entry = {
    object: object3d,
    rigidBody: (typeof entryOverrideBody !== 'undefined' && entryOverrideBody) ? entryOverrideBody : body,
    colliders,
    sync: () => {
      const usingBody = (typeof entryOverrideBody !== 'undefined' && entryOverrideBody) ? entryOverrideBody : body;
      const t = usingBody.translation();
      const r = usingBody.rotation();
      object3d.position.set(t.x, t.y, t.z);
      object3d.quaternion.set(r.x, r.y, r.z, r.w);
    }
  };
  dynamicGltfObjects.push(entry);

  return entry;
}

// FPS movement state
const movement = {
  forward: false,
  backward: false,
  left: false,
  right: false
};
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
      if (enableCcd && typeof body.enableCcd === "function") body.enableCcd(true);
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
  
  /* ---------------------------
     你在主循环里这样用：
  -----------------------------
  
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
  fpsCamera.position.copy(camera.position);
  fpsCamera.rotation.order = 'YXZ';
  fpsControls = new PointerLockControls(fpsCamera, renderer.domElement);
  fpsControls.pointerSpeed = 0.8;

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

  // Set active camera/controls default to orbit
  activeCamera = camera;
  activeControls = controls;

  // Toggle cameras with 'P'
  function toggleCamera() {
    if (activeCamera === camera) {
      // switch to FPS; sync pose
      fpsCamera.position.copy(camera.position);
      fpsCamera.quaternion.copy(camera.quaternion);
      // remove any roll and lock up vector
      {
        const e = new THREE.Euler(0, 0, 0, 'YXZ');
        e.setFromQuaternion(fpsCamera.quaternion);
        e.z = 0;
        fpsCamera.quaternion.setFromEuler(e);
        fpsCamera.up.set(0, 1, 0);
      }
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
    } else {
      // switch to orbit
      if (fpsControls.isLocked) fpsControls.unlock();
      camera.position.copy(fpsCamera.position);
      camera.quaternion.copy(fpsCamera.quaternion);
      activeCamera = camera;
      activeControls = controls;
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
      case 'Space':
        if (activeControls === fpsControls) requestJump = true;
        break;
      case 'KeyP': toggleCamera(); break;
    }
  }
  function onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': movement.forward = false; break;
      case 'KeyS': movement.backward = false; break;
      case 'KeyA': movement.left = false; break;
      case 'KeyD': movement.right = false; break;
    }
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);


  scene.background = new THREE.Color('black');



  const loader = new GLTFLoader();

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
      mixer = new THREE.AnimationMixer(gltf.scene);
      const action = mixer.clipAction(gltf.animations[0]);
      action.play(); //激活动作 然后在渲染部分调用mixer.update(dt)更新动作
    }
    
    map_city = rigidBody;

  }, undefined, function (error) {

    console.error(error);

  });
  // ..\GlTF_Models\glTF\Vehicle_Pickup_Armored.gltf
  // 动态 glTF 示例（使用动态工厂）
  const dynLoader = new GLTFLoader();
  dynLoader.load('../GlTF_Models/glTF/Vehicle_Pickup_Armored.gltf', function (gltf) {
    console.log("pickup armored loaded");

    createDynamicGLTF({
      object3d: gltf.scene,
      position: [-441, 20, -22],
      rotation: [0, 0, 0],
      scale: [10, 10, 10],
      enableShadows: true,
      shape: 'compound',            // 或 'sphere'
      density: 2.0,
      friction: 0.8,
      restitution: 0.1,
      damping: { lin: 0.1, ang: 0.1 },
      canSleep: true,
      enableCcd: true
    });

  }, undefined, function (error) {

    console.error(error);

  });

  // 统一光照初始化（debug=false 不显示 helper）
  initLighting(DEBUG);
  // 天空盒
  initSkybox();

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

function render(ts) {

  if (stats) stats.begin();

  resizeRendererToDisplaySize(renderer);

  {
    const canvas = renderer.domElement;
    const newAspect = canvas.clientWidth / canvas.clientHeight;
    camera.aspect = newAspect;
    camera.updateProjectionMatrix();
    if (fpsCamera) {
      fpsCamera.aspect = newAspect;
      fpsCamera.updateProjectionMatrix();
    }
  }
  if (activeControls === controls) {
    controls.update();
  }

  // Unified delta time for this frame (clamped to avoid spikes)
  const dt = Math.min(clock.getDelta(), 0.1);

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

  // Update helpers (needed if light/target/camera changes)
  if (sunHelper) sunHelper.update();
  if (sunCamHelper) {
    sun.shadow.camera.updateProjectionMatrix();
    sunCamHelper.update();
  }

  renderer.render(scene, activeCamera);
  // 更新动画模块
  if (mixer) mixer.update(dt);

  // 每帧推进物理世界
  physics.step(dt);
  // 更新碰撞盒可视化
  updateColliderDebugs();
  // 同步动态 glTF 对象 Mesh <- RigidBody
  for (const o of dynamicGltfObjects) {
    if (o.sync) o.sync();
  }

  // 更新右上角坐标显示（使用当前激活相机的位置）
  if (posEl && activeCamera) {
    const p = activeCamera.position;
    posEl.textContent = `Pos: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
  }

  if (stats) stats.end();

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
    if (!object3d) return;
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
    density = 1.0,
    friction = 0.7,
    restitution = 0.0
  } = {}
) {
  const colliders = [];
  if (!object3d || !rigidBody) return colliders;

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
      RAPIER.ColliderDesc
        .cuboid(hx, hy, hz)
        .setTranslation(centerLocal.x, centerLocal.y, centerLocal.z)
        .setDensity(density)
        .setFriction(friction)
        .setRestitution(restitution),
      rigidBody
    );
    colliders.push(collider);
  });

  return colliders;
}


main();