# 现代 Web 3D 网站开发实战指南
*(Modern Web 3D Development: Architecture, Assets & Production)*

---

## 1. 核心架构认知：为什么做 Web 3D？

开发 Web 3D 网站前，必须明确其与传统网站及“云游戏”的本质差异：

```
                    ┌───────────────────────────────┐
                    │      免费/轻量静态服务器      │
                    │  (Cloudflare / GitHub / OSS)  │
                    └───────────────┬───────────────┘
                                    │ 传输 HTML/JS/GLB (一次性下载)
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │               访问者的本地设备 (浏览器环境)             │
       │                                                         │
       │  ┌─────────────────────────┐  ┌──────────────────────┐  │
       │  │       客户端 CPU        │  │      客户端 GPU      │  │
       │  │  逻辑 / 运动学 / 碰撞   │  │  WebGL / WebGPU 渲染 │  │
       │  │  Web Audio 音频合成     │  │  着色器 / 光影 / 后处理│  │
       │  └─────────────────────────┘  └──────────────────────┘  │
       └─────────────────────────────────────────────────────────┘
```

- **算力分摊机制（Client-Side Rendering）**：所有多边形计算、着色器插值、物理碰撞均在**访问者设备的显卡与浏览器**中运行。
- **服务器角色**：仅充当静态资源分发器（CDN），**CPU 负载趋近于 0，几乎没有算力成本**。
- **核心体验指标**：首屏加载时间（FCP）、包体积（Bundle Size）、帧率稳定性（60/120 FPS）。

---

## 2. 现代 Web 3D 技术选型矩阵

根据不同业务场景，技术选型呈现明显的层次分化：

| 技术栈 | 核心优势 | 学习曲线 | 最适场景 |
| :--- | :--- | :--- | :--- |
| **Three.js (原生/Vanilla)** | 纯粹、无框架绑定、底层控制力强、社区生态最成熟 | 中等 | 独立 3D 漫游项目、高性能定制可视化、游戏向 Demo |
| **React Three Fiber (R3F)** | 声明式组件化、生态极大化 (`@react-three/drei` / `postprocessing`) | 中~高 | 品牌高端官网、交互展厅、现代 React 应用嵌入 |
| **Spline** | 类似 Figma 的 3D 设计工具，带物理模拟与事件触发，一键导出 Web 代码 | 极低 | UI/UX 设计师主导、轻量 3D 按钮/插画微交互 |
| **Babylon.js** | 工业级 PBR 材质系统、原生深度 WebGPU 优先、文档与工具链极全 | 中等 | 工业数字孪生、B端复杂 3D 仿真、中大型网页游戏 |
| **3D Gaussian Splatting (3DGS)** | 照片级写实光影、高光反射媲美电影、无需传统建模 | 中等 | 实景数字扫描、文物与建筑高精度复刻展厅 |

---

## 3. 3D 资产优化与工业级压缩流水线

Web 3D 的头号杀手是**模型体积过大**。未压缩的模型（如 50MB 的 OBJ/FBX）会导致用户等待白屏并崩溃手机显存。

### 3.1 格式选型：为什么必须是 `.glb`？
- **淘汰**：`.obj`（无动画/无PBR材质）、`.fbx`（专有格式/解析器庞大容易出错）。
- **标准**：**`.glb`（二进制 glTF）**—— 模型几何、骨骼动画、PBR 材质、纹理贴图全部打包进单文件，只需一次网络请求。

### 3.2 几何与贴图压缩标准
```
   原始 3D 资产 (FBX/OBJ)
           │
           ▼ (Blender 导出或 gltf-transform 处理)
   ┌──────────────────────────────────────────────────┐
   │ 1. Draco / Meshopt 压缩 (顶点数据压缩 80%~90%)    │
   │ 2. 贴图降采样 (4K → 1K/2K)                       │
   │ 3. 纹理转 WebP 或 KTX2 (GPU 专有显存就绪格式)    │
   └──────────────────────────────────────────────────┘
           │
           ▼
   最终 Web GLB 资产 (通常仅 1MB ~ 5MB，秒开)
```

### 3.3 Three.js 异步解压加载器标准写法
```typescript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
// 指定 Draco 解码器 wasm 路径（可放于本地 public/draco/ 或 CDN）
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// 异步加载
gltfLoader.load('/models/character_draco.glb', (gltf) => {
  const model = gltf.scene;
  scene.add(model);
});
```

---

## 4. 视觉质感进阶技巧（从粗糙到电影级）

为什么很多 Web 3D 看起来像“90年代过时游戏”，而优秀作品却如吉卜力动画或影视大片？关键在于以下四层调教：

### 4.1 色调映射（Tone Mapping）
默认渲染器使用线性映射，高光容易死白。必须开启 **ACES Filmic**：
```typescript
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15; // 提升高动态范围表现
```

### 4.2 赛璐璐卡通渲染（Toon / Cel-Shading）
模拟《塞尔达传说：旷野之息》或日本动画的关键在于阶梯式漫反射光照：
- 使用 `MeshToonMaterial` 搭配 3 阶/4 阶梯度明暗图（Gradient Map）。
- 阴影面采用带色彩倾向的色调（如冷紫或深翠绿），而非死黑。

### 4.3 性能奇迹：InstancedMesh 单 DrawCall 批量化
如果要渲染成千上万个独立物体（如海拉鲁平原的 24,000 株草叶、森林树木、星系微粒）：
- **绝对不要** `scene.add()` 24,000 次普通 Mesh（会导致 CPU 提交 24,000 次 DrawCall，彻底卡死）。
- **必须使用** `THREE.InstancedMesh`：所有变换矩阵存入 GPU 缓冲区，**在 1 次 DrawCall 内绘制完毕**。

### 4.4 自定义 GPU 顶点风场着色器（Vertex Shader）
通过在顶点着色器中注入时间与正弦噪声，让草叶、树枝、旗帜在 GPU 端随风波动：
```glsl
// 顶点着色器片段 (Vertex Shader)
vec4 worldPos = instanceMatrix * vec4(position, 1.0);
float heightFactor = clamp(position.y / 1.15, 0.0, 1.0);

// 多层复合风场波浪
float wind = sin(worldPos.x * 0.1 + worldPos.z * 0.1 + uTime * 2.0) * uWindStrength;
worldPos.x += wind * heightFactor * heightFactor; // 根部固定，草尖大幅摆动
gl_Position = projectionMatrix * viewMatrix * worldPos;
```

---

## 5. 交互、物理与沉浸式体验构建

### 5.1 摄像机控制模式设计
一个高完成度的 3D 网站通常具备三种视角协同：
1. **TPS（第三人称跟随）**：使用缓动插值（`lerp`）平滑追踪角色，并带地表最低高度保护（防镜头穿模插地）。
2. **Cinematic Tour（自动电影巡航）**：沿贝塞尔样条曲线（`CatmullRomCurve3`）自动环游，用于无操作演示。
3. **Orbit/Free（自由观察）**：适合产品 360° 旋转拆解与特写。

### 5.2 轻量化碰撞检测体系
- **起伏地形**：无需复杂的刚体网格碰撞，直接使用**数学高度函数** `getTerrainHeight(x, z)` 实时计算地面高度与法线。
- **复杂障碍物**：若需物理模拟，推荐 **Rapier.js**（WebAssembly 加速，比传统 Cannon.js 快数倍）。

### 5.3 纯前端 Web Audio 空间声场
无需预先下载几十兆 MP3 背景音乐：
- 用滤波白噪声发生器生成动态自然风声；
- 用振荡器与谐波衰减程序化合成空灵钢琴音符（Pentatonic / Modal 调式）；
- 结合 `PannerNode` 实现 3D 空间声源定位。

---

## 6. 零成本全球分发部署方案

```
                   ┌──────────────────────────────────────┐
                   │        GitHub 仓库 (代码管理)        │
                   └──────────────────┬───────────────────┘
                                      │ Git Push
                                      ▼
                   ┌──────────────────────────────────────┐
                   │    Cloudflare Pages (自动 CI/CD)     │
                   │  • 免费构建打包 (Vite build)         │
                   │  • 全球 330+ 节点边缘 CDN 免费加速   │
                   │  • 无限流量 / 0 费用账单             │
                   └──────────────────┬───────────────────┘
                                      │ (若模型 > 25MB)
                                      ▼
                   ┌──────────────────────────────────────┐
                   │    Cloudflare R2 (免费对象存储)      │
                   │  • 10GB 免费存储容量                 │
                   │  • 全网唯一 0 Egress Fee (免流量费)  │
                   └──────────────────────────────────────┘
```

### 部署落地 4 步走：
1. **本地构建测试**：运行 `npm run build`，确保 `dist/` 产物无报错。
2. **关联 Git 仓库**：在 Cloudflare Dashboard 点击 **Pages** -> **Create a project** -> 关联 GitHub 仓库。
3. **填写构建命令**：
   - Build command: `npm run build`
   - Output directory: `dist`
4. **一键上线**：每次 `git push`，Cloudflare 自动构建并赋予类似 `your-project.pages.dev` 的全球访问网址，自带免费 SSL 证书。
