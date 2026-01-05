import * as THREE from '../Common/three.js-r170/build/three.module.js';
 import { TrackballControls } from '../Common/three.js-r170/examples/jsm/controls/TrackballControls.js';
 import { PointerLockControls } from '../Common/three.js-r170/examples/jsm/controls/PointerLockControls.js';
 import Stats from '../Common/three.js-r170/examples/jsm/libs/stats.module.js';
 import { EXRLoader } from '../Common/three.js-r170/examples/jsm/loaders/EXRLoader.js';

import { GLTFLoader } from '../Common/three.js-r170/examples/jsm/loaders/GLTFLoader.js';

import RAPIER from "../Common/node_modules/@dimforge/rapier3d-compat/rapier.mjs";

import { 
  createStaticGLTF, 
  createDynamicGLTF,
  addStaticTrimeshColliderFromMesh,
  addCompoundBoxCollidersFromMesh
} from './modules/GLTFFactory.js';

import { initPhysics } from './modules/Physics.js';

import { 
  initGranadePool, 
  getGranadeFromPool, 
  returnGranadeToPool, 
  throwGranade,
  setupGranadeExplosion
} from './modules/Grenades.js';

import {
  createZombieAt,
  spawnZombiesAround,
  updateZombies,
  destroyAllZombies
} from './modules/Zombies.js';

let camera, fpsCamera, controls, fpsControls, scene, renderer, canvas, world, map_city  ;
let scene2Position = null; // 场景2物体的位置
let crosshairEl = null; // 十字准星元素
let mainMenuEl = null; // 主菜单元素
let isMenuVisible = true; // 菜单是否可见
let zombieCounterEl = null; // 僵尸计数器元素
let zombieCountEl = null; // 僵尸数量显示元素
let winMessageEl = null; // Win消息元素
let sun, sunHelper, sunCamHelper;
let stats;

let initMap = false;

// 场景状态枚举
const SceneState = {
  MENU: 'menu',           // 主菜单
  LEVEL1: 'level1',      // Level1场景
  SHOOTING_RANGE: 'shooting_range'  // 射击场场景
};

// 当前场景状态
let currentSceneState = SceneState.MENU;
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
// 手雷对象池已移至 modules/Grenades.js
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
const physics = await initPhysics({
  scene: scene,
  RAPIER: RAPIER,
  addColliderDebugBox: addColliderDebugBoxForBody
});
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
  // 不在这里设置fpsCamera位置，位置设置全部通过按键回调完成
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
    // 使用默认初始位置，不依赖fpsCamera位置
    const defaultStartPos = { x: -1700, y: 12 - cameraYOffset, z: 800 };
    playerBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(defaultStartPos.x, defaultStartPos.y, defaultStartPos.z)
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
  
  // get the zombie counter elements
  zombieCounterEl = document.getElementById('zombie-counter');
  zombieCountEl = document.getElementById('zombie-count');
  winMessageEl = document.getElementById('win-message');

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
        if (c) {
          spawnZombiesAround({
            center: c,
            count: 5,
            radius: 30,
            createOptions: {
              scene: scene,
              RAPIER: RAPIER,
              world: world,
              zombies: zombies,
              zombieMixers: zombieMixers,
              mixers: mixers,
              dynamicGltfObjects: dynamicGltfObjects,
              addColliderDebugCapsule: addColliderDebugCapsuleForBody
            }
          });
        }
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
      throwGranade({
        position: throwPosition,
        direction: throwDirection,
        speed: 200,
        scene: scene,
        onCreated: function(granadeInstance) {
          // 播放爆炸声的回调
          const playExplosionSound = () => {
            if (!explosionSound) {
              explosionSound = new Audio('../Sounds/explosion.mp3');
            }
            explosionSound.currentTime = 0;
            explosionSound.play().catch(err => console.error('Failed to play explosion sound:', err));
          };
          
          // 设置爆炸定时器
          granadeInstance.timeoutId = setupGranadeExplosion({
            granadeInstance: granadeInstance,
            scene: scene,
            zombies: zombies,
            explosionRadius: 80,
            damage: 100,
            delay: 6000,
            hiddenPosition: HIDDEN_WEAPON_POSITION,
            onExplode: playExplosionSound
          });
        }
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

  // 僵尸系统函数已移至 modules/Zombies.js

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
        addCollider: true,
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene
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
        renderOffset: { x: 0, y: -9.5, z: 0 },
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: addColliderDebugBoxForBody,
        addColliderDebugCapsule: addColliderDebugCapsuleForBody
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
        renderOffset: { x: 0, y: -9.5, z: 0 },
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: addColliderDebugBoxForBody,
        addColliderDebugCapsule: addColliderDebugCapsuleForBody
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
        renderOffset: { x: 0, y: -9.5, z: 0 },
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: addColliderDebugBoxForBody,
        addColliderDebugCapsule: addColliderDebugCapsuleForBody
      });
      // 如果当前不是武器2，则隐藏步枪
      if (playerHeld !== 2 && rifle && rifle.object) {
        rifle.object.position.copy(HIDDEN_WEAPON_POSITION);
      }

    }, undefined, function (error) {

      console.error(error);

    });

    // initialize granade pool
    initGranadePool({
      scene: scene,
      RAPIER: RAPIER,
      world: world,
      dynamicGltfObjects: dynamicGltfObjects,
      hiddenPosition: HIDDEN_WEAPON_POSITION,
      addColliderDebugBox: addColliderDebugBoxForBody,
      addColliderDebugCapsule: addColliderDebugCapsuleForBody
    });

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
        renderOffset: { x: 0, y: -1, z: 0 },
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: addColliderDebugBoxForBody,
        addColliderDebugCapsule: addColliderDebugCapsuleForBody
      });
      // hide granade if not weapon 3
      // if (playerHeld !== 3 && granade && granade.object) {
      //   granade.object.position.copy(HIDDEN_WEAPON_POSITION);
      // }

    }, undefined, function (error) {

      console.error(error);

    });



    createZombieAt({
      position: [-207, 20, -41],
      scene: scene,
      RAPIER: RAPIER,
      world: world,
      zombies: zombies,
      zombieMixers: zombieMixers,
      mixers: mixers,
      dynamicGltfObjects: dynamicGltfObjects,
      addColliderDebugCapsule: addColliderDebugCapsuleForBody
    });
    createZombieAt({
      position: [-217, 20, -21],
      scene: scene,
      RAPIER: RAPIER,
      world: world,
      zombies: zombies,
      zombieMixers: zombieMixers,
      mixers: mixers,
      dynamicGltfObjects: dynamicGltfObjects,
      addColliderDebugCapsule: addColliderDebugCapsuleForBody
    });
    createZombieAt({
      position: [-208, 30, -41],
      scene: scene,
      RAPIER: RAPIER,
      world: world,
      zombies: zombies,
      zombieMixers: zombieMixers,
      mixers: mixers,
      dynamicGltfObjects: dynamicGltfObjects,
      addColliderDebugCapsule: addColliderDebugCapsuleForBody
    });
    createZombieAt({
      position: [-237, 20, -41],
      scene: scene,
      RAPIER: RAPIER,
      world: world,
      zombies: zombies,
      zombieMixers: zombieMixers,
      mixers: mixers,
      dynamicGltfObjects: dynamicGltfObjects,
      addColliderDebugCapsule: addColliderDebugCapsuleForBody
    });

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
        addCollider: true,
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene
      });

      if (gltf.animations && gltf.animations.length > 0) {
        const m = new THREE.AnimationMixer(gltf.scene);
        mixers.push(m);
        const action = m.clipAction(gltf.animations[0]);
        action.play(); //激活动作 然后在渲染部分调用mixer.update(dt)更新动作
      }
      
      // 可以保存刚体引用，如果需要后续操作
      // map_scene2 = rigidBody;
      
      // 如果当前场景状态是SHOOTING_RANGE，自动移动相机到shooting range位置
      if (currentSceneState === SceneState.SHOOTING_RANGE && fpsCamera && playerBody) {
        // 使用setTimeout确保所有初始化完成
        setTimeout(() => {
          moveFpsCameraToShootingRange();
        }, 100);
      }

    }, undefined, function (error) {

      console.error(error);

    });
  }

  // 手雷系统函数已移至 modules/Grenades.js

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
  // 注意：这个同步会在每帧更新，确保fpsCamera跟随playerBody
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
  if (activeCamera === fpsCamera && playerHeld === 1 && pistol && pistol.object) {
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
  if (activeCamera === fpsCamera && playerHeld === 2 && rifle && rifle.object) {
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
  if (activeCamera === fpsCamera && playerHeld === 3 && granade && granade.object) {
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

  // updateZombies 函数已移至 modules/Zombies.js

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
  updateZombies({
    zombies: zombies,
    dt: dt,
    zombiesForward: movement.zombiesForward,
    gravityAccel: gravityAccel,
    terminalFallSpeed: terminalFallSpeed
  });

  // 更新僵尸死亡计数器（仅在Level1场景显示）
  if (currentSceneState === SceneState.LEVEL1 && zombieCounterEl && zombieCountEl) {
    // 统计状态为dead的僵尸数量
    let deadCount = 0;
    for (const z of zombies) {
      if (z && z.state === 'dead') {
        deadCount++;
      }
    }
    zombieCountEl.textContent = deadCount;
    zombieCounterEl.style.display = 'block';
    
    // 检查是否达到30个击杀
    if (deadCount >= 30) {
      showWinMessage();
    }
  } else if (zombieCounterEl) {
    zombieCounterEl.style.display = 'none';
  }

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

// addStaticTrimeshColliderFromMesh 和 addCompoundBoxCollidersFromMesh 已移至 modules/GLTFFactory.js

// 重置FPS摄像机到默认位置
function resetFpsCamera() {
  if (fpsCamera) {
    // 重置摄像机位置
    fpsCamera.position.set(-1700, 12, 800);
    fpsCamera.quaternion.set(0, 0, 0, 1); // 重置旋转
    fpsCamera.up.set(0, 1, 0);
    
    // 同步物理体位置到摄像机
    if (playerBody) {
      playerBody.setTranslation({
        x: fpsCamera.position.x,
        y: fpsCamera.position.y - cameraYOffset,
        z: fpsCamera.position.z
      }, true);
      playerBody.setNextKinematicTranslation({
        x: fpsCamera.position.x,
        y: fpsCamera.position.y - cameraYOffset,
        z: fpsCamera.position.z
      });
    }
    
    // 解锁FPS控制（如果已锁定）
    if (fpsControls && fpsControls.isLocked) {
      fpsControls.unlock();
    }
    
    console.log('FPS camera reset to default position');
  }
}

// 移动FPS摄像机到shooting range位置
function moveFpsCameraToShootingRange() {
  if (fpsCamera && playerBody && scene2Position) {
    const targetPosition = scene2Position.clone().add(new THREE.Vector3(10, 15, 10)); // 场景2物体位置 + 相机高度偏移
    const bodyPosition = {
      x: targetPosition.x,
      y: targetPosition.y - cameraYOffset,
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
    
    // 解锁FPS控制（如果已锁定）
    if (fpsControls && fpsControls.isLocked) {
      fpsControls.unlock();
    }
    
    console.log('FPS camera moved to shooting range position:', targetPosition, 'body position:', bodyPosition);
  } else if (!scene2Position) {
    console.warn('Shooting range position not initialized yet');
  }
}

// 初始化主菜单
function initMainMenu() {
  mainMenuEl = document.getElementById('main-menu');
  
  // 选项1点击事件 - Level1
  document.getElementById('menu-option-1').addEventListener('click', function() {
    console.log('Menu option 1 clicked - Level1');
    hideMainMenu();
    currentSceneState = SceneState.LEVEL1;
    if(!initMap) {
        initMap = true;
        main();
    }else{
        isMenuVisible = false;
        // 重置FPS摄像机位置
        resetFpsCamera();
    }
  });
  
  // 选项2点击事件 - DEBUG
  document.getElementById('DEBUG').addEventListener('click', function() {
    console.log('DEBUG clicked');
    DEBUG = true;
    hideMainMenu();
    currentSceneState = SceneState.LEVEL1;
    if(!initMap) {
        initMap = true;
        main();
    }else{
        isMenuVisible = false;
    }
  });
  
  // option3 clicked - Shooting Range
  document.getElementById('shooting-range').addEventListener('click', function() {
    console.log('Shooting Range clicked');
    hideMainMenu();
    currentSceneState = SceneState.SHOOTING_RANGE;
    
    if(!initMap) {
        initMap = true;
        main();

        const checkAndMove = setInterval(() => {
          if (scene2Position && fpsCamera && playerBody) {
            clearInterval(checkAndMove);
            moveFpsCameraToShootingRange();
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkAndMove);
          if (scene2Position && fpsCamera && playerBody) {
            moveFpsCameraToShootingRange();
          } else {
            console.warn('Failed to move camera to shooting range: scene not loaded yet');
          }
        }, 10000);
    }else{
        isMenuVisible = false;
        // 移动FPS摄像机到shooting range位置
        moveFpsCameraToShootingRange();
    }
    // 如果已经在射击场，可以添加切换逻辑
  });
  
//   // 鼠标悬停效果
//   const menuButtons = document.querySelectorAll('#main-menu button');
//   menuButtons.forEach(button => {
//     button.addEventListener('mouseenter', function() {
//       this.style.backgroundColor = '#45a049';
//     });
//     button.addEventListener('mouseleave', function() {
//       this.style.backgroundColor = '#4CAF50';
//     });
//   });
}

// 显示主菜单
function showMainMenu() {
  if (mainMenuEl) {
    mainMenuEl.style.display = 'flex';
    isMenuVisible = true;
    currentSceneState = SceneState.MENU;
  }
}

// 隐藏主菜单
function hideMainMenu() {
  if (mainMenuEl) {
    mainMenuEl.style.display = 'none';
    isMenuVisible = false;
  }
}

// 显示Win消息并返回主菜单
function showWinMessage() {
  if (winMessageEl) {
    winMessageEl.style.display = 'flex';
    
    // 3秒后返回主菜单
    setTimeout(() => {
      hideWinMessage();
      returnToMainMenu();
    }, 3000);
  }
}

// 隐藏Win消息
function hideWinMessage() {
  if (winMessageEl) {
    winMessageEl.style.display = 'none';
  }
}

// 返回主菜单（带清理逻辑）
function returnToMainMenu() {
  // 如果当前在level场景，销毁所有僵尸
  if (currentSceneState === SceneState.LEVEL1) {
    destroyAllZombies({
      zombies: zombies,
      scene: scene,
      world: world,
      zombieMixers: zombieMixers,
      mixers: mixers,
      dynamicGltfObjects: dynamicGltfObjects
    });
  }
  
  // 解锁FPS控制（如果已锁定）
  if (fpsControls && fpsControls.isLocked) {
    fpsControls.unlock();
  }
  
  // 隐藏Win消息（如果显示）
  hideWinMessage();
  
  // 显示主菜单
  showMainMenu();
}

// 初始化主菜单
initMainMenu();

// 全局H键监听器（在任何界面都可以按H返回主菜单）
window.addEventListener('keydown', function(e) {
  if (e.code === 'KeyH') {
    // 如果游戏已初始化，调用返回主菜单函数
    if (typeof returnToMainMenu === 'function') {
      returnToMainMenu();
    } else {
      // 如果游戏还未初始化，直接显示主菜单
      showMainMenu();
    }
  }
});

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