# 代码重构分析报告

## 可独立为单独JS文件的模块

### 1. **物理系统模块** (`Physics.js`)
**位置**: 522-675行, 2122-2237行
**包含内容**:
- `initPhysics()` - 物理世界初始化
- `addStaticTrimeshColliderFromMesh()` - 静态三角网格碰撞体
- `addCompoundBoxCollidersFromMesh()` - 复合盒碰撞体
- 物理对象工厂函数（createFixedCuboid, createDynamicBox等）

**优点**: 
- 物理逻辑独立，易于测试和维护
- 可在其他项目中复用
- 减少主文件复杂度

---

### 2. **GLTF工厂模块** (`GLTFFactory.js`)
**位置**: 251-492行
**包含内容**:
- `createStaticGLTF()` - 创建静态GLTF对象
- `createDynamicGLTF()` - 创建动态GLTF对象
- 碰撞体创建逻辑

**优点**:
- 对象创建逻辑集中管理
- 易于扩展新的对象类型
- 可复用性强

---

### 3. **武器系统模块** (`Weapons.js`)
**位置**: 31-50行, 926-1078行, 1774-1864行
**包含内容**:
- 武器状态管理（pistol, rifle, granade）
- 武器处理函数（weapon1, weapon2, weapon3, weapon4）
- 武器音效管理
- 武器位置和旋转更新逻辑
- 后坐力和抖动系统

**优点**:
- 武器逻辑集中，易于添加新武器
- 武器状态独立管理
- 便于平衡调整

---

### 4. **手雷系统模块** (`Grenades.js`)
**位置**: 40-44行, 1365-1636行
**包含内容**:
- 手雷对象池管理（`granadePool`, `GRANADE_POOL_SIZE`）
- `initGranadePool()` - 初始化对象池
- `getGranadeFromPool()` - 从池中获取手雷
- `returnGranadeToPool()` - 归还手雷到池
- `throwGranade()` - 投掷手雷逻辑
- 手雷闪烁效果和光源管理

**优点**:
- 对象池模式独立管理
- 手雷相关逻辑集中
- 易于优化和调试

---

### 5. **僵尸系统模块** (`Zombies.js`)
**位置**: 27-28行, 1135-1250行, 1877-1996行
**包含内容**:
- `createZombieAt()` - 创建单个僵尸
- `spawnZombiesAround()` - 批量生成僵尸
- `updateZombies()` - 僵尸移动和AI逻辑
- 僵尸状态管理（idle, moving, dead）
- 僵尸动画管理

**优点**:
- AI逻辑独立，易于调整行为
- 僵尸创建和管理集中
- 便于扩展僵尸类型和行为

---

### 6. **FPS控制器模块** (`FPSController.js`)
**位置**: 59-66行, 494-516行, 1672-1865行
**包含内容**:
- FPS移动状态（movement, smoothedMove）
- `stepFpsController()` - FPS控制器步进
- `updateFpsCamera()` - FPS相机更新
- 跳跃和重力系统
- 角色控制器逻辑

**优点**:
- 玩家控制逻辑独立
- 易于调整移动参数
- 便于添加新控制功能

---

### 7. **场景管理模块** (`Scenes.js`)
**位置**: 1252-1485行
**包含内容**:
- `createScene1()` - 场景1创建
- `createScene2()` - 场景2创建
- 场景资源加载逻辑

**优点**:
- 场景创建逻辑分离
- 易于添加新场景
- 场景切换更清晰

---

### 8. **UI/菜单模块** (`UI.js`)
**位置**: 13-17行, 74-152行, 2239-2300行
**包含内容**:
- `initMainMenu()` - 主菜单初始化
- `showMainMenu()` / `hideMainMenu()` - 菜单显示/隐藏
- `initPerfHUD()` - 性能HUD初始化
- `initDebugToggle()` - 调试开关初始化
- 菜单事件处理

**优点**:
- UI逻辑集中管理
- 易于修改UI布局
- 便于添加新UI元素

---

### 9. **光照和渲染模块** (`Lighting.js`)
**位置**: 153-210行
**包含内容**:
- `initLighting()` - 光照初始化
- `initSkybox()` - 天空盒初始化
- 光照辅助器管理

**优点**:
- 光照设置集中管理
- 易于调整光照参数
- 便于切换不同光照方案

---

### 10. **调试工具模块** (`Debug.js`)
**位置**: 53-56行, 218-249行
**包含内容**:
- `addColliderDebugBoxForBody()` - 碰撞体调试盒
- `addColliderDebugCapsuleForBody()` - 碰撞体调试胶囊
- `updateColliderDebugs()` - 更新调试可视化
- 性能监控（低FPS显示）

**优点**:
- 调试工具独立，生产环境可移除
- 便于开发时使用
- 不影响主逻辑

---

### 11. **渲染循环模块** (`Renderer.js`)
**位置**: 1650-2120行
**包含内容**:
- `render()` - 主渲染循环
- `resizeRendererToDisplaySize()` - 渲染器尺寸调整
- `updateCameraAspectOnResize()` - 相机宽高比更新
- `onWindowResize()` - 窗口大小变化处理
- `createControls()` - 控制器创建
- `updateMixers()` - 动画混合器更新

**优点**:
- 渲染逻辑集中
- 易于优化渲染性能
- 便于添加后处理效果

---

## 重构建议优先级

### 高优先级（立即重构）
1. **物理系统模块** - 逻辑清晰，依赖关系简单
2. **GLTF工厂模块** - 功能独立，复用性强
3. **手雷系统模块** - 逻辑完整，边界清晰

### 中优先级（后续重构）
4. **武器系统模块** - 需要与主循环协调
5. **僵尸系统模块** - 需要与物理系统协调
6. **FPS控制器模块** - 需要与相机和输入系统协调

### 低优先级（可选重构）
7. **场景管理模块** - 当前逻辑简单
8. **UI/菜单模块** - 功能相对独立
9. **光照和渲染模块** - 代码量较小
10. **调试工具模块** - 开发时有用，可保留

---

## 重构后的文件结构建议

```
ModelImport/
├── test.js (主入口文件，精简后)
├── modules/
│   ├── Physics.js
│   ├── GLTFFactory.js
│   ├── Weapons.js
│   ├── Grenades.js
│   ├── Zombies.js
│   ├── FPSController.js
│   ├── Scenes.js
│   ├── UI.js
│   ├── Lighting.js
│   ├── Debug.js
│   └── Renderer.js
└── test.html
```

---

## 注意事项

1. **全局变量管理**: 需要仔细处理模块间的共享状态
2. **依赖注入**: 考虑使用依赖注入模式传递scene, world等共享对象
3. **事件系统**: 考虑使用事件系统解耦模块间通信
4. **导出/导入**: 确保正确使用ES6模块系统
5. **向后兼容**: 重构时保持功能不变


