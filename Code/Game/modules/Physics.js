import * as THREE from '../../Common/three.js-r170/build/three.module.js';

/**
 * 物理系统模块
 * 提供RAPIER物理世界的初始化和步进功能
 */

/**
 * 初始化 Rapier 世界 + 常见刚体（地面/盒子）并返回一个 step(dt) 用于每帧推进
 * @param {Object} options - 配置选项
 * @param {THREE.Scene} options.scene - Three.js场景
 * @param {Object} options.RAPIER - RAPIER对象
 * @param {Function} options.addColliderDebugBox - 可选的调试函数：添加碰撞体调试盒
 * @param {Object} options.gravity - 重力配置 { x, y, z }，默认 { x: 0, y: -9.81*14, z: 0 }
 * @returns {Promise<Object>} { world, objects, step } - 物理世界、对象列表和步进函数
 */
export async function initPhysics({
  scene,
  RAPIER,
  addColliderDebugBox = null,
  gravity = { x: 0, y: -9.81 * 14, z: 0 }
}) {
  // 1) 初始化 WASM（必须 await）
  await RAPIER.init();

  // 2) 创建物理世界（重力向下）
  const world = new RAPIER.World(gravity);

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
    if (addColliderDebugBox) {
      addColliderDebugBox(
        { translation: () => ({ x: position[0], y: position[1], z: position[2] }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }) },
        new THREE.Vector3(halfExtents[0], halfExtents[1], halfExtents[2]),
        new THREE.Vector3(0, 0, 0),
        0x00ffff
      );
    }
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
    if (enableCcd) {
      body.enableCcd(true);
    }
    // debug collider
    if (addColliderDebugBox) {
      addColliderDebugBox(
        body,
        new THREE.Vector3(halfExtents[0], halfExtents[1], halfExtents[2]),
        new THREE.Vector3(0, 0, 0),
        0x00ffff
      );
    }
    const mesh = makeBoxMesh(halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2, material || new THREE.MeshStandardMaterial({ color: 0xff3333 }));
    mesh.castShadow = true;
    const entry = addPhysicsObject({
      body: body,
      colliders: [collider],
      mesh: mesh,
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

  // 固定步长推进：更稳定（推荐）
  const fixedDt = 1 / 60;
  let accumulator = 0;

  /**
   * 每帧调用一次：传入真实 dt（秒）
   * @param {number} dtSec
   */
  function step(dtSec) {
    // 防止 tab 切换回来 dt 巨大导致"爆炸"
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

