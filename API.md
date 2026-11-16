# 麦麦的小屋 API

适用于插件 1.3.0、MaiBot SDK 2.20 及以上。插件 ID 为 `cateye.maimai_room`，本文所有 API 的版本均为字符串 `"1"`。

## 调用与返回

其他插件在清单中声明 `api.call`，通过已有 SDK 上下文调用公开 API。

```python
async def call_room(ctx, name, **kwargs):
    result = await ctx.api.call(
        "cateye.maimai_room." + name, version="1", **kwargs
    )
    if isinstance(result, dict) and result.get("success") is False:
        raise RuntimeError(result.get("error") or "房间接口调用失败")
    return result

view = await call_room(self.ctx, "room_snapshot")
```

SDK 会去掉宿主 RPC 外层的 `result` 包装。能力或传输错误可能抛异常，也可能返回 `success=false` 的错误对象，因此提供方应同时处理这两种情况。异步媒体的 `loading` 回执和动作的 `changed` 字段各自表达操作状态。

公开 API 在已安装插件的 SDK 信任域内使用。WebUI 私有 API 通过宿主登录和自定义页绑定调用。插件使用宿主现有通信通道。

| 公开接口 | 用途 |
| --- | --- |
| `room_snapshot` | 获取当前采样时刻的角色、活动、园艺和能力状态 |
| `room_control` | 领取、续租、释放、查询行为接管 |
| `room_schedule_update` | 接管方推送当前活动、展示日程和可选情绪 |
| `room_control_action` | 接管方执行角色动作 |
| `room_media_control` | 指定媒体直链或控制当前电视播放 |
| `room_media_status` | 查询媒体准备状态 |
| `room_events` | 按序号补读用户互动信号 |
| `room_events_subscribe` | 注册或移除另一插件的公开 API 回调 |

## 行为接管

### room_control

```python
room_control(
    action="status", provider="", token="", ttl_seconds=300
)
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `action` | str | `status`、`claim`、`renew`、`release` |
| `provider` | str | 接管来源标识，领取和续租时填写，1–128 字符 |
| `token` | str | 续租、释放时填写领取回执中的 token |
| `ttl_seconds` | int | 10–86400 秒，默认 300 |

`claim` 在没有有效接管时生成 token。已有接管时，需要原 token 和相同 provider 才能延长。其他提供方请求覆盖会失败。token 只在领取和续租回执中返回。

```json
{
  "ok": true,
  "active": true,
  "provider": "example.schedule",
  "expiresAt": 1800000300000,
  "scheduleConnected": false,
  "token": "<保存本次返回的管理回执>"
}
```

`status` 返回上述状态字段，省略 token。时间戳单位均为毫秒。接管方在到期前续租即可保持控制，释放或到期后回到房间固定作息。配置热更新保留尚有效的接管，插件实例真正重载后需要重新领取。

只领取接管而没有推送日程时，房间自动作息和自动园艺会让出行为控制，提供方可直接使用动作 API。

### room_schedule_update

```python
room_schedule_update(token, activity, schedule=None, mood="")
```

`activity` 是当前实际活动，支持下列字段。

| 字段 | 说明 |
| --- | --- |
| `name` | 活动名 |
| `description` | 简短描述 |
| `goal_type` | 可选的提供方活动类别 |
| `time_window` | 可选的展示时间范围 |
| `target` | 指定房间地点 |
| `command` | `walk/sit/sleep/stand` |

省略目标时按活动名匹配地点，例如学习去书桌、睡觉去床。指定目标时按给定地点执行。`schedule` 最多 80 行，每行为 `time`、`activity`、`day_offset`，后者为 0 或 1。日程列表用于展示，提供方负责按时更新当前 `activity`。

`mood` 为可选情绪显示文本，最多保留 120 字符。原始复杂活动对象只提取接口声明的字段。

```python
lease = await call_room(
    self.ctx, "room_control",
    action="claim", provider="example.schedule", ttl_seconds=300
)
token = lease["token"]
await call_room(
    self.ctx, "room_schedule_update", token=token,
    activity={"name": "看书", "target": "desk", "command": "sit"},
    schedule=[{"time": "14:00", "activity": "看书", "day_offset": 0}],
    mood="平静",
)
```

成功回执为 `{"ok": true, "integration": {...}}`。未接入第三方日程时采用 Asia/Shanghai 固定作息，07:00 起床，22:00 就寝，白天安排用餐、学习工作与休闲。

### room_control_action

```python
room_control_action(token, command, target="", request_id="")
```

| command | target |
| --- | --- |
| `stand/wake` | 可留空 |
| `walk` | 地点名、完整地点 ID，或可行走地面的 `x,z` |
| `sit` | 沙发、椅子等地点 |
| `sleep` | 通常为 `bed` |
| `auto` | 解除手动姿态覆盖 |
| `mood` | `开心/困/恢复`，也支持已声明的英文表情名 |
| `lamp` | `on/off`，留空切换 |
| `lamp_on/lamp_off` | 留空 |
| `pet/poke/feed/water/play/dance/stretch/bow` | 留空 |

常用地点为 `sofa/bed/desk/balcony/kitchen/dining/bathroom/garden/door`。完整 ID 示例有 `balcony.chair`、`living.sofa`。`walk` 到家具会停在其可接近的位置，`sit/sleep` 再使用对应家具。地面坐标保留可达的准确位置，墙体、家具和田块内部的地面目标会被拒绝。

`command` 最长 24 字符，`target` 最长 80 字符，`request_id` 最长 128 字符。相同请求 ID 在有界去重记录内复用，动作不会重复计数。默认保留最近 256 个请求，且清除超过 24 小时的记录。

返回快照加 `ok/changed/message`。`changed=false` 可以表示重复请求。手动姿态默认保持 900 秒，可通过配置调整，`auto` 可以解除。

```python
await call_room(
    self.ctx, "room_control_action", token=token,
    command="walk", target="6.7,2.1",
    request_id="schedule-event-20261116-001",
)
await call_room(
    self.ctx, "room_control", action="renew",
    provider="example.schedule", token=token, ttl_seconds=300,
)
await call_room(self.ctx, "room_control", action="release", token=token)
```

## 快照

`room_snapshot()` 无参数。主要字段如下。

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 当前为 1 |
| `revision` | 已提交房间状态的版本号 |
| `serverTime` | 本次采样的服务器时间，毫秒 |
| `movementSpeed` | 实际配置的米/秒速度 |
| `character.position` | `{"x": ..., "z": ...}` |
| `character.path` | 尚未走完的路径点 |
| `character.walking` | 是否正在行走 |
| `character.pose` | `stand/sit/lie` |
| `character.facing` | 0 为北，90 为东 |
| `character.target` | 地点与到达后的动作信息 |
| `character.expression` | 表情名、来源、有效期 |
| `character.gesture` | 瞬时动作，含起止时间，结束后为 null |
| `life` | 当前活动、日程、来源和情绪显示 |
| `garden` | 园艺状态、目录、排队与照料情况 |
| `integration` | 接管提供方、到期时间、日程是否接入 |
| `tools` | 工具总开关、当前可用性、强制开关 |
| `chat` | 专属聊天是否启用及其 sessionId |
| `tv` | 电视能力和指定媒体的播放准备状态 |
| `manualUntil` | 手动覆盖到期时间 |

返回的角色位置推算到本次采样时刻，因此连续读取时，位置可以在同一提交 revision 内变化。此推算保留持久状态的事务边界。普通快照不包含接管 token、回调管理 token 或聊天内容。

## 用户互动信号

### 事件结构

```json
{
  "id": "一次互动的稳定标识",
  "seq": 42,
  "at": 1800000000000,
  "type": "room.action",
  "name": "dance",
  "detail": {
    "command": "dance",
    "target": "",
    "kind": "webui"
  }
}
```

| type | 示例 | 含义 |
| --- | --- | --- |
| `ui.click` | `button/object.select/garden.plot/ground.guide` | 点击或场景选择意图 |
| `ui.gesture` | `camera.orbit/camera.pan/camera.zoom` | 一次镜头手势结束 |
| `ui.change` | `control.change/media.select` | 控件或媒体选择发生变化 |
| `room.action` | `feed/water/dance/sit/mood` | 用户的房间动作被接受 |
| `garden.action` | `plant/water/harvest` | 用户的园艺安排被接受 |
| `chat.action` | `send` | 用户提交专属聊天消息 |

按钮意图与已接受动作是不同的事件，提供方按所需阶段监听。`detail.kind` 在房间、园艺动作中标识 `webui/qq`。回调里收到“安排被接受”时，行走、园艺工作或模型动作可能仍在进行。

事件只包含必要的控件、地点、动作、田块等字段。聊天正文、照片内容、媒体地址和本地文件名没有放进通用点击信号。

### room_events

```python
room_events(after_seq=0, limit=100)
```

`after_seq` 为非负整数，`limit` 为 1–256。返回事件列表及最新、最旧序号。单页同时受约 200 KiB 的事件正文预算约束，因此返回条数可以小于 limit。房间保留最近 256 条事件，随房间存档保存。

```python
result = await call_room(self.ctx, "room_events", after_seq=last_seq, limit=100)
if result["gap"]:
    # 游标早于保留窗口，按提供方业务决定如何恢复。
    pass
for event in result["events"]:
    await handle_event(event)
    last_seq = event["seq"]
```

返回的 `latestSeq` 是服务器当前最新序号，分页时应保存实际处理过的最后一条 `seq`，避免跳过尚未读取的下一页。

### room_events_subscribe

```python
room_events_subscribe(
    callback_api, version="1", token="", remove=False
)
```

回调必须是另一插件已公开、可调用的完整 API 名称。版本为 1–64 字符，最多同时登记 16 个回调。

```python
from maibot_sdk import API

@API("on_room_interaction", version="1", public=True)
async def on_room_interaction(self, event: dict):
    # 使用 event["id"] 去重，按业务记录 event["seq"]。
    if event["type"] == "room.action" and event["name"] == "feed":
        await self.record_room_feed(event)
    return {"success": True}

receipt = await call_room(
    self.ctx, "room_events_subscribe",
    callback_api="example.my_plugin.on_room_interaction", version="1"
)
management_token = receipt.get("token")
```

首次成功返回 `ok/token/latestSeq`。保存管理 token，以便更新或移除该回调。同一版本的无 token 重复登记返回 `alreadyRegistered=true`，可以用于网络重试，已登记回调继续生效。更新版本或移除时须提供原 token。

```python
await call_room(
    self.ctx, "room_events_subscribe",
    callback_api="example.my_plugin.on_room_interaction",
    token=management_token, remove=True,
)
```

宿主以 `callback(event=event)` 调用。每次回调最长等待 2.5 秒，异步推送队列最多 128 条。提供方应快速接收并将较长工作交给自己的任务。推送为尽力送达，回调离线、超时或队列拥挤时，可按事件游标补读。使用事件 ID 去重，可处理重复补读。

## 指定电视媒体

### room_media_control

```python
room_media_control(
    action, url="", title="", loop=False, muted=True,
    volume=0.5, position_seconds=0
)
```

| action | 使用的参数 |
| --- | --- |
| `play` | HTTP(S) 媒体直链 url，及 title/loop/muted/volume |
| `pause/resume/stop` | 无额外必填参数 |
| `seek` | position_seconds，0–864000 |
| `volume` | volume，0–1，及 muted |

地址最长 8192 字符，标题最多保留 160 字符。支持 MP4、WebM、Ogg 及声明的音频 MIME。小主机下载后由宿主分块通道提供给页面。网页播放器地址需要提供方解析为媒体直链。单个媒体默认上限 64 MiB，可配置至 256 MiB。

```python
await call_room(
    self.ctx, "room_media_control", action="play",
    url=resolved_media_url, title="提供方选择的视频",
    muted=True, loop=False,
)
```

`play` 立即返回 `id/revision/status` 等字段。准备期间为 `loading`，完成后为 `ready`，失败为 `error`。这是媒体服务准备状态，页面是否正在显示以及浏览器自动播放授权由客户端决定。

### room_media_status

无参数。返回当前选择的 `id/status/revision/title`，准备成功时包含 `size/mime/sha256/chunkSize/chunks`，以及 `paused/muted/volume/loop/position/seekRevision` 等指令状态。回执不会返回下载 URL。

## 房间专属聊天流

1.3.0 使用独立原生流，平台为 `maimai_room`，账号为 `maimai_room_bot`，用户为 `room_owner`，scope 为 `maimai_room`。消息通过本插件的 duplex 网关进入宿主，由该网关接收对应流的出站回复。

专属消息仍由宿主聊天核心处理，并保存在宿主聊天记录中。页面使用有界本地镜像续看，保留最近 200 条。投递中断会标记状态，镜像保留范围内的持久请求 ID 可避免已发送消息在重载后重复投递。

下述聊天接口是页面私有绑定。房间中的工具若需主动调节自身状态，可以在 `tools.private_users` 中明确加入 `maimai_room:room_owner`，默认空白名单继续生效。

## 页面私有绑定参考

这些 API 供宿主自定义页使用。其他插件使用前文公开接口。

| 页面方法 | API | 参数及用途 |
| --- | --- | --- |
| query client_config | room_client_config | 返回 renderGraceSeconds、desktopFps |
| query summary | room_snapshot | 当前快照 |
| query runtime_chunk | room_runtime_chunk | encoding 为 plain/gzip，index 0–31 |
| query model_info | room_model_info | asset 固定 maisaka.glb，quality mobile/high，encoding plain/gzip |
| query model_chunk | room_model_chunk | 上述参数及 index，固定每块 196608 字节 |
| action interact | room_interact | command/target/request_id |
| action garden | room_garden_action | action/plot/crop/quantity/request_id |
| action ui_event | room_ui_event | name、JSON 字符串 detail、request_id |
| action chat_send | room_chat_send | text 1–2000 字符，request_id 16–128 位字母数字、下划线或短横线 |
| query chat_status | room_chat_status | request_id，返回 queued/sent/replied/error/unknown/missing |
| query chat_history | room_chat_history | after_seq，返回专属流镜像的下一页 |
| query media_chunk | room_media_chunk | media_id/index，当前媒体只读分块 |
| action tv_review | room_tv_review | image_data/request_id，用户主动提交缩小后的单帧 |
| action tv_save_frame | room_tv_save_frame | image_data/request_id，保存用户主动确认的单帧 |
| query tv_status | room_tv_status | request_id，查询主动单帧操作 |

WebUI 底层 HTTP 调用由宿主包装为 `{"args": {...}}`，返回 `{"result": ...}`。插件代码优先使用 SDK，页面代码使用 `window.maibot.query/action`。

## 接入检查

提供方声明 `api.call`，回调用 `@API(..., public=True)` 暴露。动作去重使用稳定 request_id，接管需保存 token 并续租，事件消费者保存已处理序号并按 ID 去重。异步媒体先观察状态，页面资源和聊天接口走已有宿主登录。接入失败时，以返回的错误或异常为依据保留原业务状态。
