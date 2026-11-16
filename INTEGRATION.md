# 麦麦的小屋 1.3 接线说明

插件 ID 为 `cateye.maimai_room`，公共 API 均为版本 `1`。通过 MaiBot SDK 的 `ctx.api.call` 调用即可。房间使用同一份行为状态，QQ 指令、WebUI 和插件接口的结果均会在页面体现。

## 状态调节工具

`room_adjust_state` 是 bot 可调用的房间状态工具，支持走、坐、睡、唤醒、表情、灯和基础互动。工具开关默认为开。私聊和群聊分别使用空白名单，因此安装后没有任何 QQ 会话获准调用。

```toml
[tools]
enabled = true
force_enabled = false
private_mode = "whitelist"
private_users = []
group_mode = "whitelist"
groups = []
```

在 `private_users` 中填 QQ 用户号，在 `groups` 中填 QQ 群号，可以使用纯号码或 `qq:号码`。两种会话可分别改成 `blacklist` 模式。工具会校验宿主注入的实际会话信息。

其他插件取得行为接管后，调节工具会隐藏，并在执行入口再次检查接管状态。接管方主动释放或到期后，工具恢复。将 `force_enabled` 设为 `true` 可以在接管期间继续使用工具，会话名单仍然生效。WebUI 手动操作和已有 QQ 操作者权限沿用各自配置。

## 第三方主动接管行为和日程

新版由其他插件主动调用接口，原先生活插件的后台轮询已移除。升级时会保留其配置字段作为兼容占位，`life.enabled` 默认关闭。

提供方先取得接管回执，再用回执里的 token 推送日程或动作。已有有效接管时，其他提供方无法直接覆盖。SDK 当前没有给被调用 API 注入可信的调用方身份，`provider` 用于标识来源，后续写入通过接管 token 校验。

```python
receipt = await self.ctx.api.call(
    "cateye.maimai_room.room_control", version="1",
    action="claim", provider="example.my_schedule", ttl_seconds=300,
)
token = receipt["token"]

await self.ctx.api.call(
    "cateye.maimai_room.room_schedule_update", version="1",
    token=token,
    activity={"name": "看书", "command": "sit", "target": "desk"},
    schedule=[{"time": "09:00", "activity": "看书", "day_offset": 0}],
    mood="平静",
)

await self.ctx.api.call(
    "cateye.maimai_room.room_control_action", version="1",
    token=token, command="walk", target="balcony",
    request_id="my-schedule-event-20261116-001",
)

await self.ctx.api.call(
    "cateye.maimai_room.room_control", version="1",
    action="renew", provider="example.my_schedule", token=token,
    ttl_seconds=300,
)

await self.ctx.api.call(
    "cateye.maimai_room.room_control", version="1",
    action="release", token=token,
)
```

`ttl_seconds` 支持 10–86400 秒，默认 300 秒，提供方应在到期前续租。token 只在接管回执中返回，普通快照不包含它。接管到期、主动释放或插件重载后，行为可以回到默认作息。工具配置热更新会保留当前有效接管，便于切换强制启用选项。当前 WebUI 或 QQ 手动姿态的默认保留时间仍是 900 秒，`auto` 动作可以解除。第三方直接动作同样支持请求 ID 去重。

`room_schedule_update` 接受当前活动和用于展示的日程列表。活动可指定 `command` 为 `walk/sit/sleep/stand`，并用 `target` 指定地点。列表最多 80 行，列表行用于展示，当前实际活动由提供方按时推送。省略地点时会根据活动名匹配地点。常用地点有 `sofa/bed/desk/balcony/kitchen/dining/bathroom/garden/door`。接管方只调用动作接口、没有推送日程时，自动作息和自动园艺会让出行为控制。

`room_snapshot` 是公共只读 API。`room_control(action="status")` 可读取当前提供方、到期时间和是否接入日程。

## 默认作息

未接入第三方日程时采用固定的 Asia/Shanghai 作息。00:00 睡觉，07:00 洗漱，07:30 早餐，08:00 学习工作，12:00 午餐，13:00 午间休息，14:00 学习工作，17:30 准备晚饭，18:00 晚餐，19:00 休闲，21:30 洗漱，22:00 就寝。空闲时仍可按园艺配置照料菜园。

## 视频播放接口

`room_media_control` 接受媒体 HTTP(S) 直链，由小主机下载一次，再经宿主的有界分块通道传到已打开的房间。支持 MP4、WebM、Ogg 及浏览器可解码的音频。网站播放器页面需要由提供方先解析出实际媒体地址。登录 Cookie、额外请求头、HLS/DASH 清单和 DRM 播放器没有在本版接入。

```python
receipt = await self.ctx.api.call(
    "cateye.maimai_room.room_media_control", version="1",
    action="play", url=media_direct_url, title="提供方选择的视频",
    muted=True, loop=False, volume=0.5,
)
state = await self.ctx.api.call(
    "cateye.maimai_room.room_media_status", version="1",
)

await self.ctx.api.call(
    "cateye.maimai_room.room_media_control", version="1",
    action="pause",
)
await self.ctx.api.call(
    "cateye.maimai_room.room_media_control", version="1",
    action="seek", position_seconds=30,
)
await self.ctx.api.call(
    "cateye.maimai_room.room_media_control", version="1",
    action="resume",
)
await self.ctx.api.call(
    "cateye.maimai_room.room_media_control", version="1",
    action="volume", volume=0.6, muted=False,
)
await self.ctx.api.call(
    "cateye.maimai_room.room_media_control", version="1",
    action="stop",
)
```

`play` 立即返回 `loading` 回执，之后用 `room_media_status` 查询 `ready/error`。页面打开后轮询到状态，即会接收视频并在电视中播放。后台下载最长 90 秒，单次网络读取超时为 15 秒。`tv.max_video_mib` 默认 64 MiB，可配置 1–256 MiB。`tv.plugin_playback_enabled` 默认开启。停止、更换媒体或插件卸载会清理对应临时文件。

默认静音便于浏览器自动播放。打开声音时，浏览器可能要求用户先点击一次播放。播放过程会使用浏览器和小主机的带宽与缓存。

## 加载和页面生命周期

`performance.desktop_fps` 默认 60，标准画质使用此帧率，省电画质仍为 24。`performance.render_grace_seconds` 默认 600，支持 0–3600 秒。页面实例仍存在时，切到其他浏览器标签或暂时隐藏房间，会在期限内保留场景，回到页面直接复用。首次尚未打开的房间保持按需加载，超时则释放计时器、模型、材质与 WebGL 上下文。

当前 MaiBot 宿主在侧栏切换路由时直接卸载自定义页 iframe，这种情况下浏览器立即销毁页面。跨侧栏保留 600 秒需要宿主增加页面保留能力。本插件的延迟释放在 iframe 仍存在的场景生效。

默认模型以 gzip 经 SDK 传输，从 16 块降为 9 块。加载后还原的 GLB 与 1.1.0 字节一致。同一页面实例内切换模型档位，可复用已校验的压缩数据。角色外观、骨骼和动作母版的后续修改应先通知用户切回 `gpt-6-astra`。

## 1.3 新接口

详细参数和回执已独立整理为 [API.md](API.md)。用户互动通过 room_events 按游标补读，通过 room_events_subscribe 注册另一插件的公开 API 回调。原生专属聊天平台为 maimai_room，消息经本插件 duplex 网关收发。房间专属流的工具身份为 maimai_room:room_owner，可按需加入私聊名单。
