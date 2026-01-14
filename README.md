# CS324 WebGL/GLSL Coursework – FPS Zombie Game (Three.js + RAPIER)
# CS324 图形学课设 – FPS 打僵尸游戏（Three.js + RAPIER）

A browser-based first-person shooter built for the CS324 graphics coursework.  
You explore levels, fight zombies with multiple weapons, and reach the win condition by achieving **30 kills**.

基于浏览器的第一人称射击游戏，用于 CS324 图形学课设。  
玩家在不同关卡中探索、使用多种武器对抗僵尸，并以击杀数达到 **30** 作为胜利条件。

---

## Demo / Preview
## 演示 / 预览

- **Goal / 目标**: Reach **30 kills** to win.  
- **Win Condition / 通关条件**：击杀 **30** 个僵尸。

> Recommended browser / 推荐浏览器：**Google Chrome**  
> Must be served via **HTTP** (assets may fail under `file://`).  
> 必须使用 **HTTP** 本地服务器运行（`file://` 可能导致资源加载失败）。

---

## Features
## 功能与亮点

### Coursework Requirements
### 课设要求实现

- **Two distinct levels**  
  **两个明显不同的关卡**
  - **Level 1**: Main gameplay map  
    **关卡 1**：主战斗地图
  - **Shooting Range**: Separate training/testing environment with different layout & appearance  
    **靶场**：独立训练/测试地图，布局与视觉风格区别明显

- **Lighting**  
  **光照系统**
  - Ambient light in the scene  
    场景环境光
  - Directional “sun” light in both levels  
    两个关卡均包含方向光（太阳光）
  - Player-introduced dynamic lights  
    玩家引入的动态光源：
    - Flashlight (SpotLight)  
      手电筒（聚光灯）
    - Grenade light (PointLight + emissive material)  
      手雷发光（点光源 + 自发光材质）

- **Main Menu + In-game Help**  
  **主菜单 + 游戏内帮助**
  - Mouse-operable menu with instructions  
    可用鼠标操作的主菜单，并包含操作说明
  - Toggle in-game help/menu via `H`  
    游戏内随时按 `H` 打开/关闭帮助菜单
  - Optional `DEBUG` mode (helpers/collision boxes)  
    可选 `DEBUG` 模式（显示光源辅助线/碰撞体等调试信息）

- **FPS camera / mouse look**  
  **第一人称视角与鼠标控制**
  - Pointer-lock mouse look  
    指针锁定（Pointer Lock）控制视角
  - Pitch clamp to avoid unnatural rotation  
    俯仰角限制，避免镜头翻转/不自然旋转

### Additional Polish
### 额外完善

- Sound effects (weapon fire / grenade explosion)  
  音效（射击/爆炸等）
- HUD: kill counter, FPS panel, player coordinates  
  HUD：击杀数、FPS 面板、玩家坐标显示
- Zombie animation (movement/death)  
  僵尸动作/死亡动画
- Weapon recoil feedback (weapon + camera)  
  后坐力反馈（枪械抖动 + 镜头反馈）
- Physics & collision via RAPIER character controller  
  使用 RAPIER 角色控制器实现移动与碰撞交互

---

## How to Run
## 运行方式

### 1) Start a local HTTP server
### 1）启动本地 HTTP 服务器

Run the server from the **Code** directory (recommended).  
建议在 **Code** 目录下启动本地服务器。

Example / 示例：
```bash
python3 -m http.server 8000
