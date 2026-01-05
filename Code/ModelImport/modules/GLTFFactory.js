import * as THREE from '../../Common/three.js-r170/build/three.module.js';

/**
 * GLTF Factory
 * Provides functionality to create static and dynamic GLTF objects
 */

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

/**
 * Generate compound box colliders for a given rigid body: traverse each Mesh in object3d, approximate its world AABB as a box, and set the box position to the rigid body local coordinates to avoid overall error causing it to float; return all created colliders
 */
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

  // The world matrix of the rigid body (assuming it is aligned with object3d when created)
  object3d.updateWorldMatrix(true, true);
  const bodyMatrixWorld = object3d.matrixWorld.clone();
  const bodyMatrixInv = bodyMatrixWorld.clone().invert();

  const tmpBox = new THREE.Box3();
  const tmpCenterWorld = new THREE.Vector3();
  const tmpSizeWorld = new THREE.Vector3();

  object3d.traverse((child) => {
    if (!child.isMesh) return;

    // The world AABB of this Mesh
    tmpBox.setFromObject(child);
    tmpBox.getCenter(tmpCenterWorld);
    tmpBox.getSize(tmpSizeWorld);

    // Ignore very small boxes to avoid generating too many tiny colliders
    if (tmpSizeWorld.x < 0.01 && tmpSizeWorld.y < 0.01 && tmpSizeWorld.z < 0.01) return;

    // Convert to rigid body local coordinates
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
        // Only apply density if provided; otherwise, leave mass contribution to be set explicitly on the body
        if (typeof density !== 'undefined') d.setDensity(density);
        return d;
      })(),
      rigidBody
    );
    colliders.push(collider);
  });

  return colliders;
}

/**
 * glTF static scene factory: apply transformations, optional shadows, optional static trimesh colliders
 * @param {Object} options - 配置选项
 * @param {THREE.Object3D} options.object3d - GLTF场景对象
 * @param {Array<number>} options.position - position [x, y, z]
 * @param {Array<number>} options.rotation - rotation [x, y, z]
 * @param {Array<number>} options.scale - scale [x, y, z]
 * @param {boolean} options.enableShadows - whether to enable shadows
 * @param {boolean} options.addCollider - whether to add colliders
 * @param {Object} options.rapier - RAPIER object
 * @param {Object} options.rapierWorld - RAPIER physics world
 * @param {THREE.Scene} options.scene - Three.js scene
 * @returns {Object} { object, rigidBody }
 */
export function createStaticGLTF({
  object3d,
  position = [0, 20, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  enableShadows = true,
  addCollider = true,
  rapier,
  rapierWorld,
  scene
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
  if (addCollider && rapierWorld && rapier) {
    rb = addStaticTrimeshColliderFromMesh(rapier, rapierWorld, object3d);
  }

  return { object: object3d, rigidBody: rb };
}

/**
 * glTF dynamic object factory: generate sphere/box approximate colliders based on the bounding box, create a dynamic rigid body and register the synchronization
 * The rendering position is already synchronized with the rigid body movement, the sync function will be called every frame to synchronize the position
 * @param {Object} options - configuration options
 * @param {THREE.Object3D} options.object3d - GLTF scene object
 * @param {Array<number>} options.position - position [x, y, z]
 * @param {Array<number>} options.rotation - rotation [x, y, z]
 * @param {Array<number>} options.scale - scale [x, y, z]
 * @param {Array<number>} options.colliderScale - collider scale [x, y, z]
 * @param {boolean} options.enableShadows - whether to enable shadows
 * @param {string} options.shape - collider shape 'sphere' | 'box' | 'compound' | 'No'
 * @param {number} options.targetMass - target mass
 * @param {number} options.density - density
 * @param {number} options.friction - friction
 * @param {number} options.restitution - restitution
 * @param {Object} options.damping - damping { lin, ang }
 * @param {boolean} options.canSleep - whether to allow sleeping
 * @param {boolean} options.enableCcd - whether to enable continuous collision detection
 * @param {boolean} options.lockXZRotation - whether to lock XZ rotation
 * @param {Object} options.rapier - RAPIER object
 * @param {Object} options.rapierWorld - RAPIER physics world
 * @param {THREE.Scene} options.scene - Three.js scene
 * @param {Array} options.dynamicGltfObjects - dynamic GLTF object list
 * @param {Object} options.renderOffset - rendering offset { x, y, z }
 * @param {Function} options.addColliderDebugBox - debug function: add collider debug box
 * @param {Function} options.addColliderDebugCapsule - debug function: add collider debug capsule
 * @returns {Object} { object, rigidBody, colliders, sync }
 */
export function createDynamicGLTF({
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
  // Keep upright: prohibit X/Z rotation, only allow Y rotation
  lockXZRotation = false,
  rapier,
  rapierWorld,
  scene,
  dynamicGltfObjects,
  renderOffset,
  addColliderDebugBox = null,
  addColliderDebugCapsule = null
}) {
  if (!object3d) {
    console.error('[createDynamicGLTF] object3d is not valid');
    return { object: null, rigidBody: null, colliders: [] };
  }

  if (renderOffset === undefined) {
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

  // Calculate the bounding box size (world space)
  const bbox = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // shape === 'No' means no rigid body/collider will be created, only as a pure rendering object
  if (shape === 'No') {
    const entry = {
      object: object3d,
      rigidBody: null,
      colliders: [],
      sync: null
    };
    if (dynamicGltfObjects) {
      dynamicGltfObjects.push(entry);
    }
    return entry;
  }

  // Create a dynamic rigid body
  const desc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position[0], position[1], position[2])
    .setCanSleep(canSleep)
    .setLinearDamping(damping.lin)
    .setAngularDamping(damping.ang);
  const body = rapierWorld.createRigidBody(desc);

  // Colliders: default sphere is more stable; optional box/compound box
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
    if (addColliderDebugBox) {
      addColliderDebugBox(
        body,
        new THREE.Vector3(hx, hy, hz),
        new THREE.Vector3(0, 0, 0),
        0x00ffff
      );
    }
    
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
    if (addColliderDebugBox) {
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
        addColliderDebugBox(
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

    if (addColliderDebugCapsule) {
      addColliderDebugCapsule(
        body,
        radius,  // halfHeight
        radius,  // radius
        0x00ffff // color
      );
    }
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
    rigidBody: body,
    colliders,
    sync: syncFunc
  };
  if (dynamicGltfObjects) {
    dynamicGltfObjects.push(entry);
  }

  return entry;
}

