import * as THREE from '../../Common/three.js-r170/build/three.module.js';
import { GLTFLoader } from '../../Common/three.js-r170/examples/jsm/loaders/GLTFLoader.js';
import { createDynamicGLTF } from './GLTFFactory.js';

/**
 * 手雷系统模块
 * 提供手雷对象池管理、投掷和回收功能
 */

// 手雷对象池
let granadePool = [];
const GRANADE_POOL_SIZE = 10;

/**
 * 初始化手雷对象池
 * @param {Object} options - 配置选项
 * @param {THREE.Scene} options.scene - Three.js场景
 * @param {Object} options.RAPIER - RAPIER对象
 * @param {Object} options.world - RAPIER物理世界
 * @param {Array} options.dynamicGltfObjects - 动态GLTF对象列表
 * @param {THREE.Vector3} options.hiddenPosition - 隐藏位置
 * @param {Function} options.addColliderDebugBox - 调试函数：添加碰撞体调试盒
 * @param {Function} options.addColliderDebugCapsule - 调试函数：添加碰撞体调试胶囊
 * @param {string} options.modelPath - 手雷模型路径，默认 '../GlTF_Models/toon_granade/scene.gltf'
 */
export function initGranadePool({
  scene,
  RAPIER,
  world,
  dynamicGltfObjects,
  hiddenPosition,
  addColliderDebugBox = null,
  addColliderDebugCapsule = null,
  modelPath = '../GlTF_Models/toon_granade/scene.gltf'
}) {
  const dynLoader = new GLTFLoader();
  dynLoader.load(modelPath, function (gltf) {
    for (let i = 0; i < GRANADE_POOL_SIZE; i++) {
      const granadeInstance = createDynamicGLTF({
        object3d: gltf.scene.clone(), // 克隆场景以避免共享
        position: [hiddenPosition.x, hiddenPosition.y, hiddenPosition.z],
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
        renderOffset: { x: 0, y: -1, z: 0 },
        rapier: RAPIER,
        rapierWorld: world,
        scene: scene,
        dynamicGltfObjects: dynamicGltfObjects,
        addColliderDebugBox: addColliderDebugBox,
        addColliderDebugCapsule: addColliderDebugCapsule
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

/**
 * 从对象池获取一个可用的手雷
 * @returns {Object|null} 可用的手雷实例，如果池已用完则返回null
 */
export function getGranadeFromPool() {
  for (let i = 0; i < granadePool.length; i++) {
    if (granadePool[i].isAvailable) {
      return granadePool[i];
    }
  }
  return null; // pool is used up
}

/**
 * 将手雷归还到对象池
 * @param {Object} options - 配置选项
 * @param {Object} options.granadeInstance - 手雷实例
 * @param {THREE.Scene} options.scene - Three.js场景
 * @param {THREE.Vector3} options.hiddenPosition - 隐藏位置
 */
export function returnGranadeToPool({
  granadeInstance,
  scene,
  hiddenPosition
}) {
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
    granadeInstance.rigidBody.setTranslation(hiddenPosition, true);
    granadeInstance.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    granadeInstance.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  if (granadeInstance.object) {
    granadeInstance.object.position.copy(hiddenPosition);
  }
  
  // mark as available
  granadeInstance.isAvailable = true;
}

/**
 * 投掷手雷
 * @param {Object} options - 配置选项
 * @param {THREE.Vector3|Array<number>} options.position - 投掷位置
 * @param {THREE.Vector3|Array<number>} options.direction - 投掷方向
 * @param {number} options.speed - 投掷速度，默认15
 * @param {THREE.Scene} options.scene - Three.js场景
 * @param {Function} options.onCreated - 创建完成后的回调函数
 */
export function throwGranade({
  position,
  direction,
  speed = 15,
  scene,
  onCreated = null
}) {
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

/**
 * 设置手雷爆炸逻辑
 * @param {Object} options - 配置选项
 * @param {Object} options.granadeInstance - 手雷实例
 * @param {THREE.Scene} options.scene - Three.js场景
 * @param {Array} options.zombies - 僵尸数组
 * @param {number} options.explosionRadius - 爆炸半径，默认80
 * @param {number} options.damage - 伤害值，默认100
 * @param {number} options.delay - 延迟时间（毫秒），默认6000
 * @param {THREE.Vector3} options.hiddenPosition - 隐藏位置
 * @param {Function} options.onExplode - 爆炸时的回调函数
 */
export function setupGranadeExplosion({
  granadeInstance,
  scene,
  zombies,
  explosionRadius = 130,
  damage = 500,
  delay = 6000,
  hiddenPosition,
  onExplode = null
}) {
  if (!granadeInstance) return null;
  
  const timeoutId = setTimeout(function() {
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
    let damagedZombies = 0;
    for (const z of zombies) {
      if (!z || !z.rigidBody) continue;
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
        z.health = Math.max(0, z.health - damage);
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
    
    // 调用爆炸回调
    if (onExplode) {
      onExplode(explosionPosition);
    }
    
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
    returnGranadeToPool({
      granadeInstance: granadeInstance,
      scene: scene,
      hiddenPosition: hiddenPosition
    });
    
    console.log('Granade exploded at position:', explosionPosition, 'and left a red sphere');
  }, delay);
  
  return timeoutId;
}

