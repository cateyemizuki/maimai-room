# 麦麦房间前端

入口保存界面模板及可见性检测。房间首次显示时，宿主 SDK 才分页读取场景程序和角色 GLB。浏览器通常使用 gzip，旧浏览器可用普通 JS 分块。退出或隐藏房间会释放 WebGL 上下文、模型、贴图与电视媒体。

## 宿主连接

插件声明 `schema_version: 2`、`mode: custom`、`layout: viewport`、`entry: web/index.html`。宿主路由为 `/extensions/cateye.maimai_room/room`。

全部业务通信通过宿主注入的 `window.maibot`，先等待 `maibot.ready`：

| 类型 | 页面别名 | 用途 |
|---|---|---|
| query | `runtime_chunk` | 加载可见场景所需的固定 JS 文件，支持 gzip 和 plain |
| query | `summary` | 读取 `room_snapshot` v1；轮询 2 秒 |
| query | `model_info` | `asset: "maisaka.glb"`；读取大小、分块数、摘要 |
| query | `model_chunk` | `asset: "maisaka.glb", index: 整数`；读取 base64 分块 |
| action | `interact` | `command, target, request_id`；UUID 幂等键 |
| action | `garden` | `action, plot, crop, quantity, request_id`；共用菜园事务 |
| action | `chat_send` | 用户点击发送后将 `text, request_id` 交给宿主内部聊天 |
| query | `chat_status` | 按 `request_id` 读取状态，只接收明确关联的回复 |
| action | `tv_save_frame` | 用户选择保存的 `image_data, request_id`；保存到插件本机目录 |
| action | `tv_review` | 用户明确选择交给视觉模型点评的单帧；参数同上 |
| query | `tv_status` | 按 `request_id` 读取保存收据或视觉点评结果 |

每次只发一个桥请求。模型读取期间暂停状态轮询，保留两请求上限的余量。标准块为 196608 原始字节，结果 JSON 低于宿主 512 KiB。检查模型总长、块号、块长、资产名和版本；环境支持 SubtleCrypto 时另校验 SHA-256。

宿主禁止 `fetch`、外部模块和 worker。本播放器将 GLTFLoader 纹理通路设为 TextureLoader，使用允许的 `<img src="blob:…">` 解码内嵌纹理，避开 ImageBitmapLoader 的 `fetch(blob:)`。

在普通网页或直接双击 HTML 时，只有房间场景可以展示；桥未连接会明确提示，页面不会模拟成功的生活状态或对话。

## 模型和动画

稳定文件路径为 `web/assets/models/maisaka.glb`，精细档为 `maisaka-hi.glb`，由后端读取。两档以固定 `quality: "mobile" | "high"` 请求，默认 mobile；逻辑资产名仍为 `maisaka.glb`。用户可随时改档，较早的慢请求不能覆盖最新选择；失败保留已加载的模型。使用自包含 GLB，纹理内嵌 PNG/JPEG，不依赖外部贴图、Draco、KTX2 或外部 decoder / worker。最大 20 MiB。

坐标为 +Y 向上、+Z 正面，站立脚底为原点；加载时统一到 1.42 房间单位高。支持真实 glTF 骨骼、蒙皮和动画，不会对存在对应动画的角色叠加静态根节点屈伸。

动画名：`Idle`、`Walk`、`Sit`、`Sleep`、`Dance`、`Stretch`、`Bow`。大小写和常见同义名兼容，动作间 0.22 秒淡入淡出。站立和走路使用真实骨骼；坐姿按 hips / pelvis 对齐家具前沿，脚伸到坐垫外。当前场景中沙发顶面 0.48、书桌椅顶面 0.52（历史状态中的 0.40 / 0.44 在显示时校正）；床面约 0.65。Sleep 已平躺，播放器不再重复转根。Dance / Stretch / Bow 在站立时播全身 clip，坐姿只做小幅上身反馈。

缺少动画时以轻微根节点移动和静态坐躺回退显示；这只保证兼容，不等同于骨骼坐姿。缺模型时显示可重试的加载失败提示，不以其他角色素材替代。

脸部只写实际存在的 morph target。支持自动眨眼、睡眠闭眼；存在 combined `blink` 时不叠加左右闭眼，睡眠不叠加 happy / relaxed。表情来自 `character.expression`，或明确 `available: true` 的生活情绪；未接入时不虚构情绪。嘴型 aa 预留，当前没有语音聊天或伪造说话动作。

立绘来自用户批准的 `MaiSaka-Q-approved.png`，只重编码为 512×768、透明 WebP（`assets/maisaka-sprite.webp`），随场景程序交付，实际切换立绘或拖动预览时才创建贴图。默认 3D，切换立绘后仍使用同一位置、姿态、阴影和状态；单幅立绘的坐躺是几何近似，不冒充多帧角色动画。

## 操作与来源

拖动旋转，滚轮或双指缩放；全景、跟随角色、室内视角；完整房间导航；点家具查看和走过去。指路模式点地面，或长按角色 380ms 拖动目的地预览，松手仅提交后端 `walk`，人物沿合法路点走，不直接把角色传送到指针位置。WASD / 方向键只在室内视角移动镜头。断线保留最后快照并标明同步中断，不无限外推。

跟随镜头直接使用场景给出的七件家具遮挡盒，按模型头部、胸口两条视线选择有限的侧移 / 抬高候选；保留用户请求的角度，用短暂滞后避免移动或手动旋转时来回切换。相机插值也检查同样的视线，避免两个安全机位之间穿过电视。不会修改角色位置或家具材质。

手机默认跟随角色，生活面板可收起；支持 320px 宽与横屏。画质按钮切渲染分辨率和阴影；角色精度独立切换两档模型。原房间静态家具按材质合并绘制，墙体、时钟、屏幕与交互点仍独立更新。

生活日程、生活情绪、房间临时表情分别显示来源。`controlsEnabled: false` 时禁用房间和园艺写操作。摸头、喂食、倒水等 `gesture.text` 是动作叙述，不显示成 LLM 回复。

新建的八畦菜园与十二种作物接入已有的商店、仓库和操作界面，消费服务器 catalog / rules 与真实视图。操作排队后由后端让人物走到田边，再工作和结算；手机整张面板可滚动，种植、仓库、商店都可达。冲突倒计时使用服务器时间偏移，处理后按服务器状态移除提示。

电视支持用户自己选择本地 PNG/JPEG/WebP、MP4/WebM/Ogg，等比显示到客厅电视，视频可暂停、继续、停止；观看窗口支持 50%、80% 与铺满当前页面。屏幕共享只在宿主 Permissions Policy 与浏览器能力允许时才请求授权；受限时禁用并给出本地媒体选择。当前 opaque iframe 的实测 display-capture 未开放，没有绕过宿主策略。陪伴卡来自实时三维渲染，可调大小，不使用原 IP 素材。

单帧按钮从当前电视 Canvas 实际画面截取 WebP，先只在页面预览。512×288 起步，按需要降画质和分辨率，保证 Data URL ≤48000 字符，原始解码低于 36000 字节。保存和视觉点评各由独立按钮触发；保存到插件本机 `tv_frames`，不冒充沙箱不支持的浏览器下载。点评按钮上方明确提示单帧将交给宿主配置的 vlm 视觉模型及可能费用。不可用时禁用，30 秒冷却，不自动截取或发送；验收使用保存/视觉双替身，没有实际模型调用费用。

房间聊天经宿主内部聊天处理，共用已有会话，不发送 QQ、不新建独立模型会话。只有 `status: replied` 且 `correlation: reply_message_id` 的精确关联回答才显示；排队、已发送、未匹配、错误均如实提示。原生入口为宿主侧栏「聊天（/chat）」，不尝试沙箱不允许的假跳转。页面记录仅保留本次打开期间。

## 重建

安装开发依赖后运行：

```powershell
npm install
npm run build
```

构建输出 `index.html`、`runtime/room.js.gz` 和 `runtime/room.js`；构建会在超过宿主单页 2 MiB 时失败。插件安装包不需要 `node_modules`。构建原料和源代码保留在本目录，便于之后修改。

## 验证

1.1.0 在同机位实测新旧绘制开销，并检查首次隐藏、分块中断、销毁、恢复和卸载。交付目录的 `验收/新版-房间生命周期验收.json` 记录浏览器数据，`验收/新版-小主机实际渲染.json` 记录正式宿主数据。以下是 1.0.1 的历史基线。


`validation/browser-report.json` 与 PNG 是本地沙箱集成验收证据，运行在无用户窗口的 Chrome。桥 SDK 取自本机 MaiBot 1.4.0 Dashboard 源码，使用真实 opaque iframe sandbox、严格 CSP、实际 `room_core.py` / `garden_care.py` / `garden.py` 和本地 loopback 传输。报告记录文档与模型摘要、每项检查及截图。聊天回包是明确标记的本地验收夹具，没有调用真实 LLM。

最终完整前端为 917849 字节，41 项检查通过。最后一次模型权重更新另以同一 HTML 完成两档沙箱复核，结果在 `validation/model-smoke-report.json`。面向交付的逐项验收表见 [validation/验收表.md](validation/验收表.md)。

该报告不代表生产 QQ 已发送消息，也不代表生产宿主已部署。实际宿主安装验收由整个插件交付流程单独记录。

原房间、依赖和素材边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
