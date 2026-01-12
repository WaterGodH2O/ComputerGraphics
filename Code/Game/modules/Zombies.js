import * as THREE from '../../Common/three.js-r170/build/three.module.js';
import { GLTFLoader } from '../../Common/three.js-r170/examples/jsm/loaders/GLTFLoader.js';
import { createDynamicGLTF } from './GLTFFactory.js';

/**
 * zombies module
 * provide zombie creation, batch generation and AI movement logic
 */

/**
 * find animation clip by name
 * @param {Array} animations - array of animation clips
 * @param {string} name - animation name to find
 * @returns {THREE.AnimationClip|null} found animation clip or null
 */
function findAnimationByName(animations, name) {
  if (!Array.isArray(animations)) return null;
  return animations.find(clip => clip && clip.name === name) || null;
}

/**
 * create a single zombie
 * @param {Object} options - configuration options
 * @param {Array<number>} options.position - position [x, y, z]
 * @param {THREE.Scene} options.scene - Three.js scene
 * @param {Object} options.RAPIER - RAPIER object
 * @param {Object} options.world - RAPIER physics world
 * @param {Array} options.zombies - zombie array (for adding new zombie)
 * @param {Array} options.zombieMixers - zombie mixer array
 * @param {Array} options.mixers - mixer array (for updating)
 * @param {Array} options.dynamicGltfObjects - dynamic GLTF object list
 * @param {Function} options.addColliderDebugCapsule - debug function: add collider debug capsule
 * @param {string} options.modelPath - zombie model path, default '../GlTF_Models/glTF/Zombie_Basic.gltf'
 * @returns {Promise<Object>} { object, rigidBody, colliders, sync }: zombie object
 */
export async function createZombieAt({
  position,
  scene,
  RAPIER,
  world,
  zombies,
  zombieMixers,
  mixers,
  dynamicGltfObjects,
  addColliderDebugCapsule = null,
  modelPath = '../GlTF_Models/glTF/Zombie_Basic.gltf'
}) {
  return new Promise((resolve) => {
    const dynLoader = new GLTFLoader();
    dynLoader.load(modelPath, function (gltf) {
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
        lockXZRotation: true,
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: null,
        addColliderDebugCapsule: addColliderDebugCapsule
      });
      
      if (zombies) {
        zombies.push(z);
      }
      
      // mark all sub meshes of the zombie with owner tag, for tracing back to the zombie object after hitting
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
      // zombie state: 'idle' | 'moving' | 'dead'
      z.state = 'idle';
      // health (set to 'dead' and stop moving when it is 0)
      z.health = 100;
      // disable the original model compound box and the entity collision with the ground, to avoid interfering with the controller capsule (keep rendering/synchronization)
      // should we really do this? ... mark it for now, not sure

      for (const c of z.colliders) {
        c.setSensor(true);
      }

      // character controller capsule
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
      // zombie belongs to bit 1; filter collides with everything except player (bit 0)
      ctrl.setCollisionGroups((0x0002 << 16) | (0xFFFF ^ 0x0001));
      z.controllerCollider = ctrl;
      
      if (addColliderDebugCapsule) {
        addColliderDebugCapsule(z.rigidBody, halfHeight, radius, 0x00ff00);
      }

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

      // animation
      const zm = new THREE.AnimationMixer(gltf.scene);
      if (zombieMixers) {
        zombieMixers.push(zm);
      }
      if (mixers) {
        mixers.push(zm);
      }
      // record on the zombie object, for switching animation by state
      z.mixer = zm;
      z.animations = gltf.animations;
      z.currentAction = null;
      z.currentAnimName = null;
      // initial state is idle, play the Idle animation
      const idleClip = findAnimationByName(gltf.animations, 'Idle');
      if (idleClip) {
        const act = zm.clipAction(idleClip);
        act.reset().setLoop(THREE.LoopRepeat).play();
        z.currentAction = act;
        z.currentAnimName = 'Idle';
      }

      resolve(z);
    }, undefined, function (error) {
      console.error(error);
      resolve(null);
    });
  });
}

/**
 * create a big zombie (larger, stronger version)
 * @param {Object} options - configuration options
 * @param {Array<number>} options.position - position [x, y, z]
 * @param {THREE.Scene} options.scene - Three.js scene
 * @param {Object} options.RAPIER - RAPIER object
 * @param {Object} options.world - RAPIER physics world
 * @param {Array} options.zombies - zombie array (for adding new zombie)
 * @param {Array} options.zombieMixers - zombie mixer array
 * @param {Array} options.mixers - mixer array (for updating)
 * @param {Array} options.dynamicGltfObjects - dynamic GLTF object list
 * @param {Function} options.addColliderDebugCapsule - debug function: add collider debug capsule
 * @param {string} options.modelPath - zombie model path, default '../GlTF_Models/glTF/Zombie_Basic.gltf'
 * @returns {Promise<Object>} { object, rigidBody, colliders, sync }: big zombie object
 */
export async function createBigZombieAt({
  position,
  scene,
  RAPIER,
  world,
  zombies,
  zombieMixers,
  mixers,
  dynamicGltfObjects,
  addColliderDebugCapsule = null,
  modelPath = '../GlTF_Models/glTF/Zombie_Arm.gltf'
}) {
  return new Promise((resolve) => {
    const dynLoader = new GLTFLoader();
    dynLoader.load(modelPath, function (gltf) {
      const z = createDynamicGLTF({
        object3d: gltf.scene,
        position: position,
        rotation: [0, 0, 0],
        scale: [15, 15, 15], // larger scale for big zombie
        enableShadows: true,
        shape: 'box',
        density: 0.8, // higher density
        friction: 0.8,
        restitution: 0.1,
        damping: { lin: 0.1, ang: 0.1 },
        canSleep: true,
        enableCcd: true,
        renderOffset: { x: 0, y: -15, z: 0 },
        colliderScale: [0.6, 1.3, 0.9], // larger collider
        lockXZRotation: true,
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: null,
        addColliderDebugCapsule: addColliderDebugCapsule
      });
      
      if (zombies) {
        zombies.push(z);
      }
      
      // mark all sub meshes of the zombie with owner tag, for tracing back to the zombie object after hitting
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
      // zombie state: 'idle' | 'moving' | 'dead'
      z.state = 'idle';
      // health (set to 'dead' and stop moving when it is 0) - more health for big zombie
      z.health = 300;
      // mark as big zombie
      z.isBigZombie = true;
      // disable the original model compound box and the entity collision with the ground, to avoid interfering with the controller capsule (keep rendering/synchronization)
      // should we really do this? ... mark it for now, not sure

      for (const c of z.colliders) {
        c.setSensor(true);
      }

      // character controller capsule - larger for big zombie
      const bbox = new THREE.Box3().setFromObject(z.object);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const minRadius = 0.3;
      const radius = Math.max(minRadius, Math.min(size.x, size.z) * 0.35);
      const halfHeight = Math.max(0.1, (size.y * 0.5) - radius) + 4; // taller capsule
      const ctrl = world.createCollider(
        RAPIER.ColliderDesc.capsule(halfHeight, radius)
          .setFriction(0.0)
          .setRestitution(0.0),
        z.rigidBody
      );
      // zombie belongs to bit 1; filter collides with everything except player (bit 0)
      ctrl.setCollisionGroups((0x0002 << 16) | (0xFFFF ^ 0x0001));
      z.controllerCollider = ctrl;
      
      if (addColliderDebugCapsule) {
        addColliderDebugCapsule(z.rigidBody, halfHeight, radius, 0x00ff00);
      }

      // character controller for every single zombie - stronger for big zombie
      z.kcc = world.createCharacterController(0.5);
      z.kcc.setUp({ x: 0, y: 1, z: 0 });
      z.kcc.setSlideEnabled(true);
      z.kcc.enableAutostep(0.4, 0.3, false);
      z.kcc.setMaxSlopeClimbAngle(Math.PI * 0.5);
      z.kcc.setMinSlopeSlideAngle(Math.PI * 0.9);
      z.kcc.enableSnapToGround(0.3);
      z.kcc.setApplyImpulsesToDynamicBodies(true);
      z.kcc.setCharacterMass(400); // heavier for big zombie

      // animation
      const zm = new THREE.AnimationMixer(gltf.scene);
      if (zombieMixers) {
        zombieMixers.push(zm);
      }
      if (mixers) {
        mixers.push(zm);
      }
      // record on the zombie object, for switching animation by state
      z.mixer = zm;
      z.animations = gltf.animations;
      z.currentAction = null;
      z.currentAnimName = null;
      // initial state is idle, play the Idle animation
      const idleClip = findAnimationByName(gltf.animations, 'Idle');
      if (idleClip) {
        const act = zm.clipAction(idleClip);
        act.reset().setLoop(THREE.LoopRepeat).play();
        z.currentAction = act;
        z.currentAnimName = 'Idle';
      }

      resolve(z);
    }, undefined, function (error) {
      console.error(error);
      resolve(null);
    });
  });
}

/**
 * batch generate zombies around the specified center point
 * @param {Object} options - configuration options
 * @param {Array<number>|Object} options.center - center position [x, y, z] or {x, y, z}
 * @param {number} options.count - number of zombies to generate, default 5
 * @param {number} options.radius - generation radius, default 80
 * @param {Object} options.createOptions - options passed to createZombieAt
 * @returns {Promise<Array>} all created zombie objects array
 */
export async function spawnZombiesAround({
  center,
  count = 8,
  radius = 140,
  createOptions
}) {
  const cx = Array.isArray(center) ? center[0] : center.x;
  const cy = Array.isArray(center) ? center[1] : center.y;
  const cz = Array.isArray(center) ? center[2] : center.z;
  const tasks = [];
  
  // create a big zombie at the center
  tasks.push(createBigZombieAt({
    ...createOptions,
    position: [cx, cy, cz]
  }));
  
  // create regular zombies around the center
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * radius;
    const x = cx + Math.cos(ang) * dist;
    const z = cz + Math.sin(ang) * dist;
    const y = cy;
    tasks.push(createZombieAt({
      ...createOptions,
      position: [x, y, z]
    }));
  }
  return Promise.all(tasks);
}

/**
 * update zombies movement and AI logic
 * @param {Object} options - configuration options
 * @param {Array} options.zombies - zombie array
 * @param {number} options.dt - time difference (seconds)
 * @param {boolean} options.zombiesForward - whether to stop zombies (press T to stop, default: moving)
 * @param {number} options.gravityAccel - gravity acceleration
 * @param {number} options.terminalFallSpeed - terminal fall speed
 * @param {number} options.moveSpeed - move speed, default 10
 */
export function updateZombies({
  zombies,
  dt,
  zombiesForward = false,
  gravityAccel = -9.81 * 14,
  terminalFallSpeed = -300,
  moveSpeed = 10
}) {
  if (!(zombies && zombies.length > 0)) return;
  
  // mark all alive zombies as idle if pressing T (zombiesForward = true means stop)
  if (zombiesForward) {
    for (const z of zombies) {
      if (!z) continue;
      if (typeof z.health === 'number' && z.health <= 0) {
        // switch to dead and play the Death animation (only play once)
        if (z.state !== 'dead') {
          z.state = 'dead';
        }
        if (z.currentAnimName !== 'Death') {
          const deathClip = findAnimationByName(z.animations, 'Death');
          if (deathClip) {
            if (z.currentAction && typeof z.currentAction.stop === 'function') {
              z.currentAction.stop();
            }
            const act = z.mixer.clipAction(deathClip);
            act.reset().setLoop(THREE.LoopOnce, 0);
            act.clampWhenFinished = true;
            act.play();
            z.currentAction = act;
            z.currentAnimName = 'Death';
          }
        }
        continue;
      }
      if (z.state !== 'dead') {
        z.state = 'idle';
        // play the Idle animation, to avoid repeated switching
        if (z.currentAnimName !== 'Idle') {
          const idleClip = findAnimationByName(z.animations, 'Idle');
          if (idleClip) {
            if (z.currentAction && typeof z.currentAction.stop === 'function') {
              z.currentAction.stop();
            }
            const act = z.mixer.clipAction(idleClip);
            act.reset().setLoop(THREE.LoopRepeat).play();
            z.currentAction = act;
            z.currentAnimName = 'Idle';
          }
        }
      }
    }
    return;
  }
  
  // zombie movement logic (default: zombies move when not pressing T)
  for (const z of zombies) {
    if (!z || !z.rigidBody || !z.kcc) continue;
    // if dead, stop moving and play Death animation
    if (typeof z.health === 'number' && z.health <= 0) {
      z.state = 'dead';
      if (z.currentAnimName !== 'Death') {
        const deathClip = findAnimationByName(z.animations, 'Death');
        if (deathClip) {
          if (z.currentAction && typeof z.currentAction.stop === 'function') {
            z.currentAction.stop();
          }
          const act = z.mixer.clipAction(deathClip);
          act.reset().setLoop(THREE.LoopOnce, 0);
          act.clampWhenFinished = true;
          act.play();
          z.currentAction = act;
          z.currentAnimName = 'Death';
        }
      }
      continue;
    }
    z.state = 'moving';
    // play the Walk animation (if already Walk, don't switch again)
    if (z.currentAnimName !== 'Walk') {
      const walkClip = findAnimationByName(z.animations, 'Walk');
      if (walkClip) {
        if (z.currentAction && typeof z.currentAction.stop === 'function') {
          z.currentAction.stop();
        }
        const act = z.mixer.clipAction(walkClip);
        act.reset().setLoop(THREE.LoopRepeat).play();
        z.currentAction = act;
        z.currentAnimName = 'Walk';
      }
    }

    // periodically set target yaw (around Y axis) and turn with a certain angular velocity
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

    // move forward in the current facing direction
    const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(faceQuat).normalize();

    // gravity
    // z.vy = (typeof z.vy === 'number') ? z.vy : 0;
    z.vy += gravityAccel * dt;
    if (z.vy < terminalFallSpeed) z.vy = terminalFallSpeed;

    // desired displacement
    const desired = {
      x: forwardDir.x * moveSpeed * dt,
      y: z.vy * dt,
      z: forwardDir.z * moveSpeed * dt
    };

    // collision sensed displacement
    const controllerCollider = z.controllerCollider ?? (z.colliders && z.colliders[0]);
    if (!controllerCollider) continue;
    z.kcc.computeColliderMovement(controllerCollider, desired);
    const delta = z.kcc.computedMovement();

    // step
    const cur = z.rigidBody.translation();
    z.rigidBody.setNextKinematicTranslation({ x: cur.x + delta.x, y: cur.y + delta.y, z: cur.z + delta.z });

    // reset vertical velocity when grounded
    if (z.kcc.computedGrounded() && z.vy < 0) {
      z.vy = 0;
    }
  }
}

/**
 * destroy all zombies from scene and physics world
 * @param {Object} options - configuration options
 * @param {Array} options.zombies - zombie array
 * @param {THREE.Scene} options.scene - Three.js scene
 * @param {Object} options.world - RAPIER physics world
 * @param {Array} options.zombieMixers - zombie mixer array
 * @param {Array} options.mixers - mixer array
 * @param {Array} options.dynamicGltfObjects - dynamic GLTF object list
 */
export function destroyAllZombies({
  zombies,
  scene,
  world,
  zombieMixers,
  mixers,
  dynamicGltfObjects
}) {
  if (!zombies || zombies.length === 0) return;
  
  console.log(`Destroying ${zombies.length} zombies...`);
  
  for (let i = zombies.length - 1; i >= 0; i--) {
    const z = zombies[i];
    if (!z) continue;
    
    // 从场景中移除3D对象
    if (z.object && scene) {
      scene.remove(z.object);
      // 清理几何体和材质
      z.object.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    }
    
    // 从物理世界中移除碰撞器
    if (z.controllerCollider && world) {
      world.removeCollider(z.controllerCollider, true);
    }
    if (z.colliders && Array.isArray(z.colliders)) {
      for (const collider of z.colliders) {
        if (collider && world) {
          world.removeCollider(collider, true);
        }
      }
    }
    
    // 从物理世界中移除刚体
    if (z.rigidBody && world) {
      world.removeRigidBody(z.rigidBody);
    }
    
    // 从动画混合器列表中移除
    if (z.mixer && zombieMixers) {
      const mixerIndex = zombieMixers.indexOf(z.mixer);
      if (mixerIndex !== -1) {
        zombieMixers.splice(mixerIndex, 1);
      }
    }
    if (z.mixer && mixers) {
      const mixerIndex = mixers.indexOf(z.mixer);
      if (mixerIndex !== -1) {
        mixers.splice(mixerIndex, 1);
      }
    }
    
    // 从动态对象列表中移除
    if (dynamicGltfObjects) {
      const objIndex = dynamicGltfObjects.indexOf(z);
      if (objIndex !== -1) {
        dynamicGltfObjects.splice(objIndex, 1);
      }
    }
    
    // 从僵尸数组中移除
    zombies.splice(i, 1);
  }
  
  console.log('All zombies destroyed.');
}

